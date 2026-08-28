import type { SupabaseClient } from "@supabase/supabase-js";
import { anthropic, GENERATION_MODEL } from "./client";
import { selectCandidates, serializeCandidates } from "./candidates";
import { WeekSchema, type PlannedWeek } from "./schemas";
import { refinementSystemPrompt } from "./prompts";
import { toToolInputSchema } from "./tool-schema";
import { GenerationError } from "./generate";
import type { WeekWithDays } from "@/lib/db/types";

const TOOL_NAME = "generate_week";
const MAX_STORED_MESSAGES = 3;
const WEEK_TOOL = {
  name: TOOL_NAME,
  description: "Return the refined week.",
  input_schema: toToolInputSchema(WeekSchema),
};

function currentWeekAsPlan(week: WeekWithDays): PlannedWeek {
  return {
    summary: week.summary ?? "",
    days: week.days
      .slice()
      .sort((a, b) => a.day_index - b.day_index)
      .map((d) => ({
        day_index: d.day_index,
        name: d.name,
        exercises: d.exercises
          .slice()
          .sort((a, b) => a.position - b.position)
          .map((e) => ({
            exercise_id: Number(e.exercise_id),
            sets: e.sets,
            reps: e.reps,
            rest_seconds: e.rest_seconds,
            weight_lb: e.weight_lb,
          })),
      })),
  };
}

function daysEqual(a: PlannedWeek["days"][number], b: PlannedWeek["days"][number]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** One round trip: apply `message` to the active week. Tech spec §5.3. */
export async function refineWeek(
  supabase: SupabaseClient,
  userId: string,
  weekId: string,
  message: string,
): Promise<WeekWithDays> {
  const { data: weekRow, error: weekError } = await supabase
    .from("weeks")
    .select("*, days:week_days(*, exercises:day_exercises(*, exercise:exercises(*)))")
    .eq("id", weekId)
    .eq("user_id", userId)
    .single();
  if (weekError || !weekRow) throw new GenerationError("Week not found");
  const week = weekRow as unknown as WeekWithDays;

  const { data: intake } = week.intake_id
    ? await supabase.from("intakes").select("*").eq("id", week.intake_id).single()
    : { data: null };
  const { data: profile } = await supabase
    .from("profiles")
    .select("difficulty")
    .eq("id", userId)
    .single();

  const candidates = await selectCandidates(supabase, {
    goal: intake?.goal ?? "general",
    focusMuscles: intake?.focus_muscles ?? [],
    difficulty: profile?.difficulty ?? 2,
  });
  const candidateIds = new Set(candidates.map((c) => Number(c.id)));

  const current = currentWeekAsPlan(week);

  const userMessage = [
    "CURRENT WEEK (JSON)",
    JSON.stringify(current),
    "",
    "INTAKE",
    intake ? JSON.stringify(intake) : "none on file",
    "",
    "CANDIDATES",
    serializeCandidates(candidates),
    "",
    "INSTRUCTION",
    message,
  ].join("\n");

  const response = await anthropic().messages.create({
    model: GENERATION_MODEL,
    max_tokens: 8000,
    system: refinementSystemPrompt(),
    tools: [WEEK_TOOL],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages: [{ role: "user", content: userMessage }],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new GenerationError("Model did not return a tool call");
  }

  const parsed = WeekSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    throw new GenerationError(`Refinement returned an invalid week: ${parsed.error.message}`);
  }

  const invalidIds = parsed.data.days
    .flatMap((d) => d.exercises)
    .map((e) => e.exercise_id)
    .filter((id) => !candidateIds.has(id));
  if (invalidIds.length > 0) {
    throw new GenerationError(`Refinement used unknown exercise IDs: ${invalidIds.join(", ")}`);
  }

  // Belt-and-suspenders: keep the model's proposed day when it changed,
  // otherwise force the original bytes back, so a day the instruction
  // didn't plausibly touch can never drift even from formatting noise.
  const reconciledDays = parsed.data.days.map((proposed) => {
    const original = current.days.find((d) => d.day_index === proposed.day_index);
    if (!original) return proposed;
    return daysEqual(original, proposed) ? original : proposed;
  });
  const reconciled: PlannedWeek = { summary: parsed.data.summary, days: reconciledDays };

  const messages = [
    ...week.refinement_messages,
    { message, created_at: new Date().toISOString() },
  ].slice(-MAX_STORED_MESSAGES);

  // Rewrite in place: delete this week's days and reinsert, keeping the
  // same week id (and therefore is_active) rather than creating a new week.
  await supabase.from("week_days").delete().eq("week_id", weekId);
  await supabase
    .from("weeks")
    .update({ summary: reconciled.summary, refinement_messages: messages })
    .eq("id", weekId);

  const rewritten = await writeWeekDaysOnly(supabase, weekId, reconciled);
  return { ...week, summary: reconciled.summary, refinement_messages: messages, days: rewritten };
}

async function writeWeekDaysOnly(
  supabase: SupabaseClient,
  weekId: string,
  week: PlannedWeek,
): Promise<WeekWithDays["days"]> {
  const days: WeekWithDays["days"] = [];
  for (const day of week.days) {
    const { data: dayRow, error: dayError } = await supabase
      .from("week_days")
      .insert({ week_id: weekId, day_index: day.day_index, name: day.name })
      .select()
      .single();
    if (dayError || !dayRow) throw new GenerationError(`Failed to save refined day: ${dayError?.message}`);

    const exerciseRows = day.exercises.map((ex, i) => ({
      day_id: dayRow.id,
      exercise_id: ex.exercise_id,
      position: (i + 1) * 1000,
      sets: ex.sets,
      reps: ex.reps,
      rest_seconds: ex.rest_seconds,
      weight_lb: ex.weight_lb,
    }));

    let inserted: unknown[] = [];
    if (exerciseRows.length > 0) {
      const { data, error } = await supabase
        .from("day_exercises")
        .insert(exerciseRows)
        .select("*, exercise:exercises(*)");
      if (error) throw new GenerationError(`Failed to save refined exercises: ${error.message}`);
      inserted = data ?? [];
    }
    days.push({ ...dayRow, exercises: inserted } as WeekWithDays["days"][number]);
  }
  return days;
}
