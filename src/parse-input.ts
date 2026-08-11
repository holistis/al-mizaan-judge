/**
 * Parses the user's input file into a Finding. Deliberately a plain, structured
 * markdown format rather than an LLM-parsed free-text blob for v1 — no extra API
 * call, no ambiguity about what the judge actually received. See examples/ for the
 * exact format.
 */

import type { BugClass, Finding, Platform, Severity } from "./types.js";

const VALID_BUG_CLASSES: BugClass[] = [
  "access-control",
  "reentrancy",
  "integer-overflow",
  "rounding-precision",
  "oracle-manipulation",
  "flash-loan",
  "signature-replay",
  "business-logic",
  "dos-griefing",
  "liquidation",
  "proxy-storage",
  "other",
];

function field(text: string, name: string): string | undefined {
  const re = new RegExp(`^${name}:\\s*(.+)$`, "im");
  const m = text.match(re);
  return m?.[1]?.trim();
}

function section(text: string, heading: string): string {
  const lines = text.split("\n");
  const headingRe = new RegExp(`^##\\s*${heading}\\s*$`, "i");
  const startIdx = lines.findIndex((l) => headingRe.test(l.trim()));
  if (startIdx === -1) return "";

  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx + 1, endIdx).join("\n").trim();
}

function parseCodeSection(text: string): Array<{ path: string; content: string }> {
  const codeSection = section(text, "Code");
  if (!codeSection) return [];

  const files: Array<{ path: string; content: string }> = [];
  const fileRe = /^###\s+(\S+)\s*$\n```[a-zA-Z]*\n([\s\S]*?)```/gim;
  let m: RegExpExecArray | null;
  while ((m = fileRe.exec(codeSection)) !== null) {
    files.push({ path: m[1].trim(), content: m[2] });
  }
  return files;
}

export class InputParseError extends Error {}

export function parseFindingFile(raw: string): Finding {
  const titleMatch = raw.match(/^#\s*Title:\s*(.+)$/im) ?? raw.match(/^#\s+(.+)$/m);
  const title = titleMatch?.[1]?.trim();
  if (!title) {
    throw new InputParseError("No title found. Start the file with '# Title: <your finding title>'.");
  }

  const bugClassRaw = (field(raw, "Bug class") ?? "other").toLowerCase() as BugClass;
  const bugClass = VALID_BUG_CLASSES.includes(bugClassRaw) ? bugClassRaw : "other";

  const severityRaw = (field(raw, "Severity") ?? "Medium") as Severity;
  const severity: Severity = ["High", "Medium", "Low"].includes(severityRaw) ? severityRaw : "Medium";

  const platformRaw = (field(raw, "Platform") ?? "generic").toLowerCase() as Platform;
  const platform: Platform = ["sherlock", "immunefi", "cantina", "generic"].includes(platformRaw) ? platformRaw : "generic";

  const confidenceRaw = field(raw, "Confidence");
  const confidence = confidenceRaw ? Number.parseInt(confidenceRaw, 10) : 70;

  const description = section(raw, "Description");
  const impact = section(raw, "Impact");
  const invariant = section(raw, "Invariant");
  const exploitSketch = section(raw, "Exploit sketch");
  const protocolContext = section(raw, "Protocol context") || undefined;

  if (!description || !exploitSketch) {
    throw new InputParseError(
      "Missing required sections. A finding file needs at least '## Description' and '## Exploit sketch'. See examples/ for the format.",
    );
  }

  const code = parseCodeSection(raw);
  if (code.length === 0) {
    throw new InputParseError(
      "No code found under '## Code'. Add at least one '### path/to/File.sol' block with a fenced code snippet — the judge needs the actual code to reason about reachability.",
    );
  }

  const affectedFile = field(raw, "Affected file") ?? code[0]?.path ?? "unknown";
  const affectedFunction = field(raw, "Affected function") ?? "unknown";

  return {
    title,
    bugClass,
    severity,
    affectedFile,
    affectedFunction,
    description,
    impact: impact || "(not provided)",
    invariant: invariant || "(not provided)",
    exploitSketch,
    confidence: Number.isFinite(confidence) ? confidence : 70,
    platform,
    code,
    protocolContext,
  };
}
