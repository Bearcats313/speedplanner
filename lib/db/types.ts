// Hand-written types mirroring supabase/migrations/0001_init.sql.
// Regenerate against a live project with `supabase gen types typescript`
// once one exists; keep this file as the fallback source of truth until then.

export type Tab =
  | "Training"
  | "Bodyweight"
  | "Recovery"
  | "Pilates-Mat"
  | "Warmup"
  | "HIIT"
  | "Stretch"
  | "Row & Ski";

export type Muscle =
  | "Abs"
  | "Quads"
  | "Glutes"
  | "Pecs"
  | "Lats"
  | "Triceps"
  | "Biceps"
  | "Full Body"
  | "Front Delts"
  | "Side Delts"
  | "Hamstrings"
  | "Rear Delts"
  | "Traps"
  | "Adductors"
  | "Calves"
  | "Forearms"
  | "Back Extensors";

export type MovementPattern =
  | "push"
  | "pull"
  | "hinge"
  | "squat"
  | "lunge"
  | "carry"
  | "rotation"
  | "isometric";

export type Confidence = "high" | "low";
export type Goal = "weight_loss" | "muscle" | "strength" | "general";
export type PushStatus = "success" | "partial" | "failed";

export interface Exercise {
  id: string; // bigint, carried as string end-to-end (see lib/utils.ts note)
  name: string;
  muscle: Muscle | string;
  tab: Tab | string;
  retired_at: string | null;
  synced_at: string;
}

export interface ExerciseEnrichment {
  exercise_id: string;
  equipment: string | null;
  movement_pattern: MovementPattern | null;
  is_compound: boolean | null;
  is_unilateral: boolean | null;
  difficulty: 1 | 2 | 3 | null;
  secondary_muscles: string[] | null;
  seconds_per_set: number | null;
  confidence: Confidence | null;
  model: string;
  generated_at: string;
}

export type ExerciseWithEnrichment = Exercise & {
  enrichment: ExerciseEnrichment | null;
};

export interface Profile {
  id: string;
  display_name: string;
  difficulty: 1 | 2 | 3;
  speediance_email: string | null;
  created_at: string;
}

export interface Intake {
  id: string;
  user_id: string;
  goal: Goal;
  focus_muscles: string[];
  days_per_week: number;
  session_minutes: number;
  notes: string | null;
  created_at: string;
}

export interface RefinementMessage {
  message: string;
  created_at: string;
}

export interface Week {
  id: string;
  user_id: string;
  intake_id: string | null;
  name: string;
  summary: string | null;
  refinement_messages: RefinementMessage[];
  is_active: boolean;
  created_at: string;
}

export interface WeekDay {
  id: string;
  week_id: string;
  day_index: number; // 0 = Monday
  name: string | null; // null = rest day
  pushed_at: string | null;
}

export interface DayExercise {
  id: string;
  day_id: string;
  exercise_id: string;
  position: number;
  sets: number;
  reps: number;
  rest_seconds: number;
  weight_lb: number | null;
}

export type DayWithExercises = WeekDay & {
  exercises: (DayExercise & { exercise: Exercise })[];
};

export type WeekWithDays = Week & { days: DayWithExercises[] };

export interface SavedWorkoutExerciseSnapshot {
  exercise_id: string;
  sets: number;
  reps: number;
  rest_seconds: number;
  weight_lb: number | null;
}

export interface SavedWorkout {
  id: string;
  user_id: string;
  name: string;
  exercises: SavedWorkoutExerciseSnapshot[];
  created_at: string;
}

export interface PushLogEntry {
  id: string;
  user_id: string;
  week_id: string | null;
  status: PushStatus;
  detail: unknown;
  created_at: string;
}

export const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;
