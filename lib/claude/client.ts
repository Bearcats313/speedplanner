import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

/** Server-only. The API key never reaches the browser.
 *
 * ANTHROPIC_WORKSPACE_ID is optional and only needed for an
 * identity-linked API key (an org using Anthropic identity federation,
 * where a key isn't scoped to one workspace by itself) — such a key gets
 * a 400 "anthropic-workspace-id is required" on every call without it. A
 * classic API key doesn't need this at all; leave it unset. */
export function anthropic(): Anthropic {
  if (!client) {
    const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
    client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      defaultHeaders: workspaceId ? { "anthropic-workspace-id": workspaceId } : undefined,
    });
  }
  return client;
}

// Pin explicit versions everywhere a model is named — see the claude-api
// skill. Generation/refinement need strong instruction-following against a
// large structured system prompt; enrichment is high-volume and simpler.
export const GENERATION_MODEL = "claude-sonnet-5" as const;
export const ENRICHMENT_MODEL = "claude-sonnet-5" as const;
