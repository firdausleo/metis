-- Views joining sessions/activity with auth.users to expose email in admin queries

CREATE OR REPLACE VIEW public.user_sessions_with_email AS
SELECT s.*, u.email
FROM public.user_sessions s
LEFT JOIN auth.users u ON s.user_id = u.id;

CREATE OR REPLACE VIEW public.user_activity_with_email AS
SELECT a.*, u.email
FROM public.user_activity_log a
LEFT JOIN auth.users u ON a.user_id = u.id;

GRANT SELECT ON public.user_sessions_with_email TO authenticated;
GRANT SELECT ON public.user_activity_with_email TO authenticated;
