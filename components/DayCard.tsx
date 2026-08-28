"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ExerciseRow, type ExerciseRowData } from "./ExerciseRow";
import { dayDurationSeconds, formatDuration } from "@/lib/utils";
import { saveWorkout } from "@/lib/actions/week";

export function DayCard({
  dayId,
  dayLabel,
  name,
  exercises,
  pushedAt,
}: {
  dayId: string;
  dayLabel: string;
  name: string;
  exercises: ExerciseRowData[];
  pushedAt: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dayId, data: { type: "day", dayId } });
  const durationSeconds = dayDurationSeconds(
    exercises.map((e) => ({ sets: e.sets, rest_seconds: e.rest_seconds, seconds_per_set: null })),
  );

  return (
    <div
      ref={setNodeRef}
      className={`rounded-md border bg-surface p-4 ${isOver ? "border-signal" : "border-line"}`}
    >
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-[13px] text-ink/50">{dayLabel}</div>
          <h2 className="font-display text-[20px] font-semibold text-ink">{name}</h2>
        </div>
        <div className="tabular text-right text-[14px] text-ink/70">
          {formatDuration(durationSeconds)}
          {pushedAt && <div className="text-[13px] text-signal">Pushed</div>}
        </div>
      </div>

      {exercises.length > 0 && (
        <button
          onClick={async () => {
            const workoutName = window.prompt("Save this day as a reusable workout named:", name);
            if (workoutName) await saveWorkout(dayId, workoutName);
          }}
          className="mt-2 text-[13px] font-medium text-ink/60 underline"
        >
          Save as workout
        </button>
      )}

      <SortableContext items={exercises.map((e) => e.id)} strategy={verticalListSortingStrategy}>
        <div className="mt-3">
          {exercises.length === 0 ? (
            <p className="py-4 text-center text-[13px] text-ink/40">Drop an exercise here</p>
          ) : (
            exercises.map((row) => <ExerciseRow key={row.id} row={row} />)
          )}
        </div>
      </SortableContext>
    </div>
  );
}
