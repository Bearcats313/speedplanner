"use client";

import { useDroppable } from "@dnd-kit/core";

export function RestDayRow({ dayId, dayLabel }: { dayId: string; dayLabel: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: dayId, data: { type: "day", dayId } });

  return (
    <div
      ref={setNodeRef}
      className={`flex h-8 items-center border-b ${isOver ? "border-signal" : "border-line"}`}
    >
      <span className="text-[13px] text-ink/50">{dayLabel}</span>
    </div>
  );
}
