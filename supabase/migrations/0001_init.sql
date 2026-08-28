-- Speediance Workout Planner — initial schema
-- See technical spec §3. Weight is stored in pounds throughout.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Catalog, pulled from Speediance. Never hand-edited by users.
-- ---------------------------------------------------------------------------
create table exercises (
  id            bigint primary key,          -- Speediance ID, two ID schemes, do not assume format
  name          text not null,
  muscle        text not null,               -- 17 values, see PRD R1
  tab           text not null,               -- Training | Bodyweight | Recovery | Pilates-Mat
                                              -- | Warmup | HIIT | Stretch | Row & Ski
  retired_at    timestamptz,                 -- gone upstream; hidden from search, kept for existing plans
  synced_at     timestamptz not null default now()
);
create index exercises_tab_idx on exercises (tab);
create index exercises_muscle_idx on exercises (muscle);
create index exercises_name_idx on exercises (lower(name));

-- Derived fields. Separate table so a re-import never clobbers enrichment,
-- and a re-enrichment never touches source data.
create table exercise_enrichment (
  exercise_id       bigint primary key references exercises(id) on delete cascade,
  equipment         text,        -- handles | barbell | ankle straps | tricep rope | bench
                                  -- | belt | ski handles | rowing bench | none
  movement_pattern  text,        -- push | pull | hinge | squat | lunge | carry | rotation | isometric
  is_compound       boolean,
  is_unilateral     boolean,
  difficulty        smallint,    -- 1 beginner, 2 intermediate, 3 advanced
  secondary_muscles text[],
  seconds_per_set   smallint,
  confidence        text,        -- high | low. Low means the name did not state it.
  model             text not null,
  generated_at      timestamptz not null default now()
);

create table profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  display_name      text not null,
  difficulty        smallint not null default 2,   -- per-user, not per-plan. PRD R9.
  speediance_email  text,        -- not a secret; the password is never stored (tech spec §4.3)
  created_at        timestamptz not null default now()
);

-- Intake answers. Kept so regeneration does not re-ask.
create table intakes (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(id) on delete cascade,
  goal            text not null,        -- weight_loss | muscle | strength | general
  focus_muscles   text[] not null default '{}',
  days_per_week   smallint not null,
  session_minutes smallint not null,
  notes           text,
  created_at      timestamptz not null default now()
);

create table weeks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  intake_id   uuid references intakes(id),
  name        text not null,
  summary     text,                     -- the two-or-three-sentence logic note, PRD R3
  refinement_messages jsonb not null default '[]', -- last three, newest last: [{message, created_at}]
  is_active   boolean not null default false,
  created_at  timestamptz not null default now()
);
create unique index one_active_week_per_user
  on weeks (user_id) where is_active;

create table week_days (
  id           uuid primary key default gen_random_uuid(),
  week_id      uuid not null references weeks(id) on delete cascade,
  day_index    smallint not null,       -- 0 = Monday
  name         text,                    -- null means rest day
  pushed_at    timestamptz,
  unique (week_id, day_index)
);

create table day_exercises (
  id            uuid primary key default gen_random_uuid(),
  day_id        uuid not null references week_days(id) on delete cascade,
  exercise_id   bigint not null references exercises(id),
  position      integer not null,        -- gapped by 1000, see note below
  sets          smallint not null,
  reps          smallint not null,
  rest_seconds  smallint not null,
  weight_lb     numeric(5,1),            -- suggested starting weight, nullable
  unique (day_id, position) deferrable initially deferred
);
create index day_exercises_day_id_idx on day_exercises (day_id);

-- A day saved for reuse. Snapshot, not a reference: editing the
-- original week must not mutate the saved copy.
create table saved_workouts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  name       text not null,
  exercises  jsonb not null,             -- [{exercise_id, sets, reps, rest_seconds, weight_lb}]
  created_at timestamptz not null default now()
);

create table push_log (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles(id) on delete cascade,
  week_id      uuid references weeks(id) on delete set null,
  status       text not null,            -- success | partial | failed
  detail       jsonb,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row-level security. Every table with a user_id is scoped to auth.uid().
-- exercises / exercise_enrichment are readable by any authenticated user
-- and writable only by the service role (used by the import/enrich scripts).
-- ---------------------------------------------------------------------------
alter table exercises enable row level security;
alter table exercise_enrichment enable row level security;
alter table profiles enable row level security;
alter table intakes enable row level security;
alter table weeks enable row level security;
alter table week_days enable row level security;
alter table day_exercises enable row level security;
alter table saved_workouts enable row level security;
alter table push_log enable row level security;

create policy exercises_read on exercises
  for select using (auth.role() = 'authenticated');
create policy exercise_enrichment_read on exercise_enrichment
  for select using (auth.role() = 'authenticated');
-- No insert/update/delete policies for either table: only the service role
-- (which bypasses RLS) may write, via scripts/import-catalog.ts and
-- scripts/enrich-catalog.ts.

create policy profiles_self on profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

create policy intakes_owner on intakes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy weeks_owner on weeks
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy week_days_owner on week_days
  for all using (
    exists (select 1 from weeks w where w.id = week_id and w.user_id = auth.uid())
  ) with check (
    exists (select 1 from weeks w where w.id = week_id and w.user_id = auth.uid())
  );

create policy day_exercises_owner on day_exercises
  for all using (
    exists (
      select 1 from week_days d join weeks w on w.id = d.week_id
      where d.id = day_id and w.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from week_days d join weeks w on w.id = d.week_id
      where d.id = day_id and w.user_id = auth.uid()
    )
  );

create policy saved_workouts_owner on saved_workouts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy push_log_owner on push_log
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- New profile row on signup. Accounts are created by hand (no self-service
-- signup route), but this keeps profiles in sync if a row is added via the
-- Supabase dashboard / auth.admin API.
-- ---------------------------------------------------------------------------
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
