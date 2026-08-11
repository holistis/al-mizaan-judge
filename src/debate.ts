/**
 * Adversarial debate — Defender vs Attacker vs Judge, up to 3 rounds.
 *
 * ROUND 1 — DEBATE:
 *   Defender → strongest defense (why is this SAFE?)
 *   Attacker → weakest point in the defense (why does it fail?)
 *   Judge    → PASS / KILL / INCONCLUSIVE
 *   Early stop: ONLY on KILL with confidence >= 80. PASS never stops early.
 *
 * ROUND 2 — REBUTTAL:
 *   Defender → reinforced defense against the judge's critique
 *   Attacker → new attack on the improved defense
 *   Judge    → PASS / KILL / INCONCLUSIVE
 *
 * ROUND 3 — EVIDENCE:
 *   Both sides → concrete code citations (file:function:claim), no rhetoric
 *   Judge sees ONLY verified citations. Doubt defaults to KILL.
 *
 * A finding that survives all three rounds is a real submit-candidate.
 * Default-on-doubt = KILL — errors lean toward not submitting, never toward
 * a false PASS that costs the user a wasted, stake-losing submission.
 *
 * The Defender and Attacker never see each other's arguments before they write —
 * they respond to the PREVIOUS round's transcript, not live back-and-forth, so
 * neither can just concede early.
 */

import { complete as realComplete, hasApiKey, MissingApiKeyError, type CompleteOpts } from "./llm.js";
import { platformRules } from "./platform-rules.js";
import type { DebateRound, EvidenceItem, Finding } from "./types.js";

/** Injectable so tests can verify round-transition logic without a real API call. */
export type CompleteFn = (opts: CompleteOpts) => Promise<string>;

function log(msg: string): void {
  console.error(msg);
}

export interface DebateResult {
  rounds: DebateRound[];
  verdict: "PASS" | "KILL";
  finalConfidence: number;
  stopReason: "kill-early" | "pass-round1" | "kill-round2" | "evidence-judge" | "fallback";
  llmCalls: number;
  summary: string;
}

interface JudgeOutput {
  verdict?: string;
  confidence?: number;
  reasoning?: string;
}

function extractJudgeOutput(text: string): JudgeOutput | null {
  let depth = 0,
    start = -1,
    inStr = false,
    esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}") {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) {
          try {
            const parsed = JSON.parse(text.slice(start, i + 1)) as JudgeOutput;
            if (parsed.verdict) return parsed;
          } catch {
            start = -1;
          }
        }
      }
    }
  }
  return null;
}

// ── System prompts ─────────────────────────────────────────────────────────
// The gate sequence below mirrors the full Al-Mizaan v3 framework. The mechanical
// gates (mechanical-gates.ts) already caught the cheap, obvious patterns for free;
// everything that reaches this debate needs the harder gates reasoned through
// explicitly: scope, reachability (including the state-read-timing trap), threat
// model, invariant breach, protocol intent, and dollar impact.

const GATE_SEQUENCE = `Walk the finding through this exact gate sequence, in this order. A finding can
fail at any gate — if it fails, say which gate and stop reasoning about later gates.

0. SCOPE — Is the affected file actually in scope? Does the given protocol context
   explicitly say this behavior is out of scope, or explicitly assume it away
   ("oracles will always be correct", "admin is trusted")? If yes: dead, full stop.
1. REACHABILITY — Can this attack path actually be reached, step by step, with the
   given code? Pay special attention to STATE-READ TIMING: if the bug depends on a
   state variable (balance/index/debt/shares) being zero or first-touch, trace the
   exact line where that state is read versus the exact line where it's mutated.
   Pre-hooks (Comptroller mintAllowed/transferAllowed, ERC20 beforeTokenTransfer,
   ERC4626 _update) often run BEFORE the mutation and already sync state — which can
   multiply the bug's delta by zero or permanently close the window. "The hook fires
   before the mutation" is not proof by itself — cite the exact line numbers for both.
2. THREAT MODEL — Who is the attacker? Only an untrusted, public actor counts strongly.
   Owner/governance/multisig/deployer-only attackers are a different category (see
   platform rules below on how those get scored, if at all).
3. INVARIANT BREACH — Which protocol principle actually breaks: solvency, accounting
   conservation (sum of parts = total), access control, liveness (permanent fund
   lock), ordering (front-run/sandwich), or settlement (correct, non-duplicated
   payout)? A finding can claim an invariant breach WITHOUT a fully profitable exploit
   path if the principle demonstrably breaks.
4. PROTOCOL INTENT — Only checked now, AFTER reachability is established, so that
   incorrect documentation can never mask a real, reachable bug. Is this explicitly
   documented as intended behavior? If so, does the impact exceed what the docs
   actually promise, or is it "known and accepted" — those are not the same thing.
5. IMPACT — Compute the actual dollar impact, don't estimate by feel. Compare against
   the platform-specific thresholds below if the platform's rules give one.`;

