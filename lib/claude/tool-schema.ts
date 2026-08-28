import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";

/** Converts a zod schema (the single source of truth, per tech spec §2)
 * into the tool `input_schema` shape the Anthropic SDK expects, using zod
 * v4's built-in JSON Schema conversion. */
export function toToolInputSchema(schema: z.ZodType): Anthropic.Tool["input_schema"] {
  return z.toJSONSchema(schema, { target: "draft-7" }) as Anthropic.Tool["input_schema"];
}
