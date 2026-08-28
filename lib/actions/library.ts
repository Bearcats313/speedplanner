"use server";

import { requireUser } from "./require-user";
import { DAY_NAMES, type ExerciseWithEnrichment } from "@/lib/db/types";

export interface WeekDayOption {
  id: string;
  label: string;
}

/** Days of the currently active week, for the library's "add to day"
 * control. Includes rest days — adding an exercise to one is how a rest
 * day becomes a training day. */
export async function listWeekDayOptions(): Promise<WeekDayOption[]> {
  const { supabase, userId } = await requireUser();
  const { data: week } = await supabase
    .from("weeks")
    .select("id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (!week) return [];

  const { data: days, error } = await supabase
    .from("week_days")
    .select("id, day_index, name")
    .eq("week_id", week.id)
    .order("day_index", { ascending: true });
  if (error) throw new Error(error.message);

  return (days ?? []).map((d) => ({
    id: d.id,
    label: d.name ? `${DAY_NAMES[d.day_index]} — ${d.name}` : `${DAY_NAMES[d.day_index]} (rest)`,
  }));
}

const PAGE_SIZE = 50;

export interface LibraryFilters {
  query?: string;
  tab?: string;
  muscle?: string;
  page?: number; // 0-indexed
}

export interface LibraryPage {
  results: ExerciseWithEnrichment[];
  page: number;
  hasMore: boolean;
}

/** Reads `exercises`, never Speediance — tech spec §6, §10. Every screen
 * load and search keystroke stays local to Postgres. */
export async function searchLibrary(filters: LibraryFilters): Promise<LibraryPage> {
  const { supabase } = await requireUser();
  const page = filters.page ?? 0;

  let q = supabase
    .from("exercises")
    .select(
      "id, name, muscle, tab, retired_at, synced_at, exercise_enrichment(exercise_id, equipment, movement_pattern, is_compound, is_unilateral, difficulty, secondary_muscles, seconds_per_set, confidence, model, generated_at)",
      { count: "exact" },
    )
    .is("retired_at", null)
    .order("name", { ascending: true })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

  if (filters.query) q = q.ilike("name", `%${filters.query}%`);
  if (filters.tab) q = q.eq("tab", filters.tab);
  if (filters.muscle) q = q.eq("muscle", filters.muscle);

  const { data, error, count } = await q;
  if (error) throw new Error(error.message);

  type Row = {
    id: string;
    name: string;
    muscle: string;
    tab: string;
    retired_at: string | null;
    synced_at: string;
    exercise_enrichment: ExerciseWithEnrichment["enrichment"] | ExerciseWithEnrichment["enrichment"][] | null;
  };

  const results: ExerciseWithEnrichment[] = ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    name: r.name,
    muscle: r.muscle,
    tab: r.tab,
    retired_at: r.retired_at,
    synced_at: r.synced_at,
    enrichment: Array.isArray(r.exercise_enrichment)
      ? (r.exercise_enrichment[0] ?? null)
      : r.exercise_enrichment,
  }));

  return { results, page, hasMore: (count ?? 0) > (page + 1) * PAGE_SIZE };
}
