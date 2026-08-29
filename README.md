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

This was originally built without live Supabase/Anthropic/Speediance
credentials, against documented contracts alone. Since then, most of it has
actually been run live and confirmed working:

- **Catalog import, enrichment, and generation** have all run successfully
  against a real Supabase project and Anthropic account: 883 exercises
  imported, enriched, and used to generate a real week.
- **The Speediance client** (`lib/speediance/client.ts`) is a TypeScript
  port of `github.com/stozo04/speediance-cli`'s auth flow, catalog
  endpoints, and program-push payload (MIT, attributed in the file header).
  Catalog pull is confirmed working live. Push has gone through several
  rounds of live-error-driven fixes — an initial version was built from an
  AI-generated *summary* of the CLI's Go source, which turned out to
  conflate Go's exported-field naming convention with the actual JSON wire
  format (PascalCase vs. the real lowercase/camelCase) and to be missing
  structural pieces entirely (the push payload needs two additional lookup
  calls per exercise — resolving a catalog id to a postable "variant" id,
  and checking whether it's unilateral — that weren't in the original
  port at all). The client has since been rewritten against the literal
  struct tags in the CLI's source (`internal/api/types.go`,
  `internal/api/client.go`, `internal/template/template.go`), not a
  description of them — see the tech spec's §4.1 "read the struct tags,
  not the field names" for why that distinction mattered. **A full week has
  since pushed successfully and appeared correctly in the Speediance app**,
  weight values included (no unit-conversion error) — see
  `docs/speediance-api-contract.md` for the endpoint-by-endpoint evidence
  trail. The client still logs the full raw request/response (password
  redacted) on every call, both server-side and in the push dialog, so any
  future failure — a Speediance API change, say — stays immediately
  diagnosable rather than another round of inference.
- **Migration** has been applied to a real Supabase project.

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