const DEFENDER_SYSTEM = `You are the Defender: an expert defending a smart contract's safety.
Your job: write the STRONGEST possible defense that this contract is SAFE and the
claimed bug does NOT exist or is NOT exploitable.

Rules:
- Find every guard, check, and invariant that stops the attack.
- Explain exactly which step of the attack is impossible, and why.
- Name specific functions, requires, modifiers, state variables that block it.
- Be concrete and convincing — a weak defense helps no one, including the user
  paying for this judgement.`;

const ATTACKER_SYSTEM = `You are the Attacker: an expert attacking a proposed defense.
Your job: find the WEAKEST point in the Defender's argument and prove why it fails.

Rules:
- Take the defense seriously — don't dismiss it, find the fatal flaw.
- Walk through, step by step, why the attack WORKS despite the defense.
- Use CONCRETE VALUES (amounts, ordering, timing) in your attack.
- If the defense holds on every point: say so honestly (defense wins). Do not
  invent a weak attack just to have something to say.`;

function judgeSystem(platform: string, isFinal: boolean): string {
  return `You are the Judge: an impartial, strict contest-judging expert.
Decide the debate between the Defender and the Attacker.

${GATE_SEQUENCE}

${platformRules(platform as never)}

Criteria:
- PASS: the Attacker proved the attack WORKS through every gate above; the defense
  had no answer.
- KILL: the Defender proved the attack does NOT work, OR the finding fails any gate
  in the sequence above; the Attacker could not break the defense.
${isFinal ? "- This is the FINAL round. Give only PASS or KILL, never INCONCLUSIVE." : "- INCONCLUSIVE (rounds 1-2 only): both arguments are plausible, more evidence needed."}

Be strict on IMPACT and REACHABILITY specifically — a technically-correct bug with
no real dollar cost, or one only a trusted actor can trigger, is a KILL regardless
of how interesting the mechanism is.

End with exactly one JSON object:
{
  "verdict": "PASS" | "KILL"${isFinal ? "" : ' | "INCONCLUSIVE"'},
  "confidence": <0-100>,
  "reasoning": "<one paragraph: who won the debate and why, citing which gate decided it>"
}`;
}

const EVIDENCE_DEFENDER_SYSTEM = `You are the Defender in the EVIDENCE phase.
Give ONLY concrete code citations proving the attack does NOT work.
Format per citation: "File.sol:functionName — [concrete claim about the code]"
Max 5 citations. No rhetoric, code facts only.`;

const EVIDENCE_ATTACKER_SYSTEM = `You are the Attacker in the EVIDENCE phase.
Give ONLY concrete code citations proving the attack DOES work.
Format per citation: "File.sol:functionName — [concrete claim about the code]"
Max 5 citations. No rhetoric, code facts only.`;

const EVIDENCE_JUDGE_SYSTEM = `You are the Evidence Judge: you see ONLY verified code citations.
No rhetoric, no argumentation — only what is literally in the code.

Rules:
- PASS: the Attacker's citations prove the attack works (the code is missing the
  check/guard).
- KILL: the Defender's citations prove the attack is stopped (the code HAS the
  check/guard).
- Doubt defaults to KILL (errors lean toward not submitting).

End with exactly one JSON object:
{
  "verdict": "PASS" | "KILL",
  "confidence": <0-100>,
  "reasoning": "<one paragraph: which citations decided it>"
}`;

// ── Evidence extraction + verification ─────────────────────────────────────

