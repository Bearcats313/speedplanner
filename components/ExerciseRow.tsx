"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { DayExercise, Exercise } from "@/lib/db/types";

export interface ExerciseRowData extends DayExercise {
  // seconds_per_set is flattened onto the exercise by getActiveWeek() from
  // its enrichment join, for the day's duration estimate — not a raw
  // catalog column.
  exercise: Exercise & { seconds_per_set?: number | null };
}

export function ExerciseRow({ row }: { row: ExerciseRowData }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
    data: { type: "exercise", dayId: row.day_id },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`flex min-h-11 items-center justify-between gap-3 border-b border-line py-2 last:border-b-0 ${
        isDragging ? "z-10 bg-surface opacity-90 shadow-md" : ""
      }`}
    >
      <span className="text-[16px] text-ink">{row.exercise.name}</span>
      <span className="tabular whitespace-nowrap text-right text-[14px] text-ink/80">
        <span className="mr-3">
          {row.sets} × {row.reps}
        </span>
        {row.weight_lb != null ? (
          // Starting-point guess, not a prescription — lighter weight than
          // the sets/reps figure it sits next to, per tech spec §7.1.
          <span className="font-light text-signal">{row.weight_lb} lb</span>
        ) : (
          <span className="text-ink/40">bodyweight</span>
        )}
      </span>
    </div>
  );
}
