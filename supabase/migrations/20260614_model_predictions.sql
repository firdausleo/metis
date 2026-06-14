-- Model-level prediction tracking: 1X2, total goals, correct score
-- Populated by /api/settle-match at settlement time via inline Poisson recalc.
-- One row per prediction_type per match (idempotent: delete-then-insert on re-settle).

create table if not exists public.model_predictions (
  id               uuid         primary key default gen_random_uuid(),
  match_id         uuid         not null references public.matches(id) on delete cascade,
  prediction_type  text         not null check (prediction_type in ('1x2','total_goals','correct_score')),
  predicted        text         not null,      -- 'home_win'|'away_win'|'draw'|'over_2.5'|'2-1' etc.
  predicted_prob   numeric(5,3),               -- model probability at prediction time
  actual           text         not null,      -- same encoding as predicted
  correct          boolean      not null,
  lambda_home      numeric(6,3),
  lambda_away      numeric(6,3),
  settled_at       timestamptz  not null default now(),
  unique(match_id, prediction_type)
);

create index if not exists model_predictions_match_idx on public.model_predictions (match_id);
create index if not exists model_predictions_type_idx  on public.model_predictions (prediction_type);
create index if not exists model_predictions_date_idx  on public.model_predictions (settled_at desc);

alter table public.model_predictions enable row level security;

drop policy if exists "model_predictions_public_read" on public.model_predictions;
create policy "model_predictions_public_read"
  on public.model_predictions for select to authenticated using (true);

drop policy if exists "model_predictions_service_write" on public.model_predictions;
create policy "model_predictions_service_write"
  on public.model_predictions for all to service_role using (true);
