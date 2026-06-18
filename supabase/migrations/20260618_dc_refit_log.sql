CREATE TABLE IF NOT EXISTS public.dc_refit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  refit_date    TIMESTAMPTZ NOT NULL DEFAULT now(),
  match_count   INTEGER NOT NULL,
  wc_matches    INTEGER NOT NULL DEFAULT 0,
  rho           NUMERIC(6,4),
  temperature   NUMERIC(4,2),
  notes         TEXT,
  key_changes   JSONB
);

GRANT SELECT ON public.dc_refit_log TO authenticated;
ALTER TABLE public.dc_refit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "all_read_dc_refit" ON public.dc_refit_log
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_insert_dc_refit" ON public.dc_refit_log
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = '4a6e1f29-e18b-4fd3-9a7e-cec54501db54'::uuid);

-- First WC2026 refit entry (matchday 1, 16 results)
INSERT INTO public.dc_refit_log
  (refit_date, match_count, wc_matches, rho, temperature, notes, key_changes)
VALUES
  ('2026-06-18T00:00:00Z', 15524, 16, -0.0612, 1.11,
   'First WC2026 refit — matchday 1 (16 results)',
   '{"Germany": "+1.39 att", "USA": "+1.08 att", "Sweden": "+1.24 att", "Spain": "-0.93 att", "Ecuador": "-0.69 att", "Netherlands": "+0.48 att"}');
