#!/usr/bin/env tsx
// One-off catalog enrichment. Run manually, not on a schedule — tech spec §5.1.
//
//   npm run enrich-catalog                  # enrich every un-enriched row
//   npm run enrich-catalog -- --all         # re-enrich everything (idempotent)
//   npm run enrich-catalog -- --sample 50   # dump N rows weighted toward
//                                            # low confidence, for the human
//                                            # review gate (build order step 3)

import { createServiceRoleClient } from "@/lib/supabase/server";
import { enrichBatch, BATCH_SIZE } from "@/lib/claude/enrich";
import type { Exercise } from "@/lib/db/types";

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const sampleIdx = args.indexOf("--sample");
  const sampleN = sampleIdx >= 0 ? Number(args[sampleIdx + 1]) : null;

  const supabase = createServiceRoleClient();

  if (sampleN) {
    const { data, error } = await supabase
      .from("exercise_enrichment")
      .select("exercise_id, equipment, movement_pattern, is_compound, is_unilateral, difficulty, secondary_muscles, seconds_per_set, confidence, exercises(name, muscle, tab)")
      .order("confidence", { ascending: true }) // "low" sorts before "high" — weighted toward the rows the PRD wants reviewed
      .limit(sampleN);
    if (error) throw new Error(error.message);
    console.log(JSON.stringify(data, null, 2));
    console.log(`\n${(data ?? []).length} rows printed for human review. Do not trust enrichment for generation until these look right.`);
    return;
  }

  const { data: allExercises, error } = await supabase
    .from("exercises")
    .select("id, name, muscle, tab")
    .is("retired_at", null);
  if (error) throw new Error(error.message);
  console.log(`Found ${(allExercises ?? []).length} active (non-retired) exercises.`);

  let toEnrich = allExercises ?? [];
  if (!all) {
    const { data: enrichedIds, error: enrichedError } = await supabase
      .from("exercise_enrichment")
      .select("exercise_id");
    if (enrichedError) throw new Error(enrichedError.message);
    const enrichedSet = new Set((enrichedIds ?? []).map((r) => String(r.exercise_id)));
    console.log(`${enrichedSet.size} already have enrichment rows.`);
    toEnrich = toEnrich.filter((e: Pick<Exercise, "id" | "name" | "muscle" | "tab">) => !enrichedSet.has(String(e.id)));
  }

  if (toEnrich.length === 0) {
    console.log("Nothing to enrich.");
    return;
  }

  console.log(`Enriching ${toEnrich.length} exercises in batches of ${BATCH_SIZE}...`);

  const batches = chunk(toEnrich, BATCH_SIZE);
  let done = 0;
  for (const [i, batch] of batches.entries()) {
    const results = await enrichBatch(batch);
    const rows = results.map((r) => ({
      exercise_id: r.exercise_id,
      equipment: r.equipment,
      movement_pattern: r.movement_pattern,
      is_compound: r.is_compound,
      is_unilateral: r.is_unilateral,
      difficulty: r.difficulty,
      secondary_muscles: r.secondary_muscles,
      seconds_per_set: r.seconds_per_set,
      confidence: r.confidence,
      model: r.model,
      generated_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from("exercise_enrichment").upsert(rows, { onConflict: "exercise_id" });
    if (error) throw new Error(`Batch ${i + 1}/${batches.length} failed to save: ${error.message}`);
    done += batch.length;
    console.log(`Batch ${i + 1}/${batches.length} done (${done}/${toEnrich.length})`);
  }

  console.log(`Enriched ${done} exercises. Run with --sample 50 next and review before generation.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
