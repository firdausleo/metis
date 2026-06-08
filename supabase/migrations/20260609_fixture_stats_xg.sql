-- xG cache: fixture statistics never change once finished, so cache forever.
-- Worker writes via service role; public read. Leo runs in SQL editor.
create table if not exists public.fixture_stats (
  fixture_id   bigint not null,
  team_id      bigint not null,
  xgf          numeric(5,3),
  xga          numeric(5,3),
  cached_at    timestamptz default now(),
  primary key (fixture_id, team_id)
);

alter table public.fixture_stats enable row level security;

drop policy if exists "fixture_stats_public_read" on public.fixture_stats;
create policy "fixture_stats_public_read" on public.fixture_stats for select using (true);

drop policy if exists "fixture_stats_admin_write" on public.fixture_stats;
create policy "fixture_stats_admin_write" on public.fixture_stats for all
  using (auth.uid() = '4a6e1f29-e18b-4fd3-9a7e-cec54501db54'::uuid);
