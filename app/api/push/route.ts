// Push is a route handler, not a server action (tech spec §6): it takes a
// password in the body, runs longer than a form submission should, and
// streams per-day progress back as newline-delimited JSON. It accepts
// {weekId, password, refreshCatalog?} and returns one JSON line per day
// plus a final summary line.
//
// This is the ONE Speediance-writing button in the app. Single-session
// constraint (PRD): authenticating here signs the user out of the
// Speediance mobile app, so this route must never run except in direct
// response to the user pressing Push week, and it pushes the whole week in
// one call rather than per-day.

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { pushWeek, pullCatalog } from "@/lib/speediance/client";
import { stripNonPrinting } from "@/lib/utils";
import type { Plan } from "@/lib/speediance/types";
import type { WeekWithDays } from "@/lib/db/types";

export const maxDuration = 60;

interface PushRequestBody {
  weekId: string;
  password: string;
  refreshCatalog?: boolean;
  /** Restrict this push to specific day ids — used by "Push remaining
   * days" after a partial failure, so the retry doesn't re-push days that
   * already landed. */
  dayIds?: string[];
}

function toPlan(day: WeekWithDays["days"][number]): Plan | null {
  if (!day.name || day.exercises.length === 0) return null; // rest day
  return {
    name: day.name,
    exercises: day.exercises.map((ex) => ({
      id: Number(ex.exercise_id),
      title: ex.exercise.name,
      sets: Array.from({ length: ex.sets }, () => ({
        reps: ex.reps,
        weight: ex.weight_lb ?? 0, // pounds, sent as-is — never converted (tech spec §4.2)
        mode: 1,
        rest: ex.rest_seconds,
      })),
    })),
  };
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Not signed in" }), { status: 401 });
  }

  const body = (await request.json()) as PushRequestBody;
  if (!body.weekId || !body.password) {
    return new Response(JSON.stringify({ error: "weekId and password are required" }), {
      status: 400,
    });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("speediance_email")
    .eq("id", user.id)
    .single();
  if (!profile?.speediance_email) {
    return new Response(
      JSON.stringify({ error: "No Speediance account email on file for this profile" }),
      { status: 400 },
    );
  }

  const { data: weekRow, error: weekError } = await supabase
    .from("weeks")
    .select("*, days:week_days(*, exercises:day_exercises(*, exercise:exercises(*)))")
    .eq("id", body.weekId)
    .eq("user_id", user.id)
    .single();
  if (weekError || !weekRow) {
    return new Response(JSON.stringify({ error: "Week not found" }), { status: 404 });
  }
  const week = weekRow as unknown as WeekWithDays;
  week.days.sort((a, b) => a.day_index - b.day_index);

  const email = profile.speediance_email;
  const password = body.password;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

      try {
        const trainingDays = week.days.filter(
          (d) => d.name && d.exercises.length > 0 && (!body.dayIds || body.dayIds.includes(d.id)),
        );
        const plans = trainingDays.map(toPlan).filter((p): p is Plan => p !== null);

        const results = await pushWeek(email, password, plans, (result) => {
          send({ type: "day", ...result });
        });

        const succeededNames = new Set(
          results.filter((r) => r.status === "success").map((r) => r.dayName),
        );
        for (const day of trainingDays) {
          if (day.name && succeededNames.has(day.name)) {
            await supabase
              .from("week_days")
              .update({ pushed_at: new Date().toISOString() })
              .eq("id", day.id);
          }
        }

        const allSucceeded = results.every((r) => r.status === "success");
        const anySucceeded = results.some((r) => r.status === "success");
        const status = allSucceeded ? "success" : anySucceeded ? "partial" : "failed";

        await supabase.from("push_log").insert({
          user_id: user.id,
          week_id: week.id,
          status,
          detail: results,
        });

        let refreshSummary: unknown = null;
        if (body.refreshCatalog) {
          try {
            const service = createServiceRoleClient();
            const { exercises } = await pullCatalog(email, password);
            const { data: existingIds } = await service.from("exercises").select("id");
            const existingSet = new Set((existingIds ?? []).map((r) => String(r.id)));
            const rows = exercises.map((e) => ({
              id: String(e.id),
              name: stripNonPrinting(String(e.name)),
              muscle: String(e.muscle),
              tab: String(e.tab),
              synced_at: new Date().toISOString(),
            }));
            await service.from("exercises").upsert(rows, { onConflict: "id" });
            const added = rows.filter((r) => !existingSet.has(r.id)).length;
            refreshSummary = { added, total: rows.length };
          } catch (err) {
            refreshSummary = { error: (err as Error).message };
          }
        }

        send({ type: "done", status, results, refresh: refreshSummary });
      } catch (err) {
        send({ type: "error", error: (err as Error).message });
        await supabase.from("push_log").insert({
          user_id: user.id,
          week_id: week.id,
          status: "failed",
          detail: { error: (err as Error).message },
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson" },
  });
}
