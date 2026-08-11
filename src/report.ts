import type { JudgeReport } from "./types.js";

const VERDICT_LABEL: Record<JudgeReport["finalVerdict"], string> = {
  SUBMIT_CANDIDATE: "SUBMIT CANDIDATE — survived every gate",
  NEEDS_MORE_EVIDENCE: "NEEDS MORE EVIDENCE — a real flag was raised, shore this up before submitting",
  LIKELY_REJECTED: "LIKELY REJECTED — do not spend a submission on this as-is",
};

function divider(): string {
  return "=".repeat(72);
}

export function formatReport(report: JudgeReport): string {
  const lines: string[] = [];
  lines.push(divider());
  lines.push(`AL-MIZAAN JUDGE — ${report.finding.title}`);
  lines.push(`Class: ${report.finding.bugClass} | Claimed severity: ${report.finding.severity} | Platform: ${report.finding.platform}`);
  lines.push(divider());
  lines.push("");
  lines.push(`VERDICT: ${VERDICT_LABEL[report.finalVerdict]}`);
  if (report.rejectCategory !== "none") {
    lines.push(`Reject category: ${report.rejectCategory}`);
  }
  lines.push("");
  lines.push("-- Gate trail --");
  for (const note of report.gateNotes) {
    lines.push(`  - ${note}`);
  }
  lines.push("");

  if (report.ranAdversarialDebate && report.debate) {
    lines.push("-- Debate rounds --");
    for (const round of report.debate.rounds) {
      lines.push(`  Round ${round.round} [${round.phase}] -> ${round.judgeVerdict} (${round.confidence}% confidence)`);
      lines.push(`    Judge: ${round.judgeReasoning}`);
      if (round.evidence.length > 0) {
        const verified = round.evidence.filter((e) => e.verified);
        lines.push(`    Verified evidence: ${verified.length}/${round.evidence.length} citations checked out against the provided code`);
      }
    }
    lines.push(`  LLM calls used this run: ${report.debate.llmCalls}`);
    lines.push("");
  }

  lines.push("-- Strongest counter-argument --");
  lines.push(`  ${report.strongestCounterArgument}`);
  lines.push("");
  lines.push(divider());

  return lines.join("\n");
}

export function formatJson(report: JudgeReport): string {
  return JSON.stringify(report, null, 2);
}
