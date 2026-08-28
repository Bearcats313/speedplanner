// Types for the unofficial Speediance API. Derived from
// github.com/stozo04/speediance-cli (MIT) — internal/api and
// internal/template packages — and confirmed live against a GM2 account.
// See lib/speediance/client.ts for the MIT attribution and port notes.

export interface SpeedianceEnvelope<T> {
  Code: number; // 0 = success, 91 = token expired
  Data: T;
  Msg?: string;
}

export interface LoginData {
  Token: string;
  AppUserID: string | number;
}

/** Raw catalog row as returned by the library endpoints, before our schema
 * normalizes field names. */
export interface RawLibraryExercise {
  id: number | string;
  name: string; // from "title"
  muscle: string; // from "mainMuscleGroupName"
  tab: string;
}

export interface CatalogPullResult {
  exercises: RawLibraryExercise[];
  pulledAt: string;
}

// --- Program push (§4.2) -------------------------------------------------

export interface PlanSet {
  reps: number;
  weight: number; // pounds, sent as-is — see client.ts pushProgram()
  mode?: number; // 1 = standard
  rest?: number; // seconds
}

export interface PlanExercise {
  id: number;
  title: string;
  sets: PlanSet[];
}

export interface Plan {
  name: string;
  exercises: PlanExercise[];
}

export interface PushDayResult {
  dayName: string;
  status: "success" | "failed";
  error?: string;
}
