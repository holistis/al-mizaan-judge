/**
 * Core types for a single finding under judgement.
 * This is the same shape the internal Al-Mizaan pipeline uses, trimmed to what
 * a standalone judge needs — no build-harness, no ledger, no pipeline plumbing.
 */

export type BugClass =
  | "access-control"
  | "reentrancy"
  | "integer-overflow"
  | "rounding-precision"
  | "oracle-manipulation"
  | "flash-loan"
  | "signature-replay"
  | "business-logic"
  | "dos-griefing"
  | "liquidation"
  | "proxy-storage"
  | "other";

export type Severity = "High" | "Medium" | "Low";

export type Platform = "sherlock" | "immunefi" | "cantina" | "generic";

/** A finding as submitted by the user, before judgement. */
export interface Finding {
  title: string;
  bugClass: BugClass;
  severity: Severity;
  affectedFile: string;
  affectedFunction: string;
  /** Technical description of the issue. */
  description: string;
  /** What an attacker achieves. */
  impact: string;
  /** The falsifiable claim the exploit breaks. */
  invariant: string;
  /** Step-by-step attack plan. */
  exploitSketch: string;
  /** 0-100 self-assessed confidence, before the gates run. */
  confidence: number;
  /** Which platform this is headed for — changes which hardcoded platform rules apply. */
  platform: Platform;
  /** Relevant code the finding refers to (file path -> content). */
  code: Array<{ path: string; content: string }>;
  /** Optional: README/scope excerpt for the scope gate and intent check. */
  protocolContext?: string;
}

export type MechanicalVerdict = "PASS" | "ESCALATE" | "ELIMINATE";

export interface MechanicalResult {
  verdict: MechanicalVerdict;
  gate: "trusted-actor" | "deployer-misconfig" | "protocol-intent" | "oracle-viability" | null;
  reason: string;
}

export type DebatePhase = "debate" | "rebuttal" | "evidence";

export interface EvidenceItem {
  side: "defender" | "attacker";
  codeCitation: string;
  concreteClaim: string;
  verified: boolean;
}

export interface DebateRound {
  round: number;
  phase: DebatePhase;
  defense: string;
  attack: string;
  judgeVerdict: "PASS" | "KILL" | "INCONCLUSIVE";
  judgeReasoning: string;
  confidence: number;
  evidence: EvidenceItem[];
}

export type FinalVerdict = "SUBMIT_CANDIDATE" | "NEEDS_MORE_EVIDENCE" | "LIKELY_REJECTED";

export type RejectCategory =
  | "scope"
  | "authority"
  | "impossible-state"
  | "economics"
  | "duplicate-pattern"
  | "operational-assumption"
  | "intended-behavior"
  | "none";

/** The full, final report handed back to the user. */
export interface JudgeReport {
  finding: Pick<Finding, "title" | "bugClass" | "severity" | "platform">;
  mechanical: MechanicalResult;
  ranAdversarialDebate: boolean;
  debate?: {
    rounds: DebateRound[];
    verdict: "PASS" | "KILL";
    summary: string;
    llmCalls: number;
  };
  finalVerdict: FinalVerdict;
  rejectCategory: RejectCategory;
  strongestCounterArgument: string;
  gateNotes: string[];
}
