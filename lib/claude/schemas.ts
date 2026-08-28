import { z } from "zod";

// Single source of truth for plan shapes. Model output is parsed through
// these before it touches the database; the same schemas back the
// TypeScript types used by the UI. Do not define plan shapes elsewhere.

export const GoalSchema = z.enum(["weight_loss", "muscle", "strength", "general"]);

export const IntakeInputSchema = z.object({
  goal: GoalSchema,
  focus_muscles: z.array(z.string()).default([]),
  days_per_week: z.number().int().min(1).max(7),
  session_minutes: z.number().int().min(15).max(120),
  notes: z.string().max(500).optional(),
});
export type IntakeInput = z.infer<typeof IntakeInputSchema>;

export const PlannedExerciseSchema = z.object({
  exercise_id: z.number().int(),
  sets: z.number().int().min(1).max(6),
  reps: z.number().int().min(1).max(50),
  rest_seconds: z.number().int().min(15).max(300),
  weight_lb: z.number().nullable(),
});
export type PlannedExercise = z.infer<typeof PlannedExerciseSchema>;

export const PlannedDaySchema = z.object({
  day_index: z.number().int().min(0).max(6),
  name: z.string().nullable(), // null = rest day
  exercises: z.array(PlannedExerciseSchema),
});
export type PlannedDay = z.infer<typeof PlannedDaySchema>;

export const WeekSchema = z.object({
  summary: z.string().max(400),
  days: z.array(PlannedDaySchema).length(7),
});
export type PlannedWeek = z.infer<typeof WeekSchema>;

// --- Enrichment (§5.1) -------------------------------------------------

export const EquipmentSchema = z.string(); // free text: handles | barbell | ... | none
export const MovementPatternSchema = z.enum([
  "push",
  "pull",
  "hinge",
  "squat",
  "lunge",
  "carry",
  "rotation",
  "isometric",
]);
export const ConfidenceSchema = z.enum(["high", "low"]);

export const EnrichedExerciseSchema = z.object({
  exercise_id: z.number().int(),
  equipment: EquipmentSchema,
  movement_pattern: MovementPatternSchema,
  is_compound: z.boolean(),
  is_unilateral: z.boolean(),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  secondary_muscles: z.array(z.string()).default([]),
  seconds_per_set: z.number().int().min(1).max(600),
  confidence: ConfidenceSchema,
});
export type EnrichedExercise = z.infer<typeof EnrichedExerciseSchema>;

export const EnrichmentBatchSchema = z.object({
  exercises: z.array(EnrichedExerciseSchema),
});

// --- Refinement (§5.3) --------------------------------------------------

export const RefinementInputSchema = z.object({
  weekId: z.string().uuid(),
  message: z.string().min(1).max(300),
});
export type RefinementInput = z.infer<typeof RefinementInputSchema>;
