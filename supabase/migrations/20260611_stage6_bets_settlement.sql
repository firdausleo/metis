-- Stage 6 — My Bets + P&L settlement
-- Owner can update/delete their own bets (settle status + pnl when match finishes).
-- Admin can settle any bet. Index for My Bets list queries.
-- Leo runs this in Supabase SQL editor (⛔ admin-present task).

drop policy if exists "bets_owner_update" on public.bets;
create policy "bets_owner_update"
  on public.bets for update
  using (auth.uid() = user_id);

drop policy if exists "bets_owner_delete" on public.bets;
create policy "bets_owner_delete"
  on public.bets for delete
  using (auth.uid() = user_id);

drop policy if exists "bets_admin_settle" on public.bets;
create policy "bets_admin_settle"
  on public.bets for update
  using (auth.uid() = '4a6e1f29-e18b-4fd3-9a7e-cec54501db54'::uuid);

create index if not exists bets_user_created_idx on public.bets (user_id, created_at desc);
create index if not exists bets_match_idx        on public.bets (match_id);
