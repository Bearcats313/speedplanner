#!/usr/bin/env tsx
// Imports the Speediance exercise catalog into Postgres.
//
// Input: the JSON produced by `speediance-cli library --json`, pulled by
// hand (the app itself never calls Speediance for this — see tech spec
// §4.4). Pass its path as the first argument, or pipe it on stdin.
//
//   npm run import-catalog -- ./library.json
//   speediance-cli library --json | npm run import-catalog
//
// Upserts by Speediance ID (never by name — nine names collide, PRD R1).
// Never deletes: a row that vanished from a re-pull is marked retired_at
// instead, since saved weeks reference it (tech spec §4.4).

import { readFileSync } from "node:fs";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { stripNonPrinting } from "@/lib/utils";
import type { RawLibraryExercise } from "@/lib/speediance/types";

const KNOWN_TABS = new Set([
  "Training",
  "Bodyweight",
  "Recovery",
  "Pilates-Mat",
  "Warmup",
  "HIIT",
  "Stretch",
  "Row & Ski",
]);

const BOM = String.fromCharCode(0xfeff);

function stripBom(s: string): string {
  return s.startsWith(BOM) ? s.slice(1) : s;
}

function readInput(argPath: string | undefined): string {
  if (argPath) {
    // PowerShell's `>` redirect writes UTF-16 with a BOM — decode explicitly
    // and strip the BOM rather than assuming UTF-8. PRD R1.
    const buf = readFileSync(argPath);
    if (buf[0] === 0xff && buf[1] === 0xfe) return stripBom(buf.toString("utf16le"));
    if (buf[0] === 0xfe && buf[1] === 0xff) return stripBom(buf.swap16().toString("utf16le"));
    return stripBom(buf.toString("utf8"));
  }
  return stripBom(readFileSync(0, "utf8"));
}

async function main() {
  const argPath = process.argv[2];
  const raw = readInput(argPath);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Input is not valid JSON: ${(err as Error).message}`);
  }

  const list: RawLibraryExercise[] = Array.isArray(parsed)
    ? (parsed as RawLibraryExercise[])
    : ((parsed as { exercises?: RawLibraryExercise[] }).exercises ?? []);

  if (list.length === 0) {
    throw new Error("No exercises found in input");
  }

  const seenIds = new Set<string>();
  const rows = list.map((e) => {
    const id = String(e.id).trim();
    if (seenIds.has(id)) throw new Error(`Duplicate exercise id in source: ${id}`);
    seenIds.add(id);

    const name = stripNonPrinting(String(e.name));
    const tab = String(e.tab).trim();
    if (!KNOWN_TABS.has(tab)) {
      console.warn(`Warning: unrecognized tab "${tab}" for exercise ${id} (${name})`);
    }
    return {
      id,
      name,
      muscle: String(e.muscle).trim(),
      tab,
      // Explicit, not omitted: being present in this pull means active,
      // so a row that was previously retired and has since reappeared
      // (or was wrongly retired, as by the bug this line fixes) comes
      // back — an upsert that leaves this column out of the payload
      // never touches it, so a retired row would stay retired forever.
      retired_at: null,
      synced_at: new Date().toISOString(),
    };
  });

  const supabase = createServiceRoleClient();

  // Upsert by id. Never touch exercise_enrichment (tech spec §10) and never
  // delete — mark rows absent from this pull as retired instead.
  const { error: upsertError } = await supabase
    .from("exercises")
    .upsert(rows, { onConflict: "id" });
  if (upsertError) throw new Error(`Upsert failed: ${upsertError.message}`);

  const { data: existingIds, error: existingError } = await supabase
    .from("exercises")
    .select("id")
    .is("retired_at", null);
  if (existingError) throw new Error(`Failed reading existing rows: ${existingError.message}`);

  const pulledIds = new Set(rows.map((r) => r.id));
  // Postgres bigint can come back from PostgREST as a JS number rather than
  // a string, so compare on String(r.id) — not r.id directly — or every
  // existing row looks "not in the pull" even right after upserting it.
  const toRetire = (existingIds ?? [])
    .map((r) => String(r.id))
    .filter((id) => !pulledIds.has(id));

  if (toRetire.length > 0) {
    const { error: retireError } = await supabase
      .from("exercises")
      .update({ retired_at: new Date().toISOString() })
      .in("id", toRetire);
    if (retireError) throw new Error(`Failed retiring rows: ${retireError.message}`);
  }

  console.log(`Imported ${rows.length} exercises. Retired ${toRetire.length} no longer in the pull.`);
  if (rows.length !== 883) {
    console.warn(
      `Note: expected 883 exercises per the PRD, got ${rows.length}. Not necessarily an error — the catalog can change — but worth a second look.`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
