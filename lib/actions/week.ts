"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "./require-user";
import { generateWeek as generateWeekInternal } from "@/lib/claude/generate";
import { refineWeek as refineWeekInternal } from "@/lib/claude/refine";
import { IntakeInputSchema } from "@/lib/claude/schemas";
import { nextPosition } from "@/lib/utils";
import type { WeekWithDays } from "@/lib/db/types";

export async function getActiveWeek(): Promise<WeekWithDays | null> {
  const { supabase, userId } = await requireUser();
  const { data, error } = await supabase
    .from("weeks")
    .select(
      "*, days:week_days(*, exercises:day_exercises(*, exercise:exercises(*, exercise_enrichment(seconds_per_set))))",
    )
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const week = data as unknown as WeekWithDays;
  week.days.sort((a, b) => a.day_index - b.day_index);
  for (const day of week.days) {
    day.exercises.sort((a, b) => a.position - b.position);
    // The displayed duration estimate previously always used a flat
    // fallback per set (reported live: sessions requested at 45 min were
    // showing as 20-30) because this query never joined enrichment at
    // all. Flatten exercise_enrichment (a to-one relation Postgrest can
    // return as an object or a single-element array depending on the
    // query shape) onto the exercise so DayCard can read a real value.
    for (const de of day.exercises) {
      type Raw = { seconds_per_set: number | null } | { seconds_per_set: number | null }[] | null;
      const raw = (de.exercise as unknown as { exercise_enrichment?: Raw }).exercise_enrichment;
      const enrichment = Array.isArray(raw) ? (raw[0] ?? null) : raw;
      (de.exercise as unknown as { seconds_per_set: number | null }).seconds_per_set =
        enrichment?.seconds_per_set ?? null;
    }
  }
  return week;
}

// Next.js redacts the real message of anything that *throws* out of a
// Server Action in a production build, replacing it with a generic
// "Server Components render" error with no detail — reported live via the
// refinement bar. submitIntake and refineWeekAction both need to surface
// real errors to the UI (tech spec §7.4: "says what failed... never
// 'something went wrong'"), so they catch their own errors and return
// them as data instead of letting them throw across the action boundary.
export interface ActionResult {
  error?: string;
}

export async function submitIntake(formData: FormData): Promise<ActionResult> {
  try {
    const { supabase, userId } = await requireUser();

    const raw = {
      goal: formData.get("goal"),
      focus_muscles: formData.getAll("focus_muscles"),
      days_per_week: Number(formData.get("days_per_week")),
      session_minutes: Number(formData.get("session_minutes")),
      notes: formData.get("notes") || undefined,
    };
    const intake = IntakeInputSchema.parse(raw);

    const { data: intakeRow, error } = await supabase
      .from("intakes")
      .insert({
        user_id: userId,
        goal: intake.goal,
        focus_muscles: intake.focus_muscles,
        days_per_week: intake.days_per_week,
        session_minutes: intake.session_minutes,
        notes: intake.notes ?? null,
      })
      .select()
      .single();
    if (error || !intakeRow) throw new Error(`Failed to save intake: ${error?.message}`);

    await generateWeekInternal(supabase, userId, intakeRow.id);
    revalidatePath("/week");
    return {};
  } catch (err) {
    console.error("submitIntake failed:", err);
    return { error: (err as Error).message || "Generation failed. Try again." };
  }
}

export async function refineWeekAction(weekId: string, message: string): Promise<ActionResult> {
  try {
    const { supabase, userId } = await requireUser();
    await refineWeekInternal(supabase, userId, weekId, message);
    revalidatePath("/week");
    return {};
  } catch (err) {
    console.error("refineWeekAction failed:", err);
    return { error: (err as Error).message || "Refinement failed. Try again." };
  }
}

