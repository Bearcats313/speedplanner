import type { DayExercise } from "@/lib/db/types";

/** Gap between positions within a day, per tech spec §3. A drag between two
 * neighbours becomes a single-row update instead of a renumber. */
export const POSITION_GAP = 1000;

export function nextPosition(existing: { position: number }[]): number {
  if (existing.length === 0) return POSITION_GAP;
  return Math.max(...existing.map((e) => e.position)) + POSITION_GAP;
}

/** Midpoint position for a drop between two rows. Callers must renumber the
 * whole day (see renumberPositions) when this returns a value indistinguishable
 * from one of its neighbours (gap collapsed below 1). */
export function midpointPosition(before: number | null, after: number | null): number {
  if (before === null && after === null) return POSITION_GAP;
  if (before === null) return after! - POSITION_GAP;
  if (after === null) return before + POSITION_GAP;
  return Math.floor((before + after) / 2);
}

export function positionGapCollapsed(before: number | null, after: number | null): boolean {
  if (before === null || after === null) return false;
  return after - before < 2;
}

export function renumberPositions<T extends { id: string }>(
  ordered: T[],
): { id: string; position: number }[] {
  return ordered.map((row, i) => ({ id: row.id, position: (i + 1) * POSITION_GAP }));
}

/** Estimated seconds for one exercise: work across all sets, rest between
 * sets (not after the last one), plus a fixed setup cost. Tech spec §5.2. */
export function exerciseDurationSeconds(
  sets: number,
  secondsPerSet: number,
  restSeconds: number,
): number {
  const SETUP_SECONDS = 45;
  return sets * secondsPerSet + Math.max(0, sets - 1) * restSeconds + SETUP_SECONDS;
}

export interface DurationInput {
  sets: number;
  rest_seconds: number;
  seconds_per_set: number | null;
}

const DEFAULT_SECONDS_PER_SET = 40;

export function dayDurationSeconds(exercises: DurationInput[]): number {
  return exercises.reduce(
    (sum, ex) =>
      sum +
      exerciseDurationSeconds(
        ex.sets,
        ex.seconds_per_set ?? DEFAULT_SECONDS_PER_SET,
        ex.rest_seconds,
      ),
    0,
  );
}

export function formatDuration(totalSeconds: number): string {
  const minutes = Math.round(totalSeconds / 60);
  return `${minutes} min`;
}

export function withinTolerance(actualSeconds: number, targetMinutes: number, tolerance = 0.15) {
  const targetSeconds = targetMinutes * 60;
  return Math.abs(actualSeconds - targetSeconds) <= targetSeconds * tolerance;
}

/** Strips zero-width and other non-printing characters. Applied on catalog
 * import — at least one name ships with a stray zero-width char. PRD R1. */
// Zero-width space/joiner/non-joiner, bidi marks and embeds, word joiner,
// and a BOM that lands mid-string. PowerShell's `>` redirect also writes a
// leading BOM on the whole file — that's handled separately at read time
// (scripts/import-catalog.ts), this only strips characters inside a name.
const NON_PRINTING_RE = new RegExp(
  "[\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\uFEFF]",
  "g",
);

export function stripNonPrinting(s: string): string {
  return s.replace(NON_PRINTING_RE, "").trim();
}

export function setsSummary(ex: Pick<DayExercise, "sets" | "reps">): string {
  return `${ex.sets} × ${ex.reps}`;
}
