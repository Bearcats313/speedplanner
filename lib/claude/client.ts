import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

/** Server-only. The API key never reaches the browser. */
export function anthropic(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

// Pin explicit versions everywhere a model is named — see the claude-api
// skill. Generation/refinement need strong instruction-following against a
// large structured system prompt; enrichment is high-volume and simpler.
export const GENERATION_MODEL = "claude-sonnet-5" as const;
export const ENRICHMENT_MODEL = "claude-sonnet-5" as const;
