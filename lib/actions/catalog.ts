"use server";

import { requireUser } from "./require-user";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { pullCatalog } from "@/lib/speediance/client";
import { stripNonPrinting } from "@/lib/utils";

export interface RefreshResult {
  added: number;
  changed: number;
  unchanged: number;
  retired: number;
  pendingEnrichment: number;
}

/** Diffs a live pull against the stored catalog and upserts. Costs a
 * Speediance logout — never called except from the push dialog's checkbox
 * or the library screen's explicit refresh control (tech spec §4.4). The
 * password is taken as a parameter and never written anywhere. */
export async function refreshCatalog(email: string, password: string): Promise<RefreshResult> {
  await requireUser(); // must be signed in to the app; Speediance creds are separate
  const service = createServiceRoleClient();

  const { exercises } = await pullCatalog(email, password);
  if (exercises.length === 0) throw new Error("Speediance returned an empty catalog — aborting refresh");

  const { data: existingRows, error: existingError } = await service
    .from("exercises")
    .select("id, name, muscle, tab, retired_at");
  if (existingError) throw new Error(existingError.message);
  const existingById = new Map((existingRows ?? []).map((r) => [String(r.id), r]));

  let added = 0;
  let changed = 0;
  let unchanged = 0;
  const upserts: { id: string; name: string; muscle: string; tab: string; synced_at: string }[] = [];
  const pulledIds = new Set<string>();

  for (const raw of exercises) {
    const id = String(raw.id).trim();
    pulledIds.add(id);
    const name = stripNonPrinting(String(raw.name));
    const muscle = String(raw.muscle).trim();
    const tab = String(raw.tab).trim();

    const existing = existingById.get(id);
    if (!existing) {
      added++;
      upserts.push({ id, name, muscle, tab, synced_at: new Date().toISOString() });
    } else if (existing.name !== name || existing.muscle !== muscle || existing.tab !== tab || existing.retired_at) {
      changed++;
      upserts.push({ id, name, muscle, tab, synced_at: new Date().toISOString() });
    } else {
      unchanged++;
    }
  }

  if (upserts.length > 0) {
    const { error } = await service.from("exercises").upsert(
      upserts.map((u) => ({ ...u, retired_at: null })),
      { onConflict: "id" },
    );
    if (error) throw new Error(error.message);
  }

  const toRetire = Array.from(existingById.values())
    .filter((r) => !r.retired_at && !pulledIds.has(String(r.id)))
    .map((r) => r.id);
  if (toRetire.length > 0) {
    const { error } = await service
      .from("exercises")
      .update({ retired_at: new Date().toISOString() })
      .in("id", toRetire);
    if (error) throw new Error(error.message);
  }

  // New rows arrive with no enrichment, which excludes them from generation
  // candidates until someone runs the enrichment script — tech spec §4.4.
  const newIds = upserts.filter((u) => !existingById.has(u.id)).map((u) => u.id);
  let pendingEnrichment = 0;
  if (newIds.length > 0) {
    const { data: enrichedNew } = await service
      .from("exercise_enrichment")
      .select("exercise_id")
      .in("exercise_id", newIds);
    pendingEnrichment = newIds.length - (enrichedNew ?? []).length;
  }

  return { added, changed, unchanged, retired: toRetire.length, pendingEnrichment };
}
