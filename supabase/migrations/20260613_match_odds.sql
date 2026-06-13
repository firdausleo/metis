-- Add 1X2 odds columns to matches so they persist across sessions
-- and the /recommendations page can scan all matches with entered odds.

alter table public.matches
  add column if not exists odds_home numeric(8,3),
  add column if not exists odds_draw numeric(8,3),
  add column if not exists odds_away numeric(8,3);
