-- model_predictions v2: single row per match with V1/V2/V3 columns
-- Migrates from 3-rows-per-match (per prediction_type) to 1-row-per-match.
-- Predictions logged at stats-fetch time; accuracy scored at settlement.

-- Clear old 3-row-per-match data (dev only — no production history yet)
TRUNCATE TABLE public.model_predictions;

-- Drop old unique constraint and check constraint
ALTER TABLE public.model_predictions
  DROP CONSTRAINT IF EXISTS model_predictions_match_id_prediction_type_key;
ALTER TABLE public.model_predictions
  DROP CONSTRAINT IF EXISTS model_predictions_prediction_type_check;

-- Make legacy columns nullable (kept for schema compat, unused in new flow)
ALTER TABLE public.model_predictions ALTER COLUMN prediction_type DROP NOT NULL;
ALTER TABLE public.model_predictions ALTER COLUMN predicted      DROP NOT NULL;
ALTER TABLE public.model_predictions ALTER COLUMN actual         DROP NOT NULL;
ALTER TABLE public.model_predictions ALTER COLUMN correct        DROP NOT NULL;

-- settled_at: nullable now — only set when match settles
ALTER TABLE public.model_predictions ALTER COLUMN settled_at DROP NOT NULL;
ALTER TABLE public.model_predictions ALTER COLUMN settled_at DROP DEFAULT;

-- New unique: one row per match
ALTER TABLE public.model_predictions
  ADD CONSTRAINT model_predictions_match_id_key UNIQUE (match_id);

-- Timestamp for when predictions were logged (at stats fetch, before kickoff)
ALTER TABLE public.model_predictions ADD COLUMN IF NOT EXISTS predicted_at TIMESTAMPTZ;

-- Actual outcome: 'H' | 'D' | 'A' (set at settlement)
ALTER TABLE public.model_predictions ADD COLUMN IF NOT EXISTS actual_outcome TEXT;

-- V1 model (Model 7 — xG/goals weighted Poisson)
ALTER TABLE public.model_predictions ADD COLUMN IF NOT EXISTS v1_home_win    NUMERIC(5,3);
ALTER TABLE public.model_predictions ADD COLUMN IF NOT EXISTS v1_draw        NUMERIC(5,3);
ALTER TABLE public.model_predictions ADD COLUMN IF NOT EXISTS v1_away_win    NUMERIC(5,3);
ALTER TABLE public.model_predictions ADD COLUMN IF NOT EXISTS v1_lambda_home NUMERIC(6,3);
ALTER TABLE public.model_predictions ADD COLUMN IF NOT EXISTS v1_lambda_away NUMERIC(6,3);
ALTER TABLE public.model_predictions ADD COLUMN IF NOT EXISTS v1_top_score   TEXT;

-- V2 model (V1 + away-form adjustment)
ALTER TABLE public.model_predictions ADD COLUMN IF NOT EXISTS v2_home_win    NUMERIC(5,3);
ALTER TABLE public.model_predictions ADD COLUMN IF NOT EXISTS v2_draw        NUMERIC(5,3);
ALTER TABLE public.model_predictions ADD COLUMN IF NOT EXISTS v2_away_win    NUMERIC(5,3);
ALTER TABLE public.model_predictions ADD COLUMN IF NOT EXISTS v2_lambda_home NUMERIC(6,3);
ALTER TABLE public.model_predictions ADD COLUMN IF NOT EXISTS v2_lambda_away NUMERIC(6,3);
ALTER TABLE public.model_predictions ADD COLUMN IF NOT EXISTS v2_top_score   TEXT;

-- V3 model (65% Dixon-Coles + 35% V1 blend)
ALTER TABLE public.model_predictions ADD COLUMN IF NOT EXISTS v3_home_win    NUMERIC(5,3);
ALTER TABLE public.model_predictions ADD COLUMN IF NOT EXISTS v3_draw        NUMERIC(5,3);
ALTER TABLE public.model_predictions ADD COLUMN IF NOT EXISTS v3_away_win    NUMERIC(5,3);
ALTER TABLE public.model_predictions ADD COLUMN IF NOT EXISTS v3_lambda_home NUMERIC(6,3);
ALTER TABLE public.model_predictions ADD COLUMN IF NOT EXISTS v3_lambda_away NUMERIC(6,3);
ALTER TABLE public.model_predictions ADD COLUMN IF NOT EXISTS v3_top_score   TEXT;

-- Anchor line for total goals (e.g. 2.5)
ALTER TABLE public.model_predictions ADD COLUMN IF NOT EXISTS anchor_line NUMERIC(3,1);

-- Accuracy flags (set at settlement, for 1X2 outcome)
ALTER TABLE public.model_predictions ADD COLUMN IF NOT EXISTS correct_v1 BOOLEAN;
ALTER TABLE public.model_predictions ADD COLUMN IF NOT EXISTS correct_v2 BOOLEAN;
ALTER TABLE public.model_predictions ADD COLUMN IF NOT EXISTS correct_v3 BOOLEAN;

-- Proper scoring rules for V3 (set at settlement)
ALTER TABLE public.model_predictions ADD COLUMN IF NOT EXISTS brier_score NUMERIC(6,4);
ALTER TABLE public.model_predictions ADD COLUMN IF NOT EXISTS rps_score   NUMERIC(6,4);

-- Quality warning: flagged when opponents in window were weak (avg DC att < 0.35)
ALTER TABLE public.model_predictions ADD COLUMN IF NOT EXISTS quality_warning BOOLEAN DEFAULT FALSE;

-- Update indexes
DROP INDEX IF EXISTS model_predictions_type_idx;
CREATE INDEX IF NOT EXISTS model_predictions_settled_idx
  ON public.model_predictions (settled_at) WHERE settled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS model_predictions_predicted_idx
  ON public.model_predictions (predicted_at);
