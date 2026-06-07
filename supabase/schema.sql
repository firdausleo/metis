-- Metis Database Schema
-- Admin UUID: 4a6e1f29-e18b-4fd3-9a7e-cec54501db54
--
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)

-- ════════════════════════════════════
-- 1. MATCHES TABLE
-- ════════════════════════════════════

create table if not exists public.matches (
  id              uuid primary key default gen_random_uuid(),
  external_id     text not null unique,
  match_date      timestamptz not null,
  stage           text not null,                    -- 'group','r32','r16','qf','sf','3rd','final'
  group_name      text,                             -- 'A'–'L', null for knockout
  home_team       text not null,
  away_team       text not null,
  home_team_code  text not null,
  away_team_code  text not null,
  venue           text,
  city            text,
  status          text not null default 'upcoming', -- 'upcoming','live','finished'
  home_score      int,
  away_score      int,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- If the table already exists without the unique constraint, add it:
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'matches_external_id_key'
      and conrelid = 'public.matches'::regclass
  ) then
    alter table public.matches add constraint matches_external_id_key unique (external_id);
  end if;
end $$;

-- Indexes
create index if not exists matches_stage_idx      on public.matches (stage);
create index if not exists matches_match_date_idx on public.matches (match_date);
create index if not exists matches_group_name_idx on public.matches (group_name);

-- ════════════════════════════════════
-- 2. ROW LEVEL SECURITY
-- ════════════════════════════════════

alter table public.matches enable row level security;

-- Anyone (including anon) can read matches
drop policy if exists "matches_public_read" on public.matches;
create policy "matches_public_read"
  on public.matches for select
  using (true);

-- Only admin can insert/update/delete
drop policy if exists "matches_admin_write" on public.matches;
create policy "matches_admin_write"
  on public.matches for all
  using (auth.uid() = '4a6e1f29-e18b-4fd3-9a7e-cec54501db54'::uuid);

-- ════════════════════════════════════
-- 3. BETS TABLE (scaffold for later)
-- ════════════════════════════════════

create table if not exists public.bets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  match_id    uuid not null references public.matches(id) on delete cascade,
  bet_type    text not null,
  selection   text not null,
  stake       numeric(10,2) not null default 0,
  odds        numeric(8,3),
  status      text not null default 'pending', -- 'pending','won','lost','void'
  pnl         numeric(10,2),
  created_at  timestamptz not null default now()
);

-- ════════════════════════════════════
-- 3.5 TEAM STATS TABLE
-- ════════════════════════════════════
-- One row per team per match context.
-- Populated by CF Worker scraper or manual admin input.

create table if not exists public.team_stats (
  id                   uuid primary key default gen_random_uuid(),
  team_code            text not null,
  match_id             uuid not null references public.matches(id) on delete cascade,
  games_window         int  default 5,
  goals_scored_avg     numeric(5,3),
  goals_conceded_avg   numeric(5,3),
  home_goals_avg       numeric(5,3),
  away_goals_avg       numeric(5,3),
  xgf_per_game         numeric(5,3),
  xga_per_game         numeric(5,3),
  wc_games_in_window   int  default 0,  -- WC-specific games in rolling window
  form_string          text,             -- 'WWDLL' latest first
  updated_at           timestamptz not null default now(),
  unique(team_code, match_id)
);

create index if not exists team_stats_match_idx on public.team_stats (match_id);
create index if not exists team_stats_team_idx  on public.team_stats (team_code);

alter table public.team_stats enable row level security;

drop policy if exists "team_stats_public_read" on public.team_stats;
create policy "team_stats_public_read"
  on public.team_stats for select using (true);

drop policy if exists "team_stats_admin_write" on public.team_stats;
create policy "team_stats_admin_write"
  on public.team_stats for all
  using (auth.uid() = '4a6e1f29-e18b-4fd3-9a7e-cec54501db54'::uuid);

-- ════════════════════════════════════
-- 4. BETS TABLE (scaffold for later)
-- ════════════════════════════════════

alter table public.bets enable row level security;

drop policy if exists "bets_owner_read" on public.bets;
create policy "bets_owner_read"
  on public.bets for select
  using (auth.uid() = user_id);

drop policy if exists "bets_owner_write" on public.bets;
create policy "bets_owner_write"
  on public.bets for insert
  with check (auth.uid() = user_id);
