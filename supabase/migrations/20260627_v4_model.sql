-- V4 self-correcting DC model: adds bias-correction columns to model_predictions
-- and ensures team_wc_corrections table exists (idempotent).

CREATE TABLE IF NOT EXISTS public.team_wc_corrections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  team_name TEXT NOT NULL UNIQUE,
  tournament TEXT NOT NULL DEFAULT 'WC2026',
  matches_played INT DEFAULT 0,
  attack_bias FLOAT DEFAULT 0,
  defense_bias FLOAT DEFAULT 0,
  confidence FLOAT DEFAULT 0,
  lambda_multiplier FLOAT DEFAULT 1.0,
  last_updated TIMESTAMPTZ DEFAULT now(),
  match_history JSONB DEFAULT '[]'::jsonb
);

ALTER TABLE public.team_wc_corrections ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'team_wc_corrections' AND policyname = 'Service role full access'
  ) THEN
    CREATE POLICY "Service role full access" ON public.team_wc_corrections
      USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.model_predictions
  ADD COLUMN IF NOT EXISTS v4_lambda_home NUMERIC,
  ADD COLUMN IF NOT EXISTS v4_lambda_away NUMERIC,
  ADD COLUMN IF NOT EXISTS v4_home_win    NUMERIC,
  ADD COLUMN IF NOT EXISTS v4_draw        NUMERIC,
  ADD COLUMN IF NOT EXISTS v4_away_win    NUMERIC,
  ADD COLUMN IF NOT EXISTS correct_v4     BOOLEAN;