/** Reorders exercises within one day to match `orderedIds`. Renumbers with
 * the standard 1000-gap rather than chasing single-row midpoint updates —
 * a drag already touches the whole day's array client-side, so this is the
 * simpler correct operation (tech spec §3's gapping is an optimization for
 * the case this bypasses, not a correctness requirement). */
export async function reorderDay(dayId: string, orderedIds: string[]) {
  const { supabase } = await requireUser();
  for (const [i, id] of orderedIds.entries()) {
    const { error } = await supabase
      .from("day_exercises")
      .update({ position: (i + 1) * 1000 })
      .eq("id", id)
      .eq("day_id", dayId);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/week");
}

/** Moves one exercise to a different day, then renumbers the destination
 * day to match `orderedIdsInDestination` (which includes the moved row). */
export async function moveExerciseToDay(
  dayExerciseId: string,
  toDayId: string,
  orderedIdsInDestination: string[],
) {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("day_exercises")
    .update({ day_id: toDayId })
    .eq("id", dayExerciseId);
  if (error) throw new Error(error.message);
  await reorderDay(toDayId, orderedIdsInDestination);
}

export async function updateExercise(
  id: string,
  fields: Partial<{ sets: number; reps: number; rest_seconds: number; weight_lb: number | null }>,
) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("day_exercises").update(fields).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/week");
}

export async function addExercise(dayId: string, exerciseId: string) {
  const { supabase } = await requireUser();
  const { data: existing, error: exErr } = await supabase
    .from("day_exercises")
    .select("position")
    .eq("day_id", dayId);
  if (exErr) throw new Error(exErr.message);

  // Adding to a rest day (name null) is how it becomes a training day.
  const { data: dayRow } = await supabase.from("week_days").select("name").eq("id", dayId).single();
  if (dayRow && !dayRow.name) {
    await supabase.from("week_days").update({ name: "Added exercises" }).eq("id", dayId);
  }

  const { error } = await supabase.from("day_exercises").insert({
    day_id: dayId,
    exercise_id: exerciseId,
    position: nextPosition(existing ?? []),
    sets: 3,
    reps: 10,
    rest_seconds: 60,
    weight_lb: null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/week");
}

export async function removeExercise(id: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("day_exercises").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/week");
}

export async function saveWorkout(dayId: string, name: string) {
  const { supabase, userId } = await requireUser();
  const { data: exercises, error: exErr } = await supabase
    .from("day_exercises")
    .select("exercise_id, sets, reps, rest_seconds, weight_lb")
    .eq("day_id", dayId)
    .order("position", { ascending: true });
  if (exErr) throw new Error(exErr.message);

  const { error } = await supabase.from("saved_workouts").insert({
    user_id: userId,
    name,
    exercises: exercises ?? [],
  });
  if (error) throw new Error(error.message);
  revalidatePath("/week");
}

export async function applyWorkout(savedId: string, dayId: string) {
  const { supabase } = await requireUser();
  const { data: saved, error: savedErr } = await supabase
    .from("saved_workouts")
    .select("exercises, name")
    .eq("id", savedId)
    .single();
  if (savedErr || !saved) throw new Error(savedErr?.message ?? "Saved workout not found");

  await supabase.from("day_exercises").delete().eq("day_id", dayId);
  await supabase.from("week_days").update({ name: saved.name }).eq("id", dayId);

  type Snapshot = { exercise_id: string; sets: number; reps: number; rest_seconds: number; weight_lb: number | null };
  const rows = (saved.exercises as Snapshot[]).map((ex, i) => ({
    day_id: dayId,
    exercise_id: ex.exercise_id,
    position: (i + 1) * 1000,
    sets: ex.sets,
    reps: ex.reps,
    rest_seconds: ex.rest_seconds,
    weight_lb: ex.weight_lb,
  }));
  if (rows.length > 0) {
    const { error } = await supabase.from("day_exercises").insert(rows);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/week");
}

export async function listSavedWorkouts() {
  const { supabase, userId } = await requireUser();
  const { data, error } = await supabase
    .from("saved_workouts")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}
