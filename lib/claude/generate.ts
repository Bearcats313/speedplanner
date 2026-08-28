import type { SupabaseClient } from "@supabase/supabase-js";
import { anthropic, GENERATION_MODEL } from "./client";
import { selectCandidates, serializeCandidates } from "./candidates";
import { WeekSchema, type IntakeInput, type PlannedWeek } from "./schemas";
import { generationSystemPrompt, intakeSummary } from "./prompts";
import { toToolInputSchema } from "./tool-schema";
import type { WeekWithDays } from "@/lib/db/types";

const TOOL_NAME = "generate_week";

const WEEK_TOOL = {
  name: TOOL_NAME,
  description: "Return the generated week.",
  input_schema: toToolInputSchema(WeekSchema),
};

export class GenerationError extends Error {}

async function callClaude(
  system: string,
  userMessage: string,
  extraMessages: { role: "user" | "assistant"; content: string }[] = [],
): Promise<unknown> {
  const response = await anthropic().messages.create({
    model: GENERATION_MODEL,
    max_tokens: 8000,
    system,
    tools: [WEEK_TOOL],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages: [{ role: "user", content: userMessage }, ...extraMessages],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new GenerationError("Model did not return a tool call");
  }
  return toolUse.input;
}

function validateWeek(
  raw: unknown,
  candidateIds: Set<number>,
): { ok: true; week: PlannedWeek } | { ok: false; invalidIds: number[]; issue: string } {
  const parsed = WeekSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, invalidIds: [], issue: parsed.error.message };
  }
  const invalidIds = new Set<number>();
  for (const day of parsed.data.days) {
    for (const ex of day.exercises) {
      if (!candidateIds.has(ex.exercise_id)) invalidIds.add(ex.exercise_id);
    }
  }
  if (invalidIds.size > 0) {
    return { ok: false, invalidIds: Array.from(invalidIds), issue: "unknown exercise_id" };
  }
  return { ok: true, week: parsed.data };
}

async function generateWithRetry(
  system: string,
  userMessage: string,
  candidateIds: Set<number>,
): Promise<PlannedWeek> {
  const first = await callClaude(system, userMessage);
  const firstResult = validateWeek(first, candidateIds);
  if (firstResult.ok) return firstResult.week;

  const followUp =
    firstResult.invalidIds.length > 0
      ? `Your previous response used exercise_id values not in the candidate list: ${firstResult.invalidIds.join(", ")}. Every exercise_id must be copied exactly from the candidate list's first column. Return a corrected week.`
      : `Your previous response did not match the required schema (${firstResult.issue}). Return a corrected week via the ${TOOL_NAME} tool.`;

  const second = await callClaude(system, userMessage, [
    { role: "assistant", content: JSON.stringify(first) },
    { role: "user", content: followUp },
  ]);
  const secondResult = validateWeek(second, candidateIds);
  if (!secondResult.ok) {
    throw new GenerationError(
      secondResult.invalidIds.length > 0
        ? `Model returned invalid exercise IDs twice: ${secondResult.invalidIds.join(", ")}`
        : `Model returned an invalid week twice: ${secondResult.issue}`,
    );
  }
  return secondResult.week;
}

/** Generates a week from a saved intake, validates it, and writes week +
 * week_days + day_exercises. Writes are all-or-nothing: on any failure
 * partway through, the partially-created week is deleted (cascade removes
 * its days) rather than left half-saved. Tech spec §5.2, §6. */
export async function generateWeek(
  supabase: SupabaseClient,
  userId: string,
  intakeId: string,
): Promise<WeekWithDays> {
  const { data: intake, error: intakeError } = await supabase
    .from("intakes")
    .select("*")
    .eq("id", intakeId)
    .single();
  if (intakeError || !intake) throw new GenerationError("Intake not found");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("difficulty")
    .eq("id", userId)
    .single();
  if (profileError || !profile) throw new GenerationError("Profile not found");

  const intakeInput: IntakeInput = {
    goal: intake.goal,
    focus_muscles: intake.focus_muscles,
    days_per_week: intake.days_per_week,
    session_minutes: intake.session_minutes,
    notes: intake.notes ?? undefined,
  };

  const candidates = await selectCandidates(supabase, {
    goal: intakeInput.goal,
    focusMuscles: intakeInput.focus_muscles,
    difficulty: profile.difficulty,
  });
  if (candidates.length === 0) {
    throw new GenerationError(
      "No enriched candidate exercises match this intake. Run the enrichment script before generating.",
    );
  }
  const candidateIds = new Set(candidates.map((c) => Number(c.id)));

  const userMessage = [
    intakeSummary(intakeInput, profile.difficulty),
    "",
    `Only train on ${intakeInput.days_per_week} of the 7 days; the rest are rest days.`,
    "",
    "CANDIDATES",
    serializeCandidates(candidates),
  ].join("\n");

  const week = await generateWithRetry(generationSystemPrompt(), userMessage, candidateIds);

  return writeWeek(supabase, userId, intakeId, `Week of ${new Date().toLocaleDateString()}`, week);
}

/** Deactivates any currently-active week and writes the new one as active.
 * Exported separately so refine.ts can reuse it for in-place updates
 * (which delete+rewrite the same week id's days rather than touching
 * `weeks.is_active`). */
export async function writeWeek(
  supabase: SupabaseClient,
  userId: string,
  intakeId: string | null,
  name: string,
  week: PlannedWeek,
): Promise<WeekWithDays> {
  await supabase.from("weeks").update({ is_active: false }).eq("user_id", userId).eq("is_active", true);

  const { data: weekRow, error: weekError } = await supabase
    .from("weeks")
    .insert({ user_id: userId, intake_id: intakeId, name, summary: week.summary, is_active: true })
    .select()
    .single();
  if (weekError || !weekRow) throw new GenerationError(`Failed to save week: ${weekError?.message}`);

  try {
    const days = [];
    for (const day of week.days) {
      const { data: dayRow, error: dayError } = await supabase
        .from("week_days")
        .insert({ week_id: weekRow.id, day_index: day.day_index, name: day.name })
        .select()
        .single();
      if (dayError || !dayRow) throw new Error(dayError?.message ?? "day insert failed");

      const exerciseRows = day.exercises.map((ex, i) => ({
        day_id: dayRow.id,
        exercise_id: ex.exercise_id,
        position: (i + 1) * 1000,
        sets: ex.sets,
        reps: ex.reps,
        rest_seconds: ex.rest_seconds,
        weight_lb: ex.weight_lb,
      }));

      let insertedExercises: { id: string; exercise_id: string }[] = [];
      if (exerciseRows.length > 0) {
        const { data, error } = await supabase.from("day_exercises").insert(exerciseRows).select();
        if (error) throw new Error(error.message);
        insertedExercises = data ?? [];
      }
      days.push({ ...dayRow, exercises: insertedExercises });
    }
    return { ...weekRow, days } as unknown as WeekWithDays;
  } catch (err) {
    // Partial failure: never leave a half-written week around (tech spec §10).
    await supabase.from("weeks").delete().eq("id", weekRow.id);
    throw new GenerationError(`Failed to save week, rolled back: ${(err as Error).message}`);
  }
}
