-- Task 42 / Role 11 — Learning loop calibration store
-- One row per role. Role 11 (Sonnet) reads accumulated role_accuracy post-
-- settlement, identifies systematic bias, and writes a confidence multiplier
-- (0.50–1.50) + notes here. The analyze worker applies the multiplier next run.
-- Leo runs this in Supabase SQL editor.

create table if not exists public.role_calibration (
  role_id               uuid primary key references public.ai_roles(id) on delete cascade,
  sample_size           int           not null default 0,
  hit_rate              numeric(4,3),
  confidence_multiplier numeric(4,3)  not null default 1.0 check (confidence_multiplier between 0.5 and 1.5),
  bias_notes            text,
  updated_at            timestamptz   not null default now()
);

alter table public.role_calibration enable row level security;
drop policy if exists "role_calibration_read"  on public.role_calibration;
create policy "role_calibration_read"  on public.role_calibration for select to authenticated using (true);
drop policy if exists "role_calibration_admin" on public.role_calibration;
create policy "role_calibration_admin" on public.role_calibration for all    to service_role  using (true);
