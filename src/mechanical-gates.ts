/**
 * Mechanical gates — deterministic, no LLM calls, cost nothing to run.
 *
 * These catch the cheap, obvious kills before spending money on the adversarial
 * debate: a trusted-actor-only attacker, a deployer-misconfig with no external
 * attacker, an oracle-manipulation finding that hasn't proven economic viability,
 * or language that signals the behavior is explicitly documented as intended.
 *
 * Ported from the internal Al-Mizaan pipeline's mechanical pre-filter. These
 * patterns were tuned against real Sherlock judging outcomes — a false-negative
 * here (missing a trusted-actor pattern) means an expensive LLM debate runs on a
 * finding that was always going to be rejected; a false-positive (wrongly killing
 * a real finding) is worse, so patterns stay conservative and specific.
 */

import type { Finding, MechanicalResult } from "./types.js";

// ============================================================
// GATE: Trusted-Actor
// ============================================================
const TRUSTED_ACTOR_STEP1: RegExp[] = [
  /^\s*1[.)]\s*(the\s+)?(owner|admin|governance|security\s+council|multisig|deployer|timelock\s+owner|role\s+holder|operator|mechanic|pauser|guardian|curator|vault\s+owner|factory\s+owner)\s+(calls?|sets?|updates?|invokes?|executes?|triggers?|sends?|deploys?|upgrades?|initializes?)/im,
];

const TRUSTED_ACTOR_SIGNALS: RegExp[] = [
  /\b(onlyOwner|onlyAdmin|onlyGovernance|onlySC|onlyRole|onlyMechanic|onlyOperator|DEFAULT_ADMIN_ROLE)\b/,
  /\bSecurity\s+Council\s+(calls?|can|injects?|sets?)/i,
  /\battacker\s+controls\s+(the\s+)?(owner|admin|governance|beacon\s+owner)/i,
  /\bcompromised\s+(owner|admin|governance|beacon)/i,
  /\b(upgrade\s+authority|program\s+authority|admin\s+(PDA|account)|update_authority)\b/i,
  /\battacker\s+controls\s+(the\s+)?(upgrade\s+authority|program\s+authority|admin\s+(PDA|keypair))/i,
  /\bcompromised\s+(upgrade\s+authority|program\s+authority|admin\s+(PDA|keypair))/i,
  /\b(only_owner|only_admin|cw_ownable|assert_owner|ADMIN\.(load|assert)|is_admin)\b/i,
  /\battacker\s+controls\s+(the\s+)?(contract\s+admin|dao|relayer)\b/i,
  /\bcompromised\s+(contract\s+admin|dao|relayer)\b/i,
];

function checkTrustedActor(f: Finding): MechanicalResult | null {
  const sketch = String(f.exploitSketch ?? "");
  const first300 = sketch.slice(0, 300);

  if (TRUSTED_ACTOR_STEP1.some((re) => re.test(first300))) {
    return {
      verdict: "ELIMINATE",
      gate: "trusted-actor",
      reason:
        "Step 1 of the exploit sketch is a privileged role (owner/admin/governance). This is not a bounty bug, it's key-management risk. On Sherlock this maps to SJIP-26: a trusted actor as the sole attacker is invalid.",
    };
  }

  const hit = TRUSTED_ACTOR_SIGNALS.find((re) => re.test(sketch));
  if (hit) {
    return {
      verdict: "ESCALATE",
      gate: "trusted-actor",
      reason: `Exploit sketch contains a privileged-role pattern ('${hit.toString().slice(0, 60)}'). Verify the attacker is genuinely untrusted before proceeding — do not submit on this signal alone.`,
    };
  }

  return null;
}

// ============================================================
// GATE: Deployer-Misconfig
// ============================================================
const DEPLOYER_MISCONFIG_SIGNALS: RegExp[] = [
  /\bdeployer\s+(misconfigur|sets?\s+(wrong|incorrect|zero)\s+parameter|forgot\s+to|fails?\s+to)/i,
  /\b(wrong|incorrect|zero)\s+(address|parameter|config)\s+(passed?\s+)?during\s+(deploy|initialization|setup)/i,
  /\bno\s+(input\s+)?validation\s+on\s+(constructor|initialize|deploy)/i,
];

