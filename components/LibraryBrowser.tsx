"use client";

import { useEffect, useState, useTransition } from "react";
import { searchLibrary, listWeekDayOptions, type WeekDayOption } from "@/lib/actions/library";
import { addExercise } from "@/lib/actions/week";
import { TABS, MUSCLES } from "@/lib/constants";
import type { ExerciseWithEnrichment } from "@/lib/db/types";

export function LibraryBrowser() {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<string | null>(null);
  const [muscle, setMuscle] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [results, setResults] = useState<ExerciseWithEnrichment[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [dayOptions, setDayOptions] = useState<WeekDayOption[]>([]);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    listWeekDayOptions().then(setDayOptions).catch(() => setDayOptions([]));
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => {
      startTransition(async () => {
        const result = await searchLibrary({ query, tab: tab ?? undefined, muscle: muscle ?? undefined, page });
        setResults(result.results);
        setHasMore(result.hasMore);
      });
    }, 200);
    return () => clearTimeout(handle);
  }, [query, tab, muscle, page]);

  function clearFilters() {
    setQuery("");
    setTab(null);
    setMuscle(null);
    setPage(0);
  }

  async function handleAdd(exerciseId: string, dayId: string) {
    setAddingId(null);
    await addExercise(dayId, exerciseId);
  }

  return (
    <div className="flex flex-col gap-4 pb-8">
      <input
        autoFocus
        value={query}
        onChange={(e) => {
          setPage(0);
          setQuery(e.target.value);
        }}
        placeholder="Search movements"
        className="h-11 rounded-md border border-line bg-surface px-3 text-[16px] text-ink outline-none focus-visible:border-signal"
      />

      <div className="flex gap-2 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => {
              setPage(0);
              setTab(tab === t ? null : t);
            }}
            className={`h-8 shrink-0 rounded-full border px-3 text-[13px] ${
              tab === t ? "border-signal bg-signal text-white" : "border-line bg-surface text-ink"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {MUSCLES.map((m) => (
          <button
            key={m}
            onClick={() => {
              setPage(0);
              setMuscle(muscle === m ? null : m);
            }}
            className={`h-8 shrink-0 rounded-full border px-3 text-[13px] ${
              muscle === m ? "border-signal bg-signal text-white" : "border-line bg-surface text-ink"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      {!pending && results.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <p className="text-[14px] text-ink/70">No movements match.</p>
          <button onClick={clearFilters} className="text-[13px] font-medium text-ink underline">
            Clear filters
          </button>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-md border border-line bg-surface">
          {results.map((ex) => (
            <li key={ex.id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="truncate text-[16px] text-ink">{ex.name}</div>
                <div className="text-[13px] text-ink/50">
                  {ex.muscle} · {ex.tab}
                  {ex.enrichment?.equipment ? ` · ${ex.enrichment.equipment}` : ""}
                </div>
              </div>
              <div className="relative shrink-0">
                <button
                  onClick={() => setAddingId(addingId === ex.id ? null : ex.id)}
                  className="h-9 rounded-md border border-line px-3 text-[13px] font-medium text-ink"
                >
                  Add
                </button>
                {addingId === ex.id && (
                  <div className="absolute right-0 top-10 z-10 w-48 rounded-md border border-line bg-surface p-2 shadow-lg">
                    {dayOptions.length === 0 ? (
                      <p className="p-2 text-[13px] text-ink/50">No active week</p>
                    ) : (
                      dayOptions.map((d) => (
                        <button
                          key={d.id}
                          onClick={() => handleAdd(ex.id, d.id)}
                          className="block w-full rounded px-2 py-2 text-left text-[13px] text-ink hover:bg-paper"
                        >
                          {d.label}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {results.length > 0 && (page > 0 || hasMore) && (
        <div className="flex justify-between text-[13px]">
          <button
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="font-medium text-ink underline disabled:opacity-30"
          >
            Previous
          </button>
          <button
            disabled={!hasMore}
            onClick={() => setPage((p) => p + 1)}
            className="font-medium text-ink underline disabled:opacity-30"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
