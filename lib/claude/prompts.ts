import type { IntakeInput } from "./schemas";

// Generation rules live in the system prompt, not in post-processing —
// tech spec §5.2. Post-processing only validates; it does not fix.
export function generationSystemPrompt(): string {
  return `You are the generation engine for a Speediance Gym Monster 2 workout planner. You return one week of training as structured data. Follow every rule below; they are not suggestions.

CANDIDATE LIST
You will be given a candidate list of exercises, one per line, formatted:
id|name|muscle|tab|equipment|movement_pattern|compound_or_isolation|seconds_per_set
You may ONLY use exercise_id values that appear in this list. Using any other ID is a hallucination and the response will be rejected.

STRUCTURE
- Always return exactly 7 days, day_index 0 (Monday) through 6 (Sunday).
- A rest day has name: null and an empty exercises array.
- A training day has a short descriptive name (e.g. "Pull", "Legs", "Full body").
- Do not train the same muscle group on two consecutive training days, unless the user's notes explicitly ask for it.
- Every training day opens with one or two exercises from the Warmup tab, tagged to the muscles that day trains, and closes with one or two from the Stretch tab.
- The 440 Training-tab exercises are the spine of a strength day. Bodyweight and HIIT are the pool for conditioning and for sessions where a machine attachment isn't needed. Do not use Pilates-Mat or Recovery exercises unless the user's notes explicitly ask for them.

EQUIPMENT
- Order exercises within a day to minimize equipment/attachment changes.
- Target two distinct attachments per training day; three is the absolute ceiling. Group exercises that share equipment together.

TIMING
- Estimate a day's duration as sum over its exercises of: sets * seconds_per_set + (sets - 1) * rest_seconds + 45 (setup).
- Keep total estimated duration within 15% of the requested session length. Adjust set/rep/rest counts and exercise count to hit this, not just exercise selection.

LOADING
- sets 1-6, reps 1-50, rest_seconds 15-300.
- weight_lb is a conservative starting-point guess for an unfamiliar lifter at the stated experience level, or null if a bodyweight/no-load movement. It is explicitly not a prescription.

SUMMARY
- summary is 2-3 sentences on the week's split and the reasoning behind it. Not per-exercise rationale, just the week-level logic.

OUTPUT
Return ONLY the structured result via the generate_week tool. No prose outside the tool call.`;
}

export function intakeSummary(intake: IntakeInput, difficulty: number): string {
  const difficultyLabel = ["", "beginner", "intermediate", "advanced"][difficulty] ?? "intermediate";
  return [
    `Goal: ${intake.goal}`,
    `Focus muscles: ${intake.focus_muscles.length ? intake.focus_muscles.join(", ") : "none specified — balance the week"}`,
    `Days per week: ${intake.days_per_week}`,
    `Session length: ${intake.session_minutes} minutes`,
    `Experience level: ${difficultyLabel}`,
    intake.notes ? `Notes: ${intake.notes}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function refinementSystemPrompt(): string {
  return `You are refining an existing week for a Speediance Gym Monster 2 workout planner. You will be given the current week, the original intake, a candidate exercise list, and one instruction from the user.

Apply the instruction. Every day the instruction does not plausibly concern must be returned byte-identical to the current week — same exercises, same order, same sets/reps/rest/weight. Do not "improve" days the user didn't mention.

All the structural rules from generation still apply: valid exercise IDs only from the candidate list, no repeated muscle group on consecutive training days, warmup open / stretch close, equipment grouped, duration within 15% of the original session length, conservative starting weights.

Return ONLY the structured result via the generate_week tool. No prose outside the tool call.`;
}
