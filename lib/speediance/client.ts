// Speediance API client — TypeScript port.
//
// There is no official API or documentation. The endpoints, headers, auth
// flow, and program-creation payload here are derived from
// github.com/stozo04/speediance-cli, specifically its internal/api and
// internal/template packages (MIT License, Copyright (c) stozo04), ported
// rather than shelled out to since the Go binary will not run on Vercel.
//
//   MIT License — github.com/stozo04/speediance-cli
//   Permission is hereby granted, free of charge, to any person obtaining a
//   copy of this software and associated documentation files, to deal in
//   the Software without restriction, subject to the standard MIT terms.
//
// Confirmed against the GM2 account: catalog pull returns 883 exercises and
// a pushed program appears on the machine. Both GM2 ID schemes are accepted
// despite the CLI being built for GM1. See PRD "Single-session constraint"
// and tech spec §4.3 — every call here costs the user their Speediance
// mobile app session, so nothing in this file may run except in direct
// response to a user-initiated request. No background jobs, no polling.

import type {
  CatalogPullResult,
  GroupListEntry,
  LoginData,
  Plan,
  PushDayResult,
  RawLibraryExercise,
  SpeedianceEnvelope,
  UnilateralData,
} from "./types";

const TOKEN_EXPIRED_CODE = 91;

// Verified against internal/api/types.go's baseURLs map: exactly two keys,
// "Global" and "EU" (case-sensitive), with any unrecognized region falling
// back to Global — not "us"/"eu" as an earlier, source-derived-by-summary
// guess had it (the EU host in particular was a different domain entirely:
// api2-eu.speediance.com does not exist; the real one is euapi.speediance.com).
function baseUrl(): string {
  const hosts: Record<string, string> = {
    Global: "https://api2.speediance.com/api",
    EU: "https://euapi.speediance.com/api",
  };
  const region = process.env.SPEEDIANCE_REGION ?? "Global";
  if (!(region in hosts)) {
    console.warn(`SPEEDIANCE_REGION "${region}" is not "Global" or "EU" — falling back to Global, matching the CLI's own behavior.`);
  }
  return hosts[region] ?? hosts.Global;
}

function deviceType(): number {
  const raw = process.env.SPEEDIANCE_DEVICE_TYPE;
  if (!raw) throw new Error("SPEEDIANCE_DEVICE_TYPE is not configured");
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`SPEEDIANCE_DEVICE_TYPE "${raw}" is not numeric`);
  return n;
}

// Header set verified against internal/api/client.go's setHeaders(). The
// Mobiledevices value is a fixed device-fingerprint JSON string the Go
// client hardcodes for every request (spoofing an Android emulator) — an
// earlier, source-derived-by-summary guess had this as the placeholder
// string "web", which was wrong.
const MOBILE_DEVICES_FINGERPRINT =
  '{"brand":"google","device":"emulator64","deviceType":"sdk_gphone64","os":"","os_version":"31","manufacturer":"Google"}';

function baseHeaders(): Record<string, string> {
  return {
    "User-Agent": "Dart/3.9 (dart:io)",
    "Content-Type": "application/json",
    Timestamp: String(Date.now()),
    Utc_offset: "+0000",
    Timezone: "GMT",
    Versioncode: "40304",
    "Accept-Language": "en",
    App_type: "SOFTWARE",
    Mobiledevices: MOBILE_DEVICES_FINGERPRINT,
  };
}

export interface SpeedianceSession {
  token: string;
  appUserId: string;
}

/** In-memory, server-side token cache with a short TTL. Never persisted —
 * the password that produced it is never stored either. One authentication
 * covers every operation in a single planning session (tech spec §4.3). */
// Keyed by Speediance account email so two Speediance accounts (Brian's,
// Krista's) never share or clobber each other's cached token — the two
// app users are not necessarily the same as the two Speediance accounts.
class SessionCache {
  private sessions = new Map<string, { session: SpeedianceSession; expiresAt: number }>();
  private readonly ttlMs = 10 * 60 * 1000; // short TTL; re-auth costs a logout either way

  get(email: string): SpeedianceSession | null {
    const entry = this.sessions.get(email);
    if (!entry || Date.now() > entry.expiresAt) return null;
    return entry.session;
  }

  set(email: string, session: SpeedianceSession) {
    this.sessions.set(email, { session, expiresAt: Date.now() + this.ttlMs });
  }

  clear(email: string) {
    this.sessions.delete(email);
  }
}

