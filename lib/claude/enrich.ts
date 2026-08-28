import { anthropic, ENRICHMENT_MODEL } from "./client";
import { EnrichmentBatchSchema, type EnrichedExercise } from "./schemas";
import { toToolInputSchema } from "./tool-schema";
import type { Exercise } from "@/lib/db/types";

const TOOL_NAME = "enrich_batch";
const BATCH_SIZE = 40;

const ENRICH_TOOL = {
  name: TOOL_NAME,
  description: "Return derived fields for every exercise in this batch.",
  input_schema: toToolInputSchema(EnrichmentBatchSchema),
};

function systemPrompt(): string {
  return `You derive metadata for exercises in the Speediance Gym Monster catalog. For each exercise given, infer:

- equipment: the attachment/tool used (e.g. "handles", "barbell", "ankle straps", "tricep rope", "bench", "belt", "ski handles", "rowing bench"), or "none" for pure bodyweight.
- movement_pattern: one of push, pull, hinge, squat, lunge, carry, rotation, isometric.
- is_compound: true if the exercise moves more than one major joint, false for isolation.
- is_unilateral: true if one side of the body works independently (e.g. single-arm, single-leg).
- difficulty: 1 (beginner), 2 (intermediate), or 3 (advanced).
- secondary_muscles: other muscles meaningfully worked, beyond the primary muscle given. Can be empty.
- seconds_per_set: a realistic estimate of active time for one working set, including the rep execution (not rest). Typically 20-60.
- confidence: "high" ONLY when the exercise's name states the fact outright — for example "Barbell Squat" states equipment (barbell) and pattern (squat) directly. "low" for anything requiring judgment rather than a literal read of the name.

Return one object per exercise, in the same order given, via the ${TOOL_NAME} tool. No prose.`;
}

function serializeBatch(exercises: Pick<Exercise, "id" | "name" | "muscle" | "tab">[]): string {
  return exercises.map((e) => `${e.id}|${e.name}|${e.muscle}|${e.tab}`).join("\n");
}

export interface EnrichedResult extends EnrichedExercise {
  model: string;
}

/** Enriches one batch (~40 exercises) in a single call. Re-runnable and
 * idempotent per exercise — tech spec §5.1. The caller (scripts/enrich-
 * catalog.ts) upserts by exercise_id, so re-running with an improved
 * prompt simply overwrites prior rows. */
export async function enrichBatch(
  exercises: Pick<Exercise, "id" | "name" | "muscle" | "tab">[],
): Promise<EnrichedResult[]> {
  if (exercises.length > BATCH_SIZE) {
    throw new Error(`Batch of ${exercises.length} exceeds BATCH_SIZE (${BATCH_SIZE})`);
  }

  const response = await anthropic().messages.create({
    model: ENRICHMENT_MODEL,
    max_tokens: 8000,
    system: systemPrompt(),
    tools: [ENRICH_TOOL],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages: [
      {
        role: "user",
        content: `Exercises (id|name|muscle|tab), one per line:\n\n${serializeBatch(exercises)}`,
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Enrichment call did not return a tool call");
  }

  const parsed = EnrichmentBatchSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    throw new Error(`Enrichment batch failed validation: ${parsed.error.message}`);
  }

  const byId = new Map(exercises.map((e) => [Number(e.id), e]));
  const missing = exercises.filter((e) => !parsed.data.exercises.some((r) => r.exercise_id === Number(e.id)));
  if (missing.length > 0) {
    throw new Error(
      `Enrichment batch dropped ${missing.length} exercise(s): ${missing.map((m) => m.id).join(", ")}`,
    );
  }

  return parsed.data.exercises
    .filter((r) => byId.has(r.exercise_id))
    .map((r) => ({ ...r, model: ENRICHMENT_MODEL }));
}

export { BATCH_SIZE };