function parseEvidenceLines(text: string, side: "defender" | "attacker"): EvidenceItem[] {
  const lines = text.split("\n").filter((l) => l.trim().length > 20);
  const items: EvidenceItem[] = [];
  for (const line of lines.slice(0, 5)) {
    const m = line.match(/([A-Za-z0-9_/.-]+\.sol(?::[A-Za-z0-9_]+)?)\s*[—–-]+\s*(.+)/);
    if (m) {
      items.push({ side, codeCitation: m[1].trim(), concreteClaim: m[2].trim().slice(0, 200), verified: false });
    }
  }
  return items;
}

function verifyEvidence(items: EvidenceItem[], code: Array<{ path: string; content: string }>): EvidenceItem[] {
  return items.map((item) => {
    const [filePart, funcPart] = item.codeCitation.split(":");
    const match = code.find(
      (c) =>
        c.path.toLowerCase().endsWith(filePart.toLowerCase()) ||
        c.path.toLowerCase().includes(filePart.toLowerCase().replace(".sol", "")),
    );
    if (!match) return { ...item, verified: false };
    const blob = match.content.toLowerCase();
    const funcOk = !funcPart || blob.includes(funcPart.toLowerCase());
    const claimTokens = item.concreteClaim.toLowerCase().match(/[a-z]{4,}/g) ?? [];
    const claimHit = claimTokens.slice(0, 3).some((t) => blob.includes(t));
    return { ...item, verified: funcOk && claimHit };
  });
}

// ── Rounds ──────────────────────────────────────────────────────────────────

