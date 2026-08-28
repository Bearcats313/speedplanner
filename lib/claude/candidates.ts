import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExerciseWithEnrichment, Goal, Muscle } from "@/lib/db/types";

// Antagonist pairing so a "focus: chest" week still gets the pulling work
// that keeps a week balanced, per tech spec §5.2 "muscles covering the
// intake's focus areas plus the antagonists needed for a balanced week".
const ANTAGONISTS: Partial<Record<Muscle, Muscle[]>> = {
  Pecs: ["Lats", "Rear Delts"],
  Lats: ["Pecs", "Front Delts"],
  Quads: ["Hamstrings", "Glutes"],
  Hamstrings: ["Quads"],
  Biceps: ["Triceps"],
  Triceps: ["Biceps"],
  "Front Delts": ["Rear Delts", "Lats"],
  "Rear Delts": ["Front Delts", "Pecs"],
  Abs: ["Back Extensors"],
  "Back Extensors": ["Abs"],
};

function conditioningTabsFor(goal: Goal): string[] {
  const base = ["Training", "Warmup", "Stretch"];
  if (goal === "weight_loss" || goal === "general") return [...base, "Bodyweight", "HIIT"];
  return base;
}

export interface CandidateFilter {
  goal: Goal;
  focusMuscles: string[];
  difficulty: number; // profile.difficulty
}

/** Pre-filters the ~883-row catalog down to the ~150-250 candidates sent to
 * Claude, per tech spec §5.2. Never sends the full catalog — keeps the
 * prompt small and keeps generation from reaching for muscle groups /
 * disciplines outside what the plan needs. */
export async function selectCandidates(
  supabase: SupabaseClient,
  filter: CandidateFilter,
): Promise<ExerciseWithEnrichment[]> {
  const tabs = conditioningTabsFor(filter.goal);
  const muscles = new Set(filter.focusMuscles);
  for (const m of filter.focusMuscles) {
    for (const a of ANTAGONISTS[m as Muscle] ?? []) muscles.add(a);
  }

  const { data, error } = await supabase
    .from("exercises")
    .select(
      "id, name, muscle, tab, retired_at, synced_at, exercise_enrichment(exercise_id, equipment, movement_pattern, is_compound, is_unilateral, difficulty, secondary_muscles, seconds_per_set, confidence, model, generated_at)",
    )
    .in("tab", tabs)
    .is("retired_at", null)
    .not("exercise_enrichment", "is", null)
    .lte("exercise_enrichment.difficulty", filter.difficulty + 1)
    .limit(400);

  if (error) throw new Error(`Candidate query failed: ${error.message}`);

  type Row = {
    id: string;
    name: string;
    muscle: string;
    tab: string;
    retired_at: string | null;
    synced_at: string;
    exercise_enrichment: ExerciseWithEnrichment["enrichment"] | ExerciseWithEnrichment["enrichment"][] | null;
  };

  const rows = (data ?? []) as unknown as Row[];

  const withEnrichment: ExerciseWithEnrichment[] = rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      muscle: r.muscle,
      tab: r.tab,
      retired_at: r.retired_at,
      synced_at: r.synced_at,
      enrichment: Array.isArray(r.exercise_enrichment)
        ? (r.exercise_enrichment[0] ?? null)
        : r.exercise_enrichment,
    }))
    .filter((r) => r.enrichment !== null);

  // Always keep every Warmup/Stretch row regardless of muscle filter — a
  // session needs to open and close with something, per PRD R3, and those
  // tabs are small (63 and 40 rows) so this never blows the candidate budget.
  const always = withEnrichment.filter((e) => e.tab === "Warmup" || e.tab === "Stretch");
  const focused =
    muscles.size === 0
      ? withEnrichment
      : withEnrichment.filter((e) => muscles.has(e.muscle) || e.tab === "Warmup" || e.tab === "Stretch");

  const merged = new Map<string, ExerciseWithEnrichment>();
  for (const e of [...always, ...focused]) merged.set(e.id, e);

  return Array.from(merged.values()).slice(0, 250);
}

/** Compact pipe-delimited serialization, per tech spec §5.2 — not JSON
 * objects, to keep the prompt small. */
export function serializeCandidates(candidates: ExerciseWithEnrichment[]): string {
  return candidates
    .map((c) => {
      const e = c.enrichment;
      return [
        c.id,
        c.name,
        c.muscle,
        c.tab,
        e?.equipment ?? "unknown",
        e?.movement_pattern ?? "unknown",
        e?.is_compound ? "compound" : "isolation",
        `${e?.seconds_per_set ?? 40}s`,
      ].join("|");
    })
    .join("\n");
}
