"use client";

import { useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { DayCard } from "./DayCard";
import { RestDayRow } from "./RestDayRow";
import { ExerciseRow, type ExerciseRowData } from "./ExerciseRow";
import { SummaryBanner } from "./SummaryBanner";
import { RefinementBar } from "./RefinementBar";
import { PushDialog } from "./PushDialog";
import { SavedWorkouts } from "./SavedWorkouts";
import { reorderDay, moveExerciseToDay } from "@/lib/actions/week";
import { DAY_NAMES, type WeekWithDays } from "@/lib/db/types";

interface LocalDay {
  id: string;
  day_index: number;
  name: string | null;
  pushed_at: string | null;
  exercises: ExerciseRowData[];
}

function toLocalDays(week: WeekWithDays): LocalDay[] {
  return week.days.map((d) => ({
    id: d.id,
    day_index: d.day_index,
    name: d.name,
    pushed_at: d.pushed_at,
    exercises: d.exercises as ExerciseRowData[],
  }));
}

export function WeekBoard({ week }: { week: WeekWithDays }) {
  const [days, setDays] = useState<LocalDay[]>(() => toLocalDays(week));
  const [activeRow, setActiveRow] = useState<ExerciseRowData | null>(null);
  const [pushOpen, setPushOpen] = useState(false);
  const [undo, setUndo] = useState<{ snapshot: LocalDay[]; expiresAt: number } | null>(null);

  // Snapshot of `days` taken the moment a drag starts, read at drop time —
  // this is what "undo the last edit" restores, and how we tell whether a
  // drop moved an exercise to a different day. Ref, not state: it must not
  // itself trigger a render.
  const dragStartSnapshot = useRef<LocalDay[] | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );

  const trainingDays = useMemo(
    () => days.filter((d) => d.name && d.exercises.length > 0),
    [days],
  );

  function findDayOf(dayList: LocalDay[], exerciseRowId: string): LocalDay | undefined {
    return dayList.find((d) => d.exercises.some((e) => e.id === exerciseRowId));
  }

  function handleDragStart(event: DragStartEvent) {
    dragStartSnapshot.current = days;
    const day = findDayOf(days, String(event.active.id));
    const row = day?.exercises.find((e) => e.id === event.active.id) ?? null;
    setActiveRow(row);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    const fromDay = findDayOf(days, activeId);
    if (!fromDay) return;

    const overIsDay = days.some((d) => d.id === overId);
    const toDayId = overIsDay ? overId : findDayOf(days, overId)?.id;
    if (!toDayId || toDayId === fromDay.id) return;

    setDays((prev) => {
      const from = prev.find((d) => d.id === fromDay.id)!;
      const to = prev.find((d) => d.id === toDayId)!;
      const moving = from.exercises.find((e) => e.id === activeId);
      if (!moving) return prev;
      const insertAt = overIsDay
        ? to.exercises.length
        : to.exercises.findIndex((e) => e.id === overId);

      const nextTo = [...to.exercises];
      nextTo.splice(insertAt < 0 ? nextTo.length : insertAt, 0, { ...moving, day_id: to.id });

      return prev.map((d) => {
        if (d.id === from.id) return { ...d, exercises: d.exercises.filter((e) => e.id !== activeId) };
        if (d.id === to.id) return { ...d, exercises: nextTo };
        return d;
      });
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveRow(null);
    const snapshot = dragStartSnapshot.current;
    dragStartSnapshot.current = null;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    let workingDays = days;

    const currentDay = findDayOf(workingDays, activeId);
    if (!currentDay) return;

    const overIsDay = workingDays.some((d) => d.id === overId);
    if (!overIsDay) {
      const overDay = findDayOf(workingDays, overId);
      if (overDay && overDay.id === currentDay.id && activeId !== overId) {
        const oldIndex = currentDay.exercises.findIndex((e) => e.id === activeId);
        const newIndex = currentDay.exercises.findIndex((e) => e.id === overId);
        if (oldIndex !== -1 && newIndex !== -1) {
          workingDays = workingDays.map((d) =>
            d.id === currentDay.id
              ? { ...d, exercises: arrayMove(d.exercises, oldIndex, newIndex) }
              : d,
          );
          setDays(workingDays);
        }
      }
    }

    const settledDay = findDayOf(workingDays, activeId);
    if (!settledDay) return;
    const orderedIds = settledDay.exercises.map((e) => e.id);

    const originalDay = snapshot ? findDayOf(snapshot, activeId) : undefined;
    const movedAcrossDays = Boolean(originalDay && originalDay.id !== settledDay.id);

    const persist = movedAcrossDays
      ? moveExerciseToDay(activeId, settledDay.id, orderedIds)
      : reorderDay(settledDay.id, orderedIds);
    persist.catch(() => {
      // Best-effort: a failed persist leaves the optimistic local order in
      // place until the next full page load reconciles it. Acceptable for
      // a two-user app; worth a toast if this proves to matter in practice.
    });

    if (snapshot) {
      const expiresAt = Date.now() + 8000;
      setUndo({ snapshot, expiresAt });
      setTimeout(() => setUndo((u) => (u && u.expiresAt <= expiresAt + 1 ? null : u)), 8000);
    }
  }

  async function handleUndo() {
    if (!undo) return;
    const restore = undo.snapshot;
    setDays(restore);
    setUndo(null);
    for (const day of restore) {
      const ids = day.exercises.map((e) => e.id);
      if (ids.length === 0) continue;
      for (const id of ids) {
        await moveExerciseToDay(id, day.id, ids).catch(() => {});
      }
    }
  }

  return (
    <div className="flex flex-col gap-6 pb-24">
      <SummaryBanner summary={week.summary} />

      <DndContext
        // dnd-kit auto-generates ARIA announcement ids (DndDescribedBy-N)
        // off a module-level counter when none is given, which drifts
        // between the server render and the client's first render and
        // trips a hydration mismatch — reported live. A stable, explicit
        // id sidesteps the counter entirely.
        id="week-board"
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex flex-col gap-3">
          {days.map((day) =>
            day.name ? (
              <DayCard
                key={day.id}
                dayId={day.id}
                dayLabel={DAY_NAMES[day.day_index]}
                name={day.name}
                exercises={day.exercises}
                pushedAt={day.pushed_at}
              />
            ) : (
              <RestDayRow key={day.id} dayId={day.id} dayLabel={DAY_NAMES[day.day_index]} />
            ),
          )}
        </div>

        <DragOverlay>{activeRow ? <ExerciseRow row={activeRow} /> : null}</DragOverlay>
      </DndContext>

      <SavedWorkouts
        dayOptions={days.map((d) => ({
          id: d.id,
          label: d.name ? `${DAY_NAMES[d.day_index]} — ${d.name}` : `${DAY_NAMES[d.day_index]} (rest)`,
        }))}
      />

      <RefinementBar weekId={week.id} messages={week.refinement_messages} />

      {undo && (
        <div className="fixed bottom-20 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-md bg-ink px-4 py-2 text-[13px] text-paper shadow-lg">
          Moved.
          <button onClick={handleUndo} className="font-medium text-paper underline">
            Undo
          </button>
        </div>
      )}

      <div className="fixed bottom-14 left-0 right-0 z-10 border-t border-line bg-surface p-3">
        <div className="mx-auto max-w-2xl">
          <button
            onClick={() => setPushOpen(true)}
            className="h-12 w-full rounded-md bg-signal text-[16px] font-medium text-white"
          >
            Push week
          </button>
        </div>
      </div>

      {pushOpen && (
        <PushDialog
          weekId={week.id}
          trainingDays={trainingDays.map((d) => ({ id: d.id, name: d.name! }))}
          onClose={() => setPushOpen(false)}
        />
      )}
    </div>
  );
}
