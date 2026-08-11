# Al-Mizaan Judge

A strict validity judge for smart-contract bug bounty findings. Paste in your
finding and the relevant code, and get back a structured verdict on whether it
would survive real contest judging, before you spend a submission on Sherlock,
Immunefi, or Cantina.

Submissions on these platforms cost real money, reputation, or both — a
rejected or duplicate submission is pure loss. This tool exists to catch the
findings that were never going to survive, before you spend that submission.

## What it actually does

Two layers, in order:

1. **Mechanical gates** (free, instant, no API call). Deterministic pattern
   checks that catch the cheapest, most common kills: a trusted actor
   (owner/admin/governance) as the sole attacker, a deployer-misconfiguration
   with no external attacker, an oracle-manipulation finding that hasn't
   proven economic viability, or language suggesting the behavior is
   explicitly documented as intended.

2. **Adversarial debate** (up to 3 rounds, calls the Anthropic API with your
   own key). A Defender agent argues the code is safe. An Attacker agent
   tries to break that defense. A Judge decides — walking through the full
   gate sequence: scope, reachability (including a specific check for state
   read/write timing traps), threat model, invariant breach, protocol intent,
   and dollar impact. Round 3, if reached, restricts the Judge to only
   code citations that were mechanically verified against the code you
   provided — no rhetoric, only what's actually in the code. Doubt always
   defaults to KILL: this tool is built to be conservative, an error here
   should cost you nothing, not a wasted submission.

This mirrors the internal methodology (Al-Mizaan v3) used to screen findings
before submission in a real, ongoing smart-contract bug bounty operation —
calibrated against real Sherlock judging outcomes, not a generic "is this a
bug" prompt.

## Install

```bash
npm install -g al-mizaan-judge
```

Or run without installing:

```bash
npx al-mizaan-judge my-finding.md
```

You need your own Anthropic API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Nothing runs on our infrastructure or our account. The mechanical gates run
first and are free; a full 3-round debate makes up to 7 model calls on your
key if it isn't killed early.

## Usage

```bash
al-mizaan-judge my-finding.md
al-mizaan-judge my-finding.md --json   # structured output for scripting
```

### Writing a finding file

See [`examples/`](./examples) for three complete, worked examples: one that
gets eliminated by a mechanical gate alone (`example-eliminate.md`), one that
gets escalated by a mechanical gate and then killed in the debate
(`example-escalate.md`), and one that survives as a submit-candidate
(`example-submit-candidate.md`).

The format:

```markdown
# Title: Your finding's title

Platform: sherlock
Bug class: reentrancy
Severity: High
Affected file: Vault.sol
Affected function: withdraw
Confidence: 80

## Description
What's technically wrong.

## Impact
What an attacker achieves.

## Invariant
The falsifiable claim the exploit breaks.

## Exploit sketch
1. Step-by-step attack plan.
2. ...

## Code
### Vault.sol
​```solidity
contract Vault { ... }
​```

## Protocol context
(optional) Relevant README/scope text — used for the scope gate and the
intent check.
```

`Platform` selects which hardcoded platform rules apply during judging.
`sherlock` is the most complete set right now (e.g. SJIP-21: generic
Chainlink staleness alone is always invalid; SJIP-26: a trusted actor as sole
attacker is invalid). `immunefi` and `cantina` currently use a lighter,
not-yet-calibrated generic rule set — flagged as such in the output.
`generic` runs the gate sequence with no platform-specific thresholds.

## What this deliberately does NOT do

- **No code execution.** No Foundry builds, no on-chain simulation. This is a
  reasoning judge, not a PoC runner. If the debate needs a fact only
  execution could prove, it says so rather than guessing.
- **No hypothesis generation.** You bring your own finding — this tool
  judges it, it doesn't scan a repo looking for bugs on its own.
- **No hosting, no billing.** Runs locally with your own API key. Your code
  never leaves your machine except to the Anthropic API you're already
  paying for directly.

These are staged, not abandoned — see the project roadmap if you want the
full picture of where this is headed.

## Exit codes

- `0` — verdict is `SUBMIT_CANDIDATE`
- `2` — verdict is `NEEDS_MORE_EVIDENCE` or `LIKELY_REJECTED`
- `1` — input error or configuration error (e.g. missing API key)

Useful for scripting: `al-mizaan-judge finding.md || echo "not ready yet"`.

## Library usage

```ts
import { judge, parseFindingFile } from "al-mizaan-judge";
import { readFileSync } from "node:fs";

const finding = parseFindingFile(readFileSync("my-finding.md", "utf8"));
const report = await judge(finding);
console.log(report.finalVerdict); // "SUBMIT_CANDIDATE" | "NEEDS_MORE_EVIDENCE" | "LIKELY_REJECTED"
```

## Honesty note

This is a second opinion, not a guarantee. A `SUBMIT_CANDIDATE` verdict means
the finding survived a strict, structured review — it does not guarantee a
human judge will agree. A `LIKELY_REJECTED` verdict is the tool telling you
what it would take to change its mind (read the gate trail and the
strongest counter-argument in the output) — sometimes that's exactly the
evidence you need to go find before you submit anyway.

## License

MIT
