CREATE TABLE IF NOT EXISTS public.user_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at      TIMESTAMPTZ,
  duration_secs INTEGER,
  user_agent    TEXT,
  device_type   TEXT,
  page_count    INTEGER DEFAULT 0,
  action_count  INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.user_activity_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID REFERENCES public.user_sessions(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
  action      TEXT NOT NULL,
  category    TEXT NOT NULL,
  detail      JSONB,
  page        TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user
  ON public.user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started
  ON public.user_sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_session
  ON public.user_activity_log(session_id);
CREATE INDEX IF NOT EXISTS idx_activity_user
  ON public.user_activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_ts
  ON public.user_activity_log(ts DESC);

ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_sessions_insert"
  ON public.user_sessions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users_own_sessions_update"
  ON public.user_sessions FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "admin_read_all_sessions"
  ON public.user_sessions FOR SELECT TO authenticated
  USING (auth.uid() = '4a6e1f29-e18b-4fd3-9a7e-cec54501db54');

ALTER TABLE public.user_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_activity_insert"
  ON public.user_activity_log FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "admin_read_all_activity"
  ON public.user_activity_log FOR SELECT TO authenticated
  USING (auth.uid() = '4a6e1f29-e18b-4fd3-9a7e-cec54501db54');
