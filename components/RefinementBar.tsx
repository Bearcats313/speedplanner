"use client";

import { useState, useTransition } from "react";
import { refineWeekAction } from "@/lib/actions/week";
import type { RefinementMessage } from "@/lib/db/types";

export function RefinementBar({
  weekId,
  messages,
}: {
  weekId: string;
  messages: RefinementMessage[];
}) {
  const [value, setValue] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (!value.trim()) return;
    setError(null);
    const message = value;
    startTransition(async () => {
      const result = await refineWeekAction(weekId, message);
      if (result.error) {
        setError(result.error);
      } else {
        setValue("");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {messages.length > 0 && (
        <ul className="flex flex-col gap-1">
          {messages.slice(-3).map((m, i) => (
            <li key={i} className="text-[13px] text-ink/50">
              &ldquo;{m.message}&rdquo;
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Too much shoulder work. Swap Thursday for something shorter."
          disabled={pending}
          className="h-11 flex-1 rounded-md border border-line bg-surface px-3 text-[14px] text-ink outline-none focus-visible:border-signal"
        />
        <button
          onClick={submit}
          disabled={pending || !value.trim()}
          className="h-11 rounded-md border border-line px-4 text-[14px] font-medium text-ink disabled:opacity-50"
        >
          {pending ? "…" : "Send"}
        </button>
      </div>
      {error && <p className="text-[13px] text-flag">{error}</p>}
    </div>
  );
}
