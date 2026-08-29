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
  LoginData,
  Plan,
  PushDayResult,
  RawLibraryExercise,
  SpeedianceEnvelope,
} from "./types";

const TOKEN_EXPIRED_CODE = 91;

function baseUrl(): string {
  const region = process.env.SPEEDIANCE_REGION;
  if (!region) throw new Error("SPEEDIANCE_REGION is not configured");
  // Frozen: the CLI resolves region -> host; api2 is the confirmed GM2 host.
  const hosts: Record<string, string> = {
    us: "https://api2.speediance.com/api",
    eu: "https://api2-eu.speediance.com/api",
  };
  const url = hosts[region.toLowerCase()];
  if (!url) throw new Error(`Unknown SPEEDIANCE_REGION "${region}"`);
  return url;
}

function deviceType(): number {
  const raw = process.env.SPEEDIANCE_DEVICE_TYPE;
  if (!raw) throw new Error("SPEEDIANCE_DEVICE_TYPE is not configured");
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`SPEEDIANCE_DEVICE_TYPE "${raw}" is not numeric`);
  return n;
}

// Header set frozen to match the Android app byte-for-byte, per the CLI's
// own comments. Deviating risks the endpoint rejecting the request outright.
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
    Mobiledevices: "web",
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
    await withSession(email, password, (session) => {
      const totalCapacity = plan.exercises.reduce(
        (sum, ex) => sum + ex.sets.reduce((s, set) => s + set.reps * set.weight, 0),
        0,
      );

      const actionLibraryList = plan.exercises.map((ex) => {
        const reps = ex.sets.map((s) => s.reps).join(",");
        const weights = ex.sets.map((s) => s.weight.toFixed(1)).join(",");
        const rest = ex.sets.map((s) => String(s.rest ?? 60)).join(",");
        const mode = ex.sets.map((s) => String(s.mode ?? 1)).join(",");
        return {
          actionId: ex.id,
          title: ex.title,
          SetsAndReps: reps,
          Weights: weights,
          BreakTime: rest,
          BreakTime2: rest,
          SportMode: mode,
          LeftRight: ex.sets.map(() => "0").join(","),
        };
      });

      const payload = {
        name: plan.name,
        actionLibraryList,
        totalCapacity,
        deviceType: deviceType(),
        bgColor: "#2F5D50",
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