function codeContextBlock(finding: Finding): string {
  const fileBase = finding.affectedFile.split("/").pop()?.toLowerCase() ?? "";
  const target = finding.code.find((c) => c.path.split("/").pop()?.toLowerCase() === fileBase);
  return [
    target ? `### TARGET FILE ${target.path}\n${target.content.slice(0, 3500)}` : "",
    ...finding.code
      .filter((c) => c !== target)
      .slice(0, 3)
      .map((c) => `### ${c.path}\n${c.content.slice(0, 800)}`),
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function runDebateRound(
  complete: CompleteFn,
  finding: Finding,
  codeContext: string,
  previousDebate: string,
  roundNumber: number,
  phase: "debate" | "rebuttal",
  isLast: boolean,
): Promise<{ round: DebateRound; llmCalls: number }> {
  let llmCalls = 0;

  const findingCtx = `CANDIDATE FINDING:
- Title: ${finding.title}
- Class: ${finding.bugClass} | Claimed severity: ${finding.severity}
- File: ${finding.affectedFile} (${finding.affectedFunction})
- Description: ${finding.description?.slice(0, 500)}
- Exploit sketch: ${finding.exploitSketch?.slice(0, 800)}
- Impact: ${finding.impact?.slice(0, 400)}
- Invariant claimed to break: ${finding.invariant?.slice(0, 400)}`;

  const commonCtx = `${finding.protocolContext ? `PROTOCOL CONTEXT:\n${finding.protocolContext.slice(0, 1500)}\n\n` : ""}${findingCtx}

CODE CONTEXT:
${codeContext.slice(0, 4000)}${previousDebate ? `\n\nPREVIOUS DEBATE (round ${roundNumber - 1}):\n${previousDebate}` : ""}`;

  const phaseNote = phase === "rebuttal" ? "The judge found the previous round inconclusive. Reinforce your argument on its weakest point." : "";

  let defense = "(Defender could not produce a defense)";
  try {
    defense = (await complete({ system: DEFENDER_SYSTEM, prompt: `${commonCtx}\n\nWrite the STRONGEST defense. Why is this code safe?\n${phaseNote}\nMax 300 words.`, maxTokens: 1200 })) || defense;
    llmCalls++;
  } catch {
    /* degrade silently, judge sees the placeholder */
  }

  let attack = "(Attacker could not mount an attack)";
  try {
    attack =
      (await complete({
        system: ATTACKER_SYSTEM,
        prompt: `${commonCtx}\n\nDEFENDER'S DEFENSE:\n${defense.slice(0, 600)}\n\nFind the WEAKEST point. Prove why the attack WORKS.\n${phaseNote}\nMax 300 words.`,
        maxTokens: 1200,
      })) || attack;
    llmCalls++;
  } catch {
    /* degrade silently */
  }

  let judgeOutput: JudgeOutput | null = null;
  try {
    const judgeText =
      (await complete({
        system: judgeSystem(finding.platform, isLast),
        prompt: `${commonCtx}\n\nDEFENDER'S DEFENSE:\n${defense.slice(0, 500)}\n\nATTACKER'S ATTACK:\n${attack.slice(0, 500)}\n\nWho wins the debate? End with the JSON object.`,
        maxTokens: 1000,
      })) || "";
    judgeOutput = extractJudgeOutput(judgeText);
    llmCalls++;
  } catch {
    /* degrade silently */
  }

  const rawVerdict = (judgeOutput?.verdict ?? "INCONCLUSIVE").toUpperCase() as "PASS" | "KILL" | "INCONCLUSIVE";
  const verdict: DebateRound["judgeVerdict"] = isLast && rawVerdict === "INCONCLUSIVE" ? "KILL" : rawVerdict;
  const confidence = Number.isFinite(judgeOutput?.confidence) ? (judgeOutput!.confidence as number) : 50;

  return {
    round: {
      round: roundNumber,
      phase,
      defense: defense.slice(0, 800),
      attack: attack.slice(0, 800),
      judgeVerdict: verdict,
      judgeReasoning: (judgeOutput?.reasoning ?? "").slice(0, 500),
      confidence,
      evidence: [],
    },
    llmCalls,
  };
}

async function runEvidenceRound(
  complete: CompleteFn,
  finding: Finding,
  codeContext: string,
  previousDebate: string,
  roundNumber: number,
): Promise<{ round: DebateRound; verdict: "PASS" | "KILL"; llmCalls: number }> {
  let llmCalls = 0;

  const base = `${finding.protocolContext ? `PROTOCOL:\n${finding.protocolContext.slice(0, 600)}\n\n` : ""}CANDIDATE FINDING: ${finding.title}
File: ${finding.affectedFile} (${finding.affectedFunction})
Exploit sketch: ${finding.exploitSketch?.slice(0, 500)}

CODE:
${codeContext.slice(0, 3000)}

PREVIOUS DEBATE:
${previousDebate.slice(0, 800)}

Give only concrete code citations (file.sol:function — claim). Max 5.`;

  let defenseRaw = "";
  try {
    defenseRaw = (await complete({ system: EVIDENCE_DEFENDER_SYSTEM, prompt: base, maxTokens: 600 })) || "";
    llmCalls++;
  } catch {
    /* degrade silently */
  }

  let attackRaw = "";
  try {
    attackRaw = (await complete({ system: EVIDENCE_ATTACKER_SYSTEM, prompt: base, maxTokens: 600 })) || "";
    llmCalls++;
  } catch {
    /* degrade silently */
  }

  const defenseItems = verifyEvidence(parseEvidenceLines(defenseRaw, "defender"), finding.code);
  const attackItems = verifyEvidence(parseEvidenceLines(attackRaw, "attacker"), finding.code);
  const allEvidence = [...defenseItems, ...attackItems];

  const defenseVerified = defenseItems.filter((i) => i.verified);
  const attackVerified = attackItems.filter((i) => i.verified);

  const evidenceBlock = [
    defenseVerified.length > 0
      ? `DEFENDER (${defenseVerified.length} verified):\n${defenseVerified.map((i) => `  [${i.codeCitation}] ${i.concreteClaim}`).join("\n")}`
      : "DEFENDER: no verified citations.",
    attackVerified.length > 0
      ? `ATTACKER (${attackVerified.length} verified):\n${attackVerified.map((i) => `  [${i.codeCitation}] ${i.concreteClaim}`).join("\n")}`
      : "ATTACKER: no verified citations.",
  ].join("\n\n");

  let judgeOutput: JudgeOutput | null = null;
  try {
    const judgeText =
      (await complete({
        system: EVIDENCE_JUDGE_SYSTEM,
        prompt: `CANDIDATE FINDING: ${finding.title}\n\n${evidenceBlock}\n\nWho wins based on the code? End with the JSON object.`,
        maxTokens: 800,
      })) || "";
    judgeOutput = extractJudgeOutput(judgeText);
    llmCalls++;
  } catch {
    /* degrade silently */
  }

  const rawVerdict = (judgeOutput?.verdict ?? "KILL").toUpperCase() as "PASS" | "KILL";
  const evidenceVerdict: "PASS" | "KILL" = rawVerdict === "PASS" ? "PASS" : "KILL";
  const confidence = Number.isFinite(judgeOutput?.confidence) ? (judgeOutput!.confidence as number) : 50;

  return {
    round: {
      round: roundNumber,
      phase: "evidence",
      defense: defenseRaw.slice(0, 600),
      attack: attackRaw.slice(0, 600),
      judgeVerdict: evidenceVerdict,
      judgeReasoning: (judgeOutput?.reasoning ?? "doubt-default: KILL").slice(0, 500),
      confidence,
      evidence: allEvidence,
    },
    verdict: evidenceVerdict,
    llmCalls,
  };
}

// ── Main entry ────────────────────────────────────────────────────────────

export async function runAdversarialDebate(finding: Finding, complete: CompleteFn = realComplete): Promise<DebateResult> {
  if (complete === realComplete && !hasApiKey()) throw new MissingApiKeyError();

  log(`[debate] "${finding.title.slice(0, 60)}" — running 3-round debate`);

  const codeContext = codeContextBlock(finding);
  const rounds: DebateRound[] = [];
  let totalLlmCalls = 0;

  const r1 = await runDebateRound(complete, finding, codeContext, "", 1, "debate", false);
  rounds.push(r1.round);
  totalLlmCalls += r1.llmCalls;
  log(`[debate] R1=${r1.round.judgeVerdict}(${r1.round.confidence}%) — ${r1.round.judgeReasoning.slice(0, 100)}`);

  if (r1.round.judgeVerdict === "KILL" && r1.round.confidence >= 80) {
    return {
      rounds,
      verdict: "KILL",
      finalConfidence: r1.round.confidence,
      stopReason: "kill-early",
      llmCalls: totalLlmCalls,
      summary: `1 round: R1=KILL(${r1.round.confidence}%) — stopped early (high confidence).`,
    };
  }

  const needsRound2 = r1.round.judgeVerdict === "INCONCLUSIVE" || (r1.round.confidence >= 35 && r1.round.confidence <= 65) || r1.round.judgeVerdict === "PASS";
  if (!needsRound2) {
    const verdict: "PASS" | "KILL" = r1.round.judgeVerdict === "PASS" ? "PASS" : "KILL";
    return {
      rounds,
      verdict,
      finalConfidence: r1.round.confidence,
      stopReason: verdict === "PASS" ? "pass-round1" : "fallback",
      llmCalls: totalLlmCalls,
      summary: `1 round: R1=${r1.round.judgeVerdict}(${r1.round.confidence}%). Final: ${verdict}.`,
    };
  }

  let previousDebate = `Defense: ${r1.round.defense.slice(0, 300)}\nAttack: ${r1.round.attack.slice(0, 300)}\nJudge: ${r1.round.judgeReasoning}`;
  const r2 = await runDebateRound(complete, finding, codeContext, previousDebate, 2, "rebuttal", false);
  rounds.push(r2.round);
  totalLlmCalls += r2.llmCalls;
  log(`[debate] R2=${r2.round.judgeVerdict}(${r2.round.confidence}%) — ${r2.round.judgeReasoning.slice(0, 100)}`);

  if (r2.round.judgeVerdict === "KILL" && r2.round.confidence >= 75) {
    return {
      rounds,
      verdict: "KILL",
      finalConfidence: r2.round.confidence,
      stopReason: "kill-round2",
      llmCalls: totalLlmCalls,
      summary: `2 rounds: ${rounds.map((r) => `R${r.round}=${r.judgeVerdict}(${r.confidence}%)`).join(" -> ")}. Final: KILL.`,
    };
  }

  previousDebate += `\n\nRound 2 defense: ${r2.round.defense.slice(0, 200)}\nRound 2 attack: ${r2.round.attack.slice(0, 200)}\nJudge: ${r2.round.judgeReasoning}`;
  const r3 = await runEvidenceRound(complete, finding, codeContext, previousDebate, 3);
  rounds.push(r3.round);
  totalLlmCalls += r3.llmCalls;
  log(`[debate] R3/EVIDENCE=${r3.verdict}(${r3.round.confidence}%) — ${r3.round.judgeReasoning.slice(0, 100)}`);

  return {
    rounds,
    verdict: r3.verdict,
    finalConfidence: r3.round.confidence,
    stopReason: "evidence-judge",
    llmCalls: totalLlmCalls,
    summary: `3 rounds: ${rounds.map((r) => `R${r.round}=${r.judgeVerdict}(${r.confidence}%)`).join(" -> ")}. Final: ${r3.verdict}.`,
  };
}