function checkDeployerMisconfig(f: Finding): MechanicalResult | null {
  const text = `${f.description} ${f.exploitSketch}`;

  if (
    DEPLOYER_MISCONFIG_SIGNALS.some((re) => re.test(text)) &&
    !String(f.exploitSketch ?? "").match(/\battacker\b|\bexploit\b|\bmalicious\b/i)
  ) {
    return {
      verdict: "ELIMINATE",
      gate: "deployer-misconfig",
      reason: "The attack vector runs through a wrong deploy-time parameter with no external attacker. Not a bounty bug.",
    };
  }

  return null;
}

// ============================================================
// GATE: Protocol-Intent
// ============================================================
const INTENDED_DESIGN_SIGNALS: RegExp[] = [
  /\bintended\s+(behavior|design|fallback|by\s+design)\b/i,
  /\bby\s+design\b/i,
  /\bdocumented\s+(behavior|risk|warning|in\s+natspec)\b/i,
  /\bnatspec\s+(warn|say|state|document|note)/i,
  /\bexplicitly\s+(allow|document|stat|warn|noted)/i,
  /\bMUST\s+revoke/i,
  /\bshould\s+not\s+be\s+the\s+primary\s+oracle/i,
  /\busers?\s+MUST\s+(revoke|not|ensure|avoid)/i,
  /\baccepted\s+(fallback|design|behavior|risk)\b/i,
];

function checkProtocolIntent(f: Finding): MechanicalResult | null {
  const text = `${f.description} ${f.exploitSketch} ${f.impact}`;

  const hit = INTENDED_DESIGN_SIGNALS.find((re) => re.test(text));
  if (hit) {
    return {
      verdict: "ESCALATE",
      gate: "protocol-intent",
      reason: `Text contains a signal ('${hit.toString().slice(1, -2)}') that points to documented/intended behavior. Escalate only survives if impact is catastrophic AND clearly beyond what the docs/threat-model actually promise — otherwise this is a REJECT.`,
    };
  }

  return null;
}

// ============================================================
// GATE: Oracle Economic Viability
// ============================================================
const TWAP_ATTACK_IN_FINDING: RegExp[] = [
  /\bTWAP\b.{0,80}(manipulat|fallback|without.{0,20}(deviation|check)|stale)/i,
  /\b(fallback|falls?\s+back)\b.{0,60}\bTWAP\b/i,
  /\bUniswap.{0,40}(fallback|TWAP|oracle).{0,40}(manipulat|stale)/i,
  /\bChainlink.{0,40}(stale|down|revert).{0,80}(TWAP|Uniswap|fallback)/i,
];

function checkOracleEconomicViability(f: Finding): MechanicalResult | null {
  if (f.bugClass !== "oracle-manipulation") return null;

  const text = `${f.title} ${f.description} ${f.exploitSketch}`;
  if (!TWAP_ATTACK_IN_FINDING.some((re) => re.test(text))) return null;

  return {
    verdict: "ESCALATE",
    gate: "oracle-viability",
    reason:
      "This is a TWAP-manipulation finding. Before it can be judged, verify: (1) the actual deployed twapWindow (not assumed), and (2) that manipulation cost is less than the maximum profit it enables. Without both, this cannot be scored — provide them or expect a rejection.",
  };
}

// ============================================================
// Public interface
// ============================================================

/** Runs all mechanical gates. Returns the first hit (most severe gate first). */
export function runMechanicalGates(f: Finding): MechanicalResult {
  const checks = [checkTrustedActor, checkDeployerMisconfig, checkOracleEconomicViability, checkProtocolIntent];

  for (const check of checks) {
    const result = check(f);
    if (result) return result;
  }

  return { verdict: "PASS", gate: null, reason: "All mechanical gates passed — no cheap kill found." };
}
