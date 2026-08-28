"use client";

import { useActionState } from "react";
import { signIn } from "@/lib/actions/auth";

const initialState = { error: undefined as string | undefined };

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(signIn, initialState);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-paper px-6">
      <div className="w-full max-w-sm">
        <h1 className="font-display text-[28px] font-semibold text-ink">Speediance planner</h1>
        <p className="mt-1 text-sm text-ink/70">Sign in to see your week.</p>

        <form action={formAction} className="mt-8 flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-[13px] text-ink/70">Email</span>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              className="h-11 rounded-md border border-line bg-surface px-3 text-base text-ink outline-none focus-visible:border-signal"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[13px] text-ink/70">Password</span>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="h-11 rounded-md border border-line bg-surface px-3 text-base text-ink outline-none focus-visible:border-signal"
            />
          </label>

          {state?.error && <p className="text-[13px] text-flag">{state.error}</p>}

          <button
            type="submit"
            disabled={pending}
            className="mt-2 h-11 rounded-md bg-signal text-[16px] font-medium text-white disabled:opacity-60"
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