// Module-level singleton. Each push/refresh request authenticates at most
// once per server process per TTL window — acceptable because a push is
// already a single user-initiated request that bundles every day.
const sessionCache = new SessionCache();

const REQUEST_TIMEOUT_MS = 20_000;

async function request<T>(
  path: string,
  init: RequestInit & { session?: SpeedianceSession | null } = {},
): Promise<T> {
  const { session, ...rest } = init;
  const headers: Record<string, string> = { ...baseHeaders(), ...(rest.headers as Record<string, string> | undefined) };
  if (session) {
    headers.Token = session.token;
    headers.App_user_id = String(session.appUserId);
  }

  // This is an unofficial, undocumented API — a wrong host or a dead
  // endpoint should fail loud, not hang the push dialog forever with no
  // signal. Every call gets a hard timeout for that reason.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, { ...rest, headers, signal: controller.signal });
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") {
      throw new Error(
        `Speediance API ${path} timed out after ${REQUEST_TIMEOUT_MS / 1000}s — check SPEEDIANCE_REGION and that the endpoint is reachable`,
      );
    }
    throw new Error(`Speediance API ${path} request failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }

  const url = `${baseUrl()}${path}`;
  const rawBody = await res.text();

  if (!res.ok) {
    console.error(`Speediance API ${url} -> HTTP ${res.status}. Body:\n${rawBody.slice(0, 2000)}`);
    throw new Error(`Speediance API ${path} responded ${res.status}`);
  }

  let envelope: SpeedianceEnvelope<T>;
  try {
    envelope = JSON.parse(rawBody) as SpeedianceEnvelope<T>;
  } catch {
    console.error(`Speediance API ${url} -> HTTP 200 but not JSON. Body:\n${rawBody.slice(0, 2000)}`);
    throw new Error(
      `Speediance API ${path} returned non-JSON: ${rawBody.slice(0, 200) || "(empty body)"}`,
    );
  }

  // This is a reverse-engineered, undocumented envelope shape. If code is
  // missing entirely, the real response doesn't match what was assumed —
  // log the full body server-side (it's Speediance's reply, not anything
  // of ours, so nothing sensitive in it) and put a snippet in the thrown
  // error too, so the actual shape is visible instead of guessed at again.
  if (envelope.code === undefined) {
    console.error(`Speediance API ${url} -> HTTP 200, no code field. Body:\n${rawBody.slice(0, 2000)}`);
    throw new Error(`Speediance API ${path} returned an unexpected shape: ${rawBody.slice(0, 300)}`);
  }
  if (envelope.code === TOKEN_EXPIRED_CODE) {
    const err = new Error("Speediance token expired") as Error & { expired: true };
    err.expired = true;
    throw err;
  }
  if (envelope.code !== 0) {
    throw new Error(envelope.message ?? `Speediance API ${path} returned code ${envelope.code}: ${rawBody.slice(0, 300)}`);
  }
  return envelope.data;
}

/** Authenticates and caches the token. Never logs or stores the password —
 * it is held only for the duration of this call.
 *
 * Body field casing (type/userIdentity/password) is a best-effort fix, not
 * yet confirmed live: a "Parameter error" response confirmed the response
 * envelope is lowercase/camelCase, not the PascalCase an earlier summary
 * of the CLI's Go source implied, and the request body is the most likely
 * place the same casing mistake also landed. If this still 400s, the raw
 * response (logged both server-side and in the push dialog, see request())
 * will show whichever field name is still wrong. */
async function login(email: string, password: string): Promise<SpeedianceSession> {
  await request<unknown>("/app/v2/login/verifyIdentity", {
    method: "POST",
    body: JSON.stringify({ type: 2, userIdentity: email }),
  });

  const data = await request<LoginData>("/app/v2/login/byPass", {
    method: "POST",
    body: JSON.stringify({ userIdentity: email, password, type: 2 }),
  });

  const session: SpeedianceSession = { token: data.token, appUserId: String(data.appUserId) };
  sessionCache.set(email, session);
  return session;
}

/** "Lazy login": reuse the cached token; authenticate only when there is
 * none cached, and retry once on a code-91 (expired) response. Every call
 * still requires the password be supplied by the caller for this operation
 * — it is never read from storage. */
async function withSession<T>(
  email: string,
  password: string,
  fn: (session: SpeedianceSession) => Promise<T>,
): Promise<T> {
  let session = sessionCache.get(email);
  if (!session) session = await login(email, password);

  try {
    return await fn(session);
  } catch (err) {
    if ((err as { expired?: boolean }).expired) {
      sessionCache.clear(email);
      const fresh = await login(email, password);
      return fn(fresh);
    }
    throw err;
  }
}

// --- Catalog (§4.4, PRD R1) ----------------------------------------------

interface TabListItem {
  tabId: string;
  name: string;
}
interface GroupListItem {
  id: number | string;
  title: string;
}
interface DetailItem {
  id: number | string;
  mainMuscleGroupName: string;
}

/** Pulls the full 883-exercise catalog. Costs a logout — call only from the
 * push dialog's "Also check for new movements" checkbox or the library
 * screen's explicit refresh control (tech spec §4.4), never on page load. */
export async function pullCatalog(email: string, password: string): Promise<CatalogPullResult> {
  return withSession(email, password, async (session) => {
    const dt = deviceType();
    const tabs = await request<TabListItem[]>(`/app/actionLibraryTab/list?deviceType=${dt}`, {
      session,
    });

    const collected = new Map<string, RawLibraryExercise>();

    for (const tab of tabs) {
      const groups = await request<GroupListItem[]>(
        `/app/actionLibraryGroup/trainingPartGroup?tabId=${tab.tabId}&deviceTypeList=${dt}`,
        { session },
      );

      const ids = groups.map((g) => String(g.id));
      for (let i = 0; i < ids.length; i += 50) {
        const chunk = ids.slice(i, i + 50);
        const qs = chunk.map((id) => `ids=${id}`).join("&");
        const details = await request<DetailItem[]>(`/app/actionLibraryGroup/list?${qs}`, {
          session,
        });
        const detailById = new Map(details.map((d) => [String(d.id), d]));

        for (const g of groups) {
          const key = String(g.id);
          if (!chunk.includes(key) || collected.has(key)) continue;
          const detail = detailById.get(key);
          collected.set(key, {
            id: g.id,
            name: g.title,
            muscle: detail?.mainMuscleGroupName ?? "",
            tab: tab.name,
          });
        }
      }
    }

    return { exercises: Array.from(collected.values()), pulledAt: new Date().toISOString() };
  });
}

// --- Program push (§4.2, §4.3) --------------------------------------------
//
// The payload shape below is verified against the literal struct tags in
// internal/template/template.go (Action, Payload, BuildPayload), not a
// summary of them — see tech spec §4.1/§4.2. A catalog id alone (what the
// app stores as an exercise's Speediance ID, called `groupId` here) is not
// postable by itself: the real API needs a resolved "variant" id
// (`actionLibraryId`) and whether the exercise is unilateral, both fetched
// fresh at push time via two lookup calls BuildPayload also makes. Skipping
// these was the actual, structural bug behind the earlier casing fixes
// getting login working but push still failing — those fixes were correct
// but incomplete.

/** GET .../actionLibraryGroup/list?ids=...&ids=... — maps each catalog id
 * (groupId) to its first variant's id (actionLibraryId), the id the push
 * payload actually needs. One call for every distinct exercise in the day. */
async function resolveVariantIds(
  session: SpeedianceSession,
  groupIds: string[],
): Promise<Map<string, string>> {
  const qs = groupIds.map((id) => `ids=${id}`).join("&");
  const rows = await request<GroupListEntry[]>(`/app/actionLibraryGroup/list?${qs}`, { session });
  const map = new Map<string, string>();
  for (const row of rows) {
    const variant = row.actionLibraryList?.[0];
    if (variant) map.set(String(row.id), String(variant.id));
  }
  return map;
}

/** GET .../actionLibraryGroup/<id>?isDisplay=1 — whether this exercise is
 * left/right (unilateral), which decides the leftRight CSV pattern below.
 * One call per distinct exercise; the real client does the same, no
 * batching endpoint exists for this. */
async function isUnilateral(session: SpeedianceSession, groupId: string): Promise<boolean> {
  const data = await request<UnilateralData>(`/app/actionLibraryGroup/${groupId}?isDisplay=1`, {
    session,
  });
  return data.isLeftRight === 1;
}

/** Pushes a single day's plan. Weight is sent exactly as stored — the app
 * keeps everything in pounds, and the Go CLI's kg-to-API multiplier (2.2)
 * must NOT be applied here; that constant exists only because the CLI's
 * public input is kilograms. Getting this wrong halves or doubles every
 * load. */
export async function pushProgram(
  email: string,
  password: string,
  plan: Plan,
): Promise<PushDayResult> {
  try {
    await withSession(email, password, async (session) => {
      const groupIds = Array.from(new Set(plan.exercises.map((ex) => String(ex.id))));

      const variantByGroupId = await resolveVariantIds(session, groupIds);

      // Sequential, matching the real client's own per-group loop — not a
      // hot path (a day has a handful of distinct exercises, not hundreds).
      const unilateralByGroupId = new Map<string, boolean>();
      for (const groupId of groupIds) {
        unilateralByGroupId.set(groupId, await isUnilateral(session, groupId));
      }

      let totalCapacity = 0;
      const actionLibraryList = plan.exercises.map((ex) => {
        const groupId = String(ex.id);
        const variantId = variantByGroupId.get(groupId);
        if (!variantId) {
          throw new Error(
            `Could not resolve exercise ${groupId} ("${ex.title}") to a Speediance variant — the local catalog may be stale; try refreshing it.`,
          );
        }
        const unilateral = unilateralByGroupId.get(groupId) ?? false;

        const reps: string[] = [];
        const breaks: string[] = [];
        const modes: string[] = [];
        const leftRight: string[] = [];
        const weights: string[] = [];
        let capacity = 0;

        ex.sets.forEach((set, i) => {
          const rest = set.rest ?? 60;
          reps.push(String(set.reps));
          breaks.push(String(rest));
          modes.push(String(set.mode ?? 1));
          leftRight.push(unilateral ? (i % 2 === 0 ? "1" : "2") : "0");
          weights.push(set.weight.toFixed(1));
          capacity += set.reps * set.weight;
        });

        totalCapacity += capacity;
        const ones = ex.sets.map(() => "1").join(",");
        const zeros = ex.sets.map(() => "0").join(",");

        // capacity/totalCapacity are plain numbers here. The Go source goes
        // to real effort (pyFloat) to render these as "1716.0" rather than
        // Go's default "1716", explicitly to match the Python tool's output
        // byte-for-byte — that's a self-imposed goal for diffing the two
        // implementations against each other, not a documented server
        // requirement, and 1716 vs 1716.0 is the same JSON number either
        // way to any standards-compliant parser. Worth revisiting only if
        // this exact field turns out to matter live.

        // Field order matches Action in template.go — not required for
        // correctness in JSON (key order is not semantic), kept only for
        // easy side-by-side diffing against the source if this needs
        // revisiting again.
        return {
          groupId: Number(groupId),
          actionLibraryId: Number(variantId),
          templatePresetId: -1,
          setsAndReps: reps.join(","),
          breakTime: breaks.join(","),
          breakTime2: breaks.join(","),
          sportMode: modes.join(","),
          leftRight: leftRight.join(","),
          selectCompletionMethod: ones,
          completionMethod: ones,
          countType: ones,
          weights: weights.join(","),
          counterweight2: "",
          level: zeros,
          capacity,
        };
      });

      const payload = {
        name: plan.name,
        actionLibraryList,
        totalCapacity,
        deviceType: deviceType(),
        // An int, always 0 in the real payload — not a hex color string.
        // The earlier "#2F5D50" here (this app's own signal color, of all
        // things) was never derived from the source at all.
        bgColor: 0,
      };

      return request("/app/v2/customTrainingTemplate", {
        method: "POST",
        body: JSON.stringify(payload),
        session,
      });
    });
    return { dayName: plan.name, status: "success" };
  } catch (err) {
    // Also land in the platform's function logs (Vercel, etc.) — the push
    // dialog shows this same message, but server logs are the better
    // place to see it alongside a stack trace when the message alone
    // isn't enough to diagnose an undocumented API.
    console.error(`Speediance push failed for "${plan.name}":`, err);
    return { dayName: plan.name, status: "failed", error: (err as Error).message };
  }
}

/** Pushes every day in the week, stopping to record — not retry — a
 * failure, and reports per-day status. One authentication for the whole
 * week (tech spec §4.3): the caller passes the same email/password through
 * every call in a batch and the session cache absorbs the repetition. */
export async function pushWeek(
  email: string,
  password: string,
  plans: Plan[],
  onDayResult?: (result: PushDayResult) => void,
): Promise<PushDayResult[]> {
  const results: PushDayResult[] = [];
  for (const plan of plans) {
    const result = await pushProgram(email, password, plan);
    results.push(result);
    onDayResult?.(result);
    if (result.status === "failed" && result.error?.includes("expired")) {
      // Token died mid-operation and re-auth also failed: stop and report
      // what landed rather than silently re-prompting (tech spec §4.3).
      break;
    }
  }
  return results;
}
