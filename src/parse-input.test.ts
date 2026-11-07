import { test } from "node:test";
import assert from "node:assert/strict";
import { findTitle, parseFindingFile, InputParseError } from "./parse-input.js";

test("findTitle: a Title line wins over an earlier heading, whatever the spacing or case", () => {
  assert.equal(findTitle("# Title: Reentrancy in withdraw"), "Reentrancy in withdraw");
  assert.equal(findTitle("#   title:    padded title   \n"), "padded title");
  assert.equal(findTitle("#Title: no space after hash"), "no space after hash");
  assert.equal(findTitle("# Intro\n\n# Title: The real one\n"), "The real one");
});

test("findTitle: without a Title line the first heading is used, Windows line endings included", () => {
  assert.equal(findTitle("# First heading\n# Second\n"), "First heading");
  assert.equal(findTitle("text\r\n# Heading with CRLF\r\nmore"), "Heading with CRLF");
  assert.equal(findTitle("## not a level-one heading\n"), undefined);
});

test("findTitle: nothing usable gives undefined, and a Title key without a value does not borrow the next line", () => {
  assert.equal(findTitle(""), undefined);
  assert.equal(findTitle("no heading at all"), undefined);
  assert.equal(findTitle("# Title:\nnext line\n"), undefined);
  assert.equal(findTitle("# Title:   \n"), undefined);
});

test("findTitle: a very long line of spaces is read in linear time", () => {
  // The old patterns are quadratic on this shape; 300,000 spaces would have run for minutes.
  const started = Date.now();
  assert.equal(findTitle("# Title:" + " ".repeat(300000) + "a" + " ".repeat(300000) + "b"), "a" + " ".repeat(300000) + "b");
  assert.equal(findTitle("#" + " ".repeat(300000) + "x"), "x");
  assert.equal(findTitle("# Title:" + " ".repeat(300000)), undefined);
  assert.ok(Date.now() - started < 1000, "took " + (Date.now() - started) + " ms");
});

test("parseFindingFile: still rejects a file without a title and reads one with a title", () => {
  assert.throws(() => parseFindingFile("Bug class: reentrancy\n"), InputParseError);
  const fence = String.fromCharCode(96).repeat(3);
  const code = "## Code\n\n### contracts/Vault.sol\n" + fence + "solidity\nfunction withdraw() external {}\n" + fence + "\n";
  const f = parseFindingFile("# Title: Example\nBug class: reentrancy\nSeverity: High\n\n## Description\nText.\n\n## Exploit sketch\nSteps.\n\n" + code);
  assert.equal(f.title, "Example");
  assert.equal(f.severity, "High");
});
