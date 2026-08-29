"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitIntake } from "@/lib/actions/week";
import { GOALS, MUSCLES } from "@/lib/constants";
import { DAY_NAMES } from "@/lib/db/types";

export default function GeneratePage() {
  const router = useRouter();
  const [goal, setGoal] = useState(GOALS[3].value);
  const [focus, setFocus] = useState<string[]>([]);
  const [days, setDays] = useState(4);
  const [minutes, setMinutes] = useState(45);
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggleMuscle(m: string) {
    setFocus((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  }

  function submit() {
    setError(null);
    const formData = new FormData();
    formData.set("goal", goal);
    for (const m of focus) formData.append("focus_muscles", m);
    formData.set("days_per_week", String(days));
    formData.set("session_minutes", String(minutes));
    if (notes) formData.set("notes", notes);

    startTransition(async () => {
      const result = await submitIntake(formData);
      if (result.error) {
        setError(result.error);
      } else {
        router.push("/week");
      }
    });
  }

  if (pending) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink/70">Generating your week… this can take up to 20 seconds.</p>
        {DAY_NAMES.map((name) => (
          <div key={name} className="rounded-md border border-line bg-surface p-4">
            <div className="font-display text-[16px] font-medium text-ink/40">{name}</div>
            <div className="skeleton mt-3 h-3 w-3/4 rounded" />
            <div className="skeleton mt-2 h-3 w-1/2 rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-8">
      <h1 className="font-display text-[28px] font-semibold text-ink">Generate a week</h1>

      <section className="flex flex-col gap-2">
        <span className="text-[13px] font-medium text-ink/70">Goal</span>
        <div className="grid grid-cols-2 gap-2">
          {GOALS.map((g) => (
            <button
              key={g.value}
              type="button"
              onClick={() => setGoal(g.value)}
              className={`h-11 rounded-md border text-[14px] font-medium ${
                goal === g.value
                  ? "border-signal bg-signal text-white"
                  : "border-line bg-surface text-ink"
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <span className="text-[13px] font-medium text-ink/70">Focus muscles (optional)</span>
        <div className="flex flex-wrap gap-2">
          {MUSCLES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => toggleMuscle(m)}
              className={`h-9 rounded-full border px-3 text-[13px] ${
                focus.includes(m)
                  ? "border-signal bg-signal text-white"
                  : "border-line bg-surface text-ink"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </section>

      <section className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-ink/70">Days per week</span>
        <Stepper value={days} min={1} max={7} onChange={setDays} />
      </section>

      <section className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-ink/70">Session length (minutes)</span>
        <Stepper value={minutes} min={15} max={120} step={5} onChange={setMinutes} />
      </section>

      <section className="flex flex-col gap-2">
        <label className="text-[13px] font-medium text-ink/70" htmlFor="notes">
          Notes (optional)
        </label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Anything else Claude should know — an injury to work around, equipment you don't like, etc."
          className="rounded-md border border-line bg-surface p-3 text-[14px] text-ink outline-none focus-visible:border-signal"
        />
      </section>

      {error && (
        <p className="text-[13px] text-flag">
          {error} <button onClick={submit} className="underline">Try again</button>
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        className="h-12 rounded-md bg-signal text-[16px] font-medium text-white"
      >
        Generate week
      </button>
    </div>
  );
}

function Stepper({
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-3 tabular">
      <button
        type="button"
        aria-label="Decrease"
        onClick={() => onChange(Math.max(min, value - step))}
        className="flex h-11 w-11 items-center justify-center rounded-md border border-line bg-surface text-[18px]"
      >
        −
      </button>
      <span className="w-8 text-center text-[16px]">{value}</span>
      <button
        type="button"
        aria-label="Increase"
        onClick={() => onChange(Math.min(max, value + step))}
        className="flex h-11 w-11 items-center justify-center rounded-md border border-line bg-surface text-[18px]"
      >
        +
      </button>
    </div>
  );
}
