/**
 * Standalone LLM client. Uses the caller's own Anthropic API key — this tool
 * never makes a call on our account. No provider routing, no free-tier fallback:
 * one provider, one key, transparent cost.
 */

import Anthropic from "@anthropic-ai/sdk";

export interface CompleteOpts {
  system: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  model?: string;
}

const DEFAULT_MODEL = "claude-sonnet-5";

let client: Anthropic | null = null;

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export class MissingApiKeyError extends Error {
  constructor() {
    super(
      "ANTHROPIC_API_KEY is not set. Al-Mizaan Judge calls the Anthropic API with your own key — " +
        "export ANTHROPIC_API_KEY=sk-ant-... before running. Nothing runs on our account.",
    );
    this.name = "MissingApiKeyError";
  }
}

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new MissingApiKeyError();
  if (!client) client = new Anthropic({ apiKey });
  return client;
}

/** One completion. Throws on failure — the caller decides how to degrade. */
export async function complete(opts: CompleteOpts): Promise<string> {
  const resp = await getClient().messages.create({
    model: opts.model ?? DEFAULT_MODEL,
    max_tokens: opts.maxTokens ?? 4000,
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    system: opts.system,
    messages: [{ role: "user", content: opts.prompt }],
  });
  // Responses can include non-text blocks first (e.g. extended-thinking blocks) —
  // concatenate every text block rather than assuming content[0] is the text.
  return resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}
