#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { judge } from "./index.js";
import { parseFindingFile, InputParseError } from "./parse-input.js";
import { formatReport, formatJson } from "./report.js";
import { MissingApiKeyError } from "./llm.js";

function printUsage(): void {
  console.error(`al-mizaan-judge — strict validity judge for a smart-contract bug bounty finding

Usage:
  al-mizaan-judge <finding.md> [--json]

  <finding.md>   Path to a finding file in the Al-Mizaan Judge format.
                 See examples/ in the package for the exact format
                 (needs at least a title, description, exploit sketch,
                 and one code block).
  --json         Print the full structured report as JSON instead of
                 the human-readable summary.

Requires ANTHROPIC_API_KEY to be set in your environment — this tool calls
the Anthropic API with your own key. Nothing runs on our infrastructure or
our account. A full 3-round debate makes up to 7 model calls; the mechanical
gates that run first are free and may end things before any call happens.
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    printUsage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const asJson = args.includes("--json");
  const filePath = args.find((a) => !a.startsWith("--"));
  if (!filePath) {
    printUsage();
    process.exit(1);
  }

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (err) {
    console.error(`Could not read '${filePath}': ${(err as Error).message}`);
    process.exit(1);
  }

  try {
    const finding = parseFindingFile(raw);
    const report = await judge(finding);
    console.log(asJson ? formatJson(report) : formatReport(report));
    process.exit(report.finalVerdict === "SUBMIT_CANDIDATE" ? 0 : 2);
  } catch (err) {
    if (err instanceof InputParseError) {
      console.error(`Input format error: ${err.message}`);
      process.exit(1);
    }
    if (err instanceof MissingApiKeyError) {
      console.error(err.message);
      process.exit(1);
    }
    console.error(`Judge run failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

main();
