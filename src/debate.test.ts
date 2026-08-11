import { test } from "node:test";
import assert from "node:assert/strict";
import { runAdversarialDebate, type CompleteFn } from "./debate.js";
import type { Finding } from "./types.js";

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    title: "Test finding",
    bugClass: "reentrancy",
    severity: "High",
    affectedFile: "Vault.sol",
    affectedFunction: "withdraw",
    description: "desc",
    impact: "impact",
    invariant: "invariant",
    exploitSketch: "1. attacker calls withdraw",
    confidence: 80,
    platform: "sherlock",
    code: [{ path: "Vault.sol", content: "contract Vault {}" }],
    ...overrides,
  };
}

function judgeJson(verdict: string, confidence: number, reasoning = "test reasoning"): string {
  return `Some prose.\n{"verdict":"${verdict}","confidence":${confidence},"reasoning":"${reasoning}"}`;
}

/** Scripted fake: returns queued responses in call order, cycling defense/attack/judge per round. */
function scriptedComplete(judgeResponses: string[]): CompleteFn {
  let judgeCallIndex = 0;
  let callIndex = 0;
  return async (opts) => {
    callIndex++;
    // Every 3rd call in a debate/rebuttal round is the judge (defense, attack, judge).
    if (opts.system.includes("Judge")) {
      const resp = judgeResponses[judgeCallIndex] ?? judgeJson("KILL", 50);
      judgeCallIndex++;
      return resp;
    }
    return "placeholder response";
  };
}

test("early-stops after round 1 on high-confidence KILL", async () => {
  const complete = scriptedComplete([judgeJson("KILL", 85, "clear kill")]);
  const result = await runAdversarialDebate(makeFinding(), complete);
  assert.equal(result.verdict, "KILL");
  assert.equal(result.stopReason, "kill-early");
  assert.equal(result.rounds.length, 1);
});

test("stops after round 1 on high-confidence PASS-shaped low-doubt result requires round 2 (PASS never stops early)", async () => {
  // PASS at round 1 must NOT stop early even at high confidence — needs round 2.
  const complete = scriptedComplete([
    judgeJson("PASS", 90, "round1 pass"),
    judgeJson("KILL", 80, "round2 kill"),
  ]);
  const result = await runAdversarialDebate(makeFinding(), complete);
  assert.equal(result.rounds.length, 2, "PASS at round 1 must trigger round 2, never stop early");
  assert.equal(result.verdict, "KILL");
  assert.equal(result.stopReason, "kill-round2");
});

test("goes to full 3-round evidence phase when rounds 1-2 are inconclusive", async () => {
  const complete: CompleteFn = async (opts) => {
    if (opts.system.includes("Evidence Judge")) {
      return judgeJson("PASS", 70, "evidence favors attacker");
    }
    if (opts.system.includes("Judge")) {
      return judgeJson("INCONCLUSIVE", 50, "unclear");
    }
    if (opts.system.includes("EVIDENCE")) {
      return "Vault.sol:withdraw — sends value before updating balance";
    }
    return "placeholder";
  };
  const result = await runAdversarialDebate(makeFinding(), complete);
  assert.equal(result.rounds.length, 3);
  assert.equal(result.rounds[2].phase, "evidence");
  assert.equal(result.verdict, "PASS");
  assert.equal(result.stopReason, "evidence-judge");
});

test("malformed judge output degrades to a safe default instead of crashing", async () => {
  const complete: CompleteFn = async () => "not valid json at all, no braces";
  const result = await runAdversarialDebate(makeFinding(), complete);
  // No parseable JSON -> INCONCLUSIVE round1 -> round2 needed -> eventually reaches
  // evidence phase, whose doubt-default is KILL. Verifies no exception is thrown
  // anywhere in the chain even when every model response is garbage.
  assert.equal(result.verdict, "KILL");
  assert.ok(result.rounds.length >= 1);
});

test("verified evidence citations are matched against the provided code, unverifiable ones are not", async () => {
  const complete: CompleteFn = async (opts) => {
    if (opts.system.includes("Evidence Judge")) return judgeJson("KILL", 60, "defender evidence verified");
    if (opts.system.includes("Judge")) return judgeJson("INCONCLUSIVE", 50, "unclear");
    if (opts.system.includes("Defender") && opts.system.includes("EVIDENCE")) {
      return "Vault.sol:withdraw — updates balance before external call";
    }
    if (opts.system.includes("Attacker") && opts.system.includes("EVIDENCE")) {
      return "NonExistentFile.sol:phantomFunction — this citation cannot be verified";
    }
    return "placeholder";
  };
  const finding = makeFinding({ code: [{ path: "Vault.sol", content: "function withdraw() { balance -= amount; }" }] });
  const result = await runAdversarialDebate(finding, complete);
  const evidenceRound = result.rounds.find((r) => r.phase === "evidence");
  assert.ok(evidenceRound, "should have reached the evidence round");
  const defenderItem = evidenceRound!.evidence.find((e) => e.side === "defender");
  const attackerItem = evidenceRound!.evidence.find((e) => e.side === "attacker");
  assert.equal(defenderItem?.verified, true, "citation matching real code+function should verify");
  assert.equal(attackerItem?.verified, false, "citation against a nonexistent file should not verify");
});
