/**
 * Platform-specific hardcoded rules — judging conventions that differ per contest
 * platform. Sherlock is the first fully-populated set: these are Sherlock's own
 * published judging policies (SJIP-21, SJIP-26, dollar-impact thresholds), not a
 * statistical fit to our own outcome data — that distinction matters, our internal
 * outcome corpus has a known sampling bias we haven't corrected for yet. Immunefi/
 * Cantina get a lighter generic set until we have their equivalent published rules
 * — extend here as more platforms get real, sourced policy behind them.
 */

import type { Platform } from "./types.js";

const SHERLOCK_RULES = `Sherlock-specific hardcoded rules (apply these literally, do not soften them):
- Generic Chainlink staleness alone is ALWAYS INVALID (SJIP-21). Do not treat a missing
  maxTimeDelta/heartbeat check as a primary finding by itself.
- A trusted actor (owner/governance/multisig) as the SOLE attacker is INVALID (SJIP-26),
  unless the docs explicitly mark that role as "restricted" / adversarial.
- High severity requires impact > $10 AND > 1% of pool/protocol TVL.
  Medium requires impact > $10 AND > 0.01% of pool/protocol TVL.
  If you cannot compute the dollar impact, or it demonstrably misses the threshold: REJECT.
- Likelihood does NOT count toward severity (Sherlock v1.12). A low-probability,
  high-impact exploit is still High if the code-path proof is solid — do not downgrade
  severity for "this requires unusual conditions" once the path is proven reachable.`;

const IMMUNEFI_RULES = `Immunefi-style conventions (generic, not yet calibrated against real judging data —
treat these as a starting point, flag explicitly when you're relying on this rather than
confirmed platform policy):
- Impact is scored against Immunefi's severity classification system (funds directly at
  risk vs. griefing vs. no direct fund loss) — be explicit about which bucket applies.
- A vulnerability requiring a compromised privileged role is usually out of scope unless
  the program explicitly lists privileged-role compromise as in-scope.`;

const CANTINA_RULES = `Cantina-style conventions (generic, not yet calibrated against real judging data —
treat these as a starting point, flag explicitly when you're relying on this rather than
confirmed platform policy):
- Judging leans on demonstrated, reproducible impact with a clear PoC path — a
  hand-wavy "this could theoretically happen" argument is treated as weak evidence.`;

const GENERIC_RULES = `No platform-specific rules loaded — apply the general Al-Mizaan gate sequence only
(scope, reachability, threat-model, invariant-breach, intent, impact) without any
platform-specific dollar thresholds or severity conventions.`;

export function platformRules(platform: Platform): string {
  switch (platform) {
    case "sherlock":
      return SHERLOCK_RULES;
    case "immunefi":
      return IMMUNEFI_RULES;
    case "cantina":
      return CANTINA_RULES;
    default:
      return GENERIC_RULES;
  }
}
