"use client";

import { useEffect, useState } from "react";
import { listSavedWorkouts, applyWorkout } from "@/lib/actions/week";
import type { SavedWorkout } from "@/lib/db/types";

export function SavedWorkouts({ dayOptions }: { dayOptions: { id: string; label: string }[] }) {
  const [workouts, setWorkouts] = useState<SavedWorkout[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    listSavedWorkouts()
      .then((rows) => setWorkouts(rows as SavedWorkout[]))
      .catch(() => setWorkouts([]));
  }, []);

  if (workouts.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-medium text-ink/70">Saved workouts</span>
      <ul className="flex flex-col divide-y divide-line rounded-md border border-line bg-surface">
        {workouts.map((w) => (
          <li key={w.id} className="relative flex items-center justify-between p-3">
            <span className="text-[14px] text-ink">{w.name}</span>
            <button
              onClick={() => setOpenId(openId === w.id ? null : w.id)}
              className="h-9 rounded-md border border-line px-3 text-[13px] font-medium text-ink"
            >
              Add to day
            </button>
            {openId === w.id && (
              <div className="absolute right-0 top-11 z-10 w-48 rounded-md border border-line bg-surface p-2 shadow-lg">
                {dayOptions.length === 0 ? (
                  <p className="p-2 text-[13px] text-ink/50">No active week</p>
                ) : (
                  dayOptions.map((d) => (
                    <button
                      key={d.id}
                      onClick={async () => {
                        setOpenId(null);
                        await applyWorkout(w.id, d.id);
                      }}
                      className="block w-full rounded px-2 py-2 text-left text-[13px] text-ink hover:bg-paper"
                    >
                      {d.label}
                    </button>
                  ))
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
