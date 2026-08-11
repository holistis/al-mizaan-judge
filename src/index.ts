/**
 * Public library entrypoint — the full judge pipeline: mechanical gates first
 * (free, instant), then the adversarial debate for anything that survives.
 */

import { runMechanicalGates } from "./mechanical-gates.js";
import { runAdversarialDebate } from "./debate.js";
import type { Finding, JudgeReport, RejectCategory } from "./types.js";

export type { Finding, JudgeReport, BugClass, Severity, Platform } from "./types.js";
export { parseFindingFile, InputParseError } from "./parse-input.js";

function rejectCategoryFromMechanicalGate(gate: string | null): RejectCategory {
  switch (gate) {
    case "trusted-actor":
      return "authority";
    case "deployer-misconfig":
      return "operational-assumption";
    case "protocol-intent":
      return "intended-behavior";
    case "oracle-viability":
      return "economics";
    default:
      return "none";
  }
}

export async function judge(finding: Finding): Promise<JudgeReport> {
  const mechanical = runMechanicalGates(finding);
  const gateNotes = [`Mechanical gates: ${mechanical.verdict}${mechanical.gate ? ` (${mechanical.gate})` : ""} — ${mechanical.reason}`];

  if (mechanical.verdict === "ELIMINATE") {
    return {
      finding: { title: finding.title, bugClass: finding.bugClass, severity: finding.severity, platform: finding.platform },
      mechanical,
      ranAdversarialDebate: false,
      finalVerdict: "LIKELY_REJECTED",
      rejectCategory: rejectCategoryFromMechanicalGate(mechanical.gate),
      strongestCounterArgument: mechanical.reason,
      gateNotes,
    };
  }

  const mechanicalEscalated = mechanical.verdict === "ESCALATE";
  if (mechanicalEscalated) {
    gateNotes.push("Mechanical gate flagged this as ESCALATE rather than an outright kill — running the full debate anyway so you get a complete picture, but treat the mechanical warning above as a real risk to your submission.");
  }

  const debate = await runAdversarialDebate(finding);
  gateNotes.push(`Adversarial debate: ${debate.summary}`);

  const strongestRound = [...debate.rounds].reverse().find((r) => r.judgeReasoning.length > 0);
  const strongestCounterArgument = strongestRound?.judgeReasoning ?? "No specific counter-argument was recorded.";

  let finalVerdict: JudgeReport["finalVerdict"];
  let rejectCategory: RejectCategory;

  if (debate.verdict === "KILL") {
    finalVerdict = "LIKELY_REJECTED";
    rejectCategory = mechanicalEscalated ? rejectCategoryFromMechanicalGate(mechanical.gate) : "impossible-state";
  } else if (mechanicalEscalated) {
    // Debate says PASS, but a mechanical gate already raised a real flag — don't
    // let the debate silently overrule the mechanical signal. Downgrade to
    // "needs more evidence" instead of a clean submit-candidate.
    finalVerdict = "NEEDS_MORE_EVIDENCE";
    rejectCategory = rejectCategoryFromMechanicalGate(mechanical.gate);
  } else {
    finalVerdict = "SUBMIT_CANDIDATE";
    rejectCategory = "none";
  }

  return {
    finding: { title: finding.title, bugClass: finding.bugClass, severity: finding.severity, platform: finding.platform },
    mechanical,
    ranAdversarialDebate: true,
    debate: { rounds: debate.rounds, verdict: debate.verdict, summary: debate.summary, llmCalls: debate.llmCalls },
    finalVerdict,
    rejectCategory,
    strongestCounterArgument,
    gateNotes,
  };
}
