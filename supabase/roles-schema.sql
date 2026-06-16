-- Metis AI Roles Schema — Part 3.5
-- Run in Supabase SQL Editor after schema.sql
-- Admin UUID: 4a6e1f29-e18b-4fd3-9a7e-cec54501db54

-- ════════════════════════════════════
-- 1. AI ROLES TABLE
-- ════════════════════════════════════

create table if not exists public.ai_roles (
  id           uuid primary key default gen_random_uuid(),
  role_number  int  not null unique,
  role_name    text not null,
  description  text not null,
  model        text not null default 'claude-haiku-4-5-20251001',
  enabled      boolean not null default true,
  created_at   timestamptz not null default now()
);

-- ════════════════════════════════════
-- 2. ROLE SKILLS TABLE
-- ════════════════════════════════════

create table if not exists public.role_skills (
  id          uuid primary key default gen_random_uuid(),
  role_id     uuid not null references public.ai_roles(id) on delete cascade,
  skill_name  text not null,
  skill_desc  text,
  weight      numeric(4,3) not null default 1.0,
  created_at  timestamptz not null default now()
);

-- ════════════════════════════════════
-- 3. ROLE OUTPUTS TABLE
-- ════════════════════════════════════
-- One output per role per match (upsert on conflict)

create table if not exists public.role_outputs (
  id           uuid primary key default gen_random_uuid(),
  match_id     uuid not null references public.matches(id) on delete cascade,
  role_id      uuid not null references public.ai_roles(id) on delete cascade,
  output_json  jsonb not null,
  confidence   numeric(4,3),
  created_at   timestamptz not null default now(),
  unique(match_id, role_id)
);

-- ════════════════════════════════════
-- 4. ROLE ACCURACY TABLE
-- ════════════════════════════════════
-- Populated by Role 11 (Learning Loop) post-settlement

create table if not exists public.role_accuracy (
  id              uuid primary key default gen_random_uuid(),
  role_id         uuid not null references public.ai_roles(id) on delete cascade,
  match_id        uuid not null references public.matches(id) on delete cascade,
  predicted_json  jsonb not null,
  actual_json     jsonb,
  accuracy_score  numeric(4,3),
  settled_at      timestamptz,
  created_at      timestamptz not null default now()
);

-- ════════════════════════════════════
-- 5. INDEXES
-- ════════════════════════════════════

create index if not exists role_outputs_match_idx    on public.role_outputs  (match_id);
create index if not exists role_outputs_role_idx     on public.role_outputs  (role_id);
create index if not exists role_accuracy_role_idx    on public.role_accuracy (role_id);
create index if not exists role_accuracy_match_idx   on public.role_accuracy (match_id);

-- ════════════════════════════════════
-- 6. ROW LEVEL SECURITY
-- ════════════════════════════════════

alter table public.ai_roles      enable row level security;
alter table public.role_skills   enable row level security;
alter table public.role_outputs  enable row level security;
alter table public.role_accuracy enable row level security;

-- Public read
drop policy if exists "ai_roles_public_read"      on public.ai_roles;
drop policy if exists "role_skills_public_read"   on public.role_skills;
drop policy if exists "role_outputs_public_read"  on public.role_outputs;
drop policy if exists "role_accuracy_public_read" on public.role_accuracy;

create policy "ai_roles_public_read"
  on public.ai_roles for select using (true);

create policy "role_skills_public_read"
  on public.role_skills for select using (true);

create policy "role_outputs_public_read"
  on public.role_outputs for select using (true);

create policy "role_accuracy_public_read"
  on public.role_accuracy for select using (true);

-- Admin write only
drop policy if exists "ai_roles_admin_write"      on public.ai_roles;
drop policy if exists "role_skills_admin_write"   on public.role_skills;
drop policy if exists "role_outputs_admin_write"  on public.role_outputs;
drop policy if exists "role_accuracy_admin_write" on public.role_accuracy;

create policy "ai_roles_admin_write"
  on public.ai_roles for all
  using (auth.uid() = '4a6e1f29-e18b-4fd3-9a7e-cec54501db54'::uuid);

create policy "role_skills_admin_write"
  on public.role_skills for all
  using (auth.uid() = '4a6e1f29-e18b-4fd3-9a7e-cec54501db54'::uuid);

create policy "role_outputs_admin_write"
  on public.role_outputs for all
  using (auth.uid() = '4a6e1f29-e18b-4fd3-9a7e-cec54501db54'::uuid);

create policy "role_accuracy_admin_write"
  on public.role_accuracy for all
  using (auth.uid() = '4a6e1f29-e18b-4fd3-9a7e-cec54501db54'::uuid);

-- ════════════════════════════════════
-- 7. SEED THE 11 AI ROLES
-- ════════════════════════════════════

insert into public.ai_roles (role_number, role_name, description, model) values
  (1,  'Statistical Validator',
       'Validates Poisson model inputs. Checks team_stats integrity, rolling window data quality. Flags missing data, small samples, or outlier stats.',
       'claude-haiku-4-5-20251001'),

  (2,  'Form Intelligence',
       'Analyses rolling 5-game form with recency weighting [0.10,0.15,0.20,0.25,0.30]. Identifies momentum shifts, winning/losing streaks, and recent scoring patterns.',
       'claude-haiku-4-5-20251001'),

  (3,  'Deep Analysis',
       'Full narrative match analysis. Receives outputs from all other roles as context. Synthesises into a structured recommendation with clear reasoning.',
       'claude-sonnet-4-6'),

  (4,  'Tournament Context',
       'World Cup-specific factors: group stage math, elimination pressure, rest days between matches, travel distances, squad rotation risk, qualification scenarios.',
       'claude-haiku-4-5-20251001'),

  (5,  'Market Intelligence',
       'Analyses bookmaker line movement, identifies market efficiency signals, infers where sharp money is positioned, spots value vs consensus.',
       'claude-haiku-4-5-20251001'),

  (6,  'Risk Manager',
       'Applies Kelly criterion with fractional multiplier (×0.25). Checks portfolio exposure. Enforces 5% bankroll cap. Outputs stake recommendation.',
       'claude-haiku-4-5-20251001'),

  (7,  'Tactical Analyst',
       'Assesses formation matchups, pressing styles, defensive shape, set-piece threat (both offensive and defensive), and key individual match-ups.',
       'claude-haiku-4-5-20251001'),

  (8,  'Head-to-Head Historian',
       'Reviews historical H2H record, venue-specific patterns, score tendencies in past meetings, psychological precedents (e.g. rivalry effects).',
       'claude-haiku-4-5-20251001'),

  (9,  'Motivation Analyst',
       'Scores team motivation level (0–10): must-win vs already-qualified, group permutations, rivalry intensity, pride factors, star player fitness signals.',
       'claude-haiku-4-5-20251001'),

  (10, 'Composite Scorer',
       'Aggregates all role outputs (1–9) into a single confidence score 0–100. Explains the main drivers pushing the score up or down.',
       'claude-haiku-4-5-20251001'),

  (11, 'Learning Loop',
       'Post-settlement accuracy tracking. Compares role predictions vs actual outcomes. Identifies systematic biases. Feeds calibration notes back into role prompts.',
       'claude-sonnet-4-6')

on conflict (role_number) do update set
  role_name   = excluded.role_name,
  description = excluded.description,
  model       = excluded.model;
