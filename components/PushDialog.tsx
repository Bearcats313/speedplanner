"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface DayStatus {
  dayId: string;
  dayName: string;
  status: "pending" | "success" | "failed";
  error?: string;
}

export function PushDialog({
  weekId,
  trainingDays,
  onClose,
}: {
  weekId: string;
  trainingDays: { id: string; name: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<"confirm" | "pushing" | "done">("confirm");
  const [password, setPassword] = useState("");
  const [refresh, setRefresh] = useState(false);
  const [statuses, setStatuses] = useState<DayStatus[]>(
    trainingDays.map((d) => ({ dayId: d.id, dayName: d.name, status: "pending" })),
  );
  const [error, setError] = useState<string | null>(null);
  const [refreshResult, setRefreshResult] = useState<string | null>(null);
  const [retryDayIds, setRetryDayIds] = useState<string[] | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);

  async function push(dayIds?: string[]) {
    setPhase("pushing");
    setError(null);
    if (!dayIds) {
      setStatuses(trainingDays.map((d) => ({ dayId: d.id, dayName: d.name, status: "pending" })));
    }

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekId, password, refreshCatalog: refresh, dayIds }),
        signal: controller.signal,
      });

      // A rejected request (not signed in, no weekId/password, no
      // Speediance email on the profile, week not found) short-circuits
      // before the route ever starts streaming and comes back as a plain
      // JSON error body, not NDJSON — read it as such rather than handing
      // it to the line-based parser below, which would silently drop it.
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Push failed (HTTP ${res.status})`);
      }
      if (!res.body) throw new Error("No response stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      function handleLine(line: string) {
        if (!line.trim()) return;
        const event = JSON.parse(line);
        if (event.type === "day") {
          setStatuses((prev) =>
            prev.map((s) =>
              s.dayName === event.dayName
                ? { ...s, status: event.status, error: event.error }
                : s,
            ),
          );
        } else if (event.type === "done") {
          setPhase("done");
          if (event.refresh?.added != null) {
            setRefreshResult(`Refresh: ${event.refresh.added} new, ${event.refresh.total} total.`);
          } else if (event.refresh?.error) {
            setRefreshResult(`Refresh failed: ${event.refresh.error}`);
          }
        } else if (event.type === "error") {
          setError(event.error);
          setPhase("done");
        }
      }

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) handleLine(line);
      }
      // The stream can end with a final line that has no trailing
      // newline — flush whatever's left in the buffer rather than
      // dropping it, which is what silently stalled the dialog before.
      if (buffer.trim()) handleLine(buffer);
      // Belt and suspenders: if the stream closed without ever sending a
      // "done" or "error" event (server crashed mid-push, connection cut),
      // don't leave the dialog stuck on "pending" forever either.
      setPhase((p) => (p === "pushing" ? "done" : p));
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setPhase("done");
    } finally {
      setPassword("");
    }
  }

  const failedDayIds = statuses.filter((s) => s.status === "failed").map((s) => s.dayId);

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="w-full max-w-sm rounded-t-lg bg-surface p-5 sm:rounded-lg">
        {phase === "confirm" && (
          <>
            <p className="text-[14px] font-medium text-flag">
              Pushing signs you out of the Speediance app. You&apos;ll need to sign back in there.
            </p>
            <label className="mt-4 flex flex-col gap-1">
              <span className="text-[13px] text-ink/70">Speediance password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="h-11 rounded-md border border-line bg-paper px-3 text-base text-ink outline-none focus-visible:border-signal"
              />
            </label>
            <label className="mt-3 flex items-center gap-2 text-[13px] text-ink/70">
              <input
                type="checkbox"
                checked={refresh}
                onChange={(e) => setRefresh(e.target.checked)}
              />
              Also check for new movements
            </label>
            <div className="mt-5 flex gap-2">
              <button
                onClick={onClose}
                className="h-11 flex-1 rounded-md border border-line text-[14px] text-ink"
              >
                Cancel
              </button>
              <button
                onClick={() => push(retryDayIds)}
                disabled={!password}
                className="h-11 flex-1 rounded-md bg-signal text-[14px] font-medium text-white disabled:opacity-50"
              >
                {retryDayIds ? "Push remaining days" : "Push week"}
              </button>
            </div>
          </>
        )}

        {(phase === "pushing" || phase === "done") && (
          <>
            <p className="text-[16px] font-medium text-ink">
              {phase === "pushing" ? "Pushing…" : "Pushed"}
            </p>
            <ul className="mt-3 flex flex-col gap-2">
              {statuses.map((s) => (
                <li key={s.dayId} className="flex items-center justify-between text-[14px]">
                  <span>{s.dayName}</span>
                  <span
                    className={
                      s.status === "success"
                        ? "text-signal"
                        : s.status === "failed"
                          ? "text-flag"
                          : "text-ink/40"
                    }
                  >
                    {s.status === "pending" ? "…" : s.status}
                  </span>
                </li>
              ))}
            </ul>
            {refreshResult && <p className="mt-3 text-[13px] text-ink/70">{refreshResult}</p>}
            {error && <p className="mt-3 text-[13px] text-flag">{error}</p>}

            {phase === "done" && (
              <div className="mt-5 flex gap-2">
                <button
                  onClick={onClose}
                  className="h-11 flex-1 rounded-md border border-line text-[14px] text-ink"
                >
                  Close
                </button>
                {failedDayIds.length > 0 && (
                  <button
                    onClick={() => {
                      setRetryDayIds(failedDayIds);
                      setPhase("confirm");
                    }}
                    className="h-11 flex-1 rounded-md bg-signal text-[14px] font-medium text-white"
                  >
                    Push remaining days
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
