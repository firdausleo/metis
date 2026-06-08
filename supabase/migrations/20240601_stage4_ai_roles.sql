-- ============================================================
-- Stage 4 — AI Roles tables
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================

-- ── 1. ai_roles ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_number int  UNIQUE NOT NULL,
  role_name   text NOT NULL,
  description text NOT NULL,
  model       text NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
  enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE ai_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_roles_read"  ON ai_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "ai_roles_admin" ON ai_roles FOR ALL    TO service_role  USING (true);

-- ── 2. role_skills ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS role_skills (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id     uuid NOT NULL REFERENCES ai_roles(id) ON DELETE CASCADE,
  skill_name  text NOT NULL,
  skill_desc  text,
  weight      numeric(4,3) NOT NULL DEFAULT 1.0,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE role_skills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "role_skills_read"  ON role_skills FOR SELECT TO authenticated USING (true);
CREATE POLICY "role_skills_admin" ON role_skills FOR ALL    TO service_role  USING (true);

-- ── 3. role_outputs ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS role_outputs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id    uuid NOT NULL REFERENCES matches(id)   ON DELETE CASCADE,
  role_id     uuid NOT NULL REFERENCES ai_roles(id)  ON DELETE CASCADE,
  output_json jsonb NOT NULL,
  confidence  numeric(4,3) CHECK (confidence >= 0 AND confidence <= 1),
  created_at  timestamptz DEFAULT now(),
  UNIQUE(match_id, role_id)
);

ALTER TABLE role_outputs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "role_outputs_read"  ON role_outputs FOR SELECT TO authenticated USING (true);
CREATE POLICY "role_outputs_write" ON role_outputs FOR ALL    TO service_role  USING (true);

-- ── 4. role_accuracy ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS role_accuracy (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id        uuid NOT NULL REFERENCES ai_roles(id)  ON DELETE CASCADE,
  match_id       uuid NOT NULL REFERENCES matches(id)   ON DELETE CASCADE,
  predicted_json jsonb NOT NULL,
  actual_json    jsonb,
  accuracy_score numeric(4,3) CHECK (accuracy_score >= 0 AND accuracy_score <= 1),
  settled_at     timestamptz,
  created_at     timestamptz DEFAULT now()
);

ALTER TABLE role_accuracy ENABLE ROW LEVEL SECURITY;
CREATE POLICY "role_accuracy_read"  ON role_accuracy FOR SELECT TO authenticated USING (true);
CREATE POLICY "role_accuracy_admin" ON role_accuracy FOR ALL    TO service_role  USING (true);

-- ── 5. Indexes ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_role_outputs_match  ON role_outputs(match_id);
CREATE INDEX IF NOT EXISTS idx_role_outputs_role   ON role_outputs(role_id);
CREATE INDEX IF NOT EXISTS idx_role_accuracy_match ON role_accuracy(match_id);
CREATE INDEX IF NOT EXISTS idx_role_accuracy_role  ON role_accuracy(role_id);

-- ── 6. Seed ai_roles ─────────────────────────────────────────
INSERT INTO ai_roles (role_number, role_name, description, model) VALUES
  (1,  'Statistical Validator',  'Validates Poisson inputs; checks team_stats integrity, rolling window data quality, flags missing data',              'claude-haiku-4-5-20251001'),
  (2,  'Form Intelligence',      'Analyses 5-game rolling form with recency weighting; identifies momentum shifts and streaks',                         'claude-haiku-4-5-20251001'),
  (3,  'Deep Analysis',          'Full narrative match analysis; synthesises all role outputs into final recommendation with reasoning',                'claude-sonnet-4-6'),
  (4,  'Tournament Context',     'WC-specific factors: group stage math, elimination pressure, rest days, travel, squad rotation risk',                'claude-haiku-4-5-20251001'),
  (5,  'Market Intelligence',    'Line movement analysis, market efficiency signals, where sharp money is going',                                      'claude-haiku-4-5-20251001'),
  (6,  'Risk Manager',           'Applies Kelly criterion, portfolio exposure check, bankroll protection; outputs stake recommendation',                'claude-haiku-4-5-20251001'),
  (7,  'Tactical Analyst',       'Formation matchups, pressing style, set-piece threat, defensive shape, key player influence',                        'claude-haiku-4-5-20251001'),
  (8,  'Head-to-Head Historian', 'H2H records, venue patterns, historical score tendencies, psychological precedents',                                 'claude-haiku-4-5-20251001'),
  (9,  'Motivation Analyst',     'Scores team motivation: must-win vs already-qualified, group permutations, rivalry, pride factors',                  'claude-haiku-4-5-20251001'),
  (10, 'Composite Scorer',       'Aggregates all role outputs into single confidence score 0-100; explains drivers',                                   'claude-haiku-4-5-20251001'),
  (11, 'Learning Loop',          'Post-settlement accuracy tracking; identifies systematic biases; feeds back into confidence calibration',             'claude-sonnet-4-6')
ON CONFLICT (role_number) DO UPDATE
  SET role_name   = EXCLUDED.role_name,
      description = EXCLUDED.description,
      model       = EXCLUDED.model;

-- ── 7. team_stats new columns (safe to re-run) ───────────────
ALTER TABLE team_stats
  ADD COLUMN IF NOT EXISTS home_goals_avg numeric(5,3),
  ADD COLUMN IF NOT EXISTS away_goals_avg numeric(5,3),
  ADD COLUMN IF NOT EXISTS data_source    text DEFAULT 'manual';

-- Verify with:
-- SELECT role_number, role_name, model FROM ai_roles ORDER BY role_number;
