# Speediance Workout Planner

Generates a weekly training plan against the real Speediance Gym Monster 2
exercise catalog, lets you edit it on your phone, and pushes it straight to
the machine. Built from `speediance-workout-planner-prd.md` and
`speediance-workout-planner-tech-spec.md` — read those first for the why and
the how; this file is just setup.

## Stack

Next.js 15 (App Router, TypeScript strict) · Supabase (Postgres + Auth) ·
Anthropic API · `@dnd-kit` for drag and drop. See tech spec §1.

## Setup

1. **Supabase project.** Create one, then run the migration:

   ```bash
   # via the Supabase CLI, or paste supabase/migrations/0001_init.sql
   # into the SQL editor
   supabase db push
   ```

   Create the two accounts by hand (Supabase Auth → Users → Add user). No
   self-service signup route exists — PRD R9.

2. **Environment.** Copy `.env.example` to `.env.local` and fill in:
   - `ANTHROPIC_API_KEY`
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — project settings → API
   - `SUPABASE_SERVICE_ROLE_KEY` — used only by `scripts/*.ts`, never bundled into the app
   - `SPEEDIANCE_REGION` (`us` or `eu`), `SPEEDIANCE_DEVICE_TYPE` — confirm the
     GM2 device type value before the first real push

3. **Install and run:**

   ```bash
   npm install
   npm run dev
   ```

## Build order (tech spec §9)

Each step should be checkable before moving to the next.

1. **Schema + RLS** — `supabase/migrations/0001_init.sql`. Check: user A
   cannot read user B's rows (verify via two Supabase sessions once real
   accounts exist).
2. **Catalog import** — pull the catalog by hand
   (`speediance-cli library --json`, or the account's Speediance mobile
   session), then:

   ```bash
   npm run import-catalog -- ./library.json
   ```

   Check: 883 rows, IDs intact, no name used as a key. This session built
   the script against the documented shape — a fixture wasn't available, so
   run it for real against a live pull before trusting it.
3. **Enrichment** — one-off, not scheduled:

   ```bash
   npm run enrich-catalog            # enrich everything not yet enriched
   npm run enrich-catalog -- --sample 50   # dump 50 rows weighted toward
                                             # low confidence for human review
   ```

   **Do not build generation on top of enrichment you haven't eyeballed.**
   PRD R1b / tech spec §5.1: bad derived tags produce plausible-looking
   plans that are wrong, and nothing downstream catches it.
4. **Intake + generation** — `/generate`. Check: a generated week has no
   muscle on consecutive training days, stays within 15% of the requested
   duration, uses at most three attachments per day.
5. **Week view** — `/week`. Check: readable at 390pt without horizontal
   scroll.
6. **Push** — the button on `/week`. Check: a week appears on the machine; a
   forced failure on one day reports the rest as landed; an unchanged-catalog
   refresh reports everything unchanged and writes nothing.
7. **Drag and drop, library, saved workouts** — all built.
8. **Refinement** — built, one message per round trip under the week view.

## What's here vs. what needs a live pass

Built without live Supabase/Anthropic/Speediance credentials this session
(by request) — everything is implemented against the documented contracts,
but nothing has run against real services yet:

- **Catalog import** (`scripts/import-catalog.ts`) is written against the
  documented `library --json` shape; run it against a real pull before
  trusting it, per step 2 above.
- **Enrichment, generation, and refinement** call the Anthropic API for
  real; they haven't been run, so the prompts in `lib/claude/prompts.ts`
  may need a pass or two once you can see real output.
- **The Speediance client** (`lib/speediance/client.ts`) is a TypeScript
  port of `github.com/stozo04/speediance-cli`'s auth flow, catalog
  endpoints, and program-push payload (MIT, attributed in the file header).
  The PRD states push and catalog pull are already confirmed working
  against a GM2 account via that CLI; this port hasn't itself been run
  against the live API yet. Confirm the base URL host and
  `SPEEDIANCE_DEVICE_TYPE` value before the first push — get those wrong
  and nothing will work, get the weight-unit handling wrong and every load
  on the machine is off by a factor of ~2.2.
- **Migration** hasn't been applied to a real project.

## Known simplifications

- **Transcribe** (`/transcribe/[dayId]`) is a stub. Tech spec §7.2, §9: "not
  built in v1" — it's the fallback for a dead push endpoint, and push is
  confirmed working. Build it out from PRD R7 the day push actually breaks.
- **Session duration estimate** on the week view uses a flat default
  seconds-per-set rather than each exercise's enriched value, to keep the
  week query from needing a second join. Generation itself does use the
  real per-exercise `seconds_per_set` (tech spec §5.2) — only the client-side
  display estimate on `/week` is approximate. Worth tightening once real
  enrichment data exists to look at.
- **Settings screen** (`/settings`) isn't one of the tech spec's four named
  screens, but difficulty (PRD R9) and the Speediance account email need
  somewhere to live, so it's a fifth, minimal one.
- A couple of interactive text links (Undo, Clear filters) use ink instead
  of the signal color to hold to tech spec §7.1's "signal appears in exactly
  two places" — worth a design pass on selected-filter-chip fills, which
  currently also use signal and arguably count as a third use.
