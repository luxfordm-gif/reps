-- Make Data API grants explicit for every table the app reads/writes via
-- supabase-js. Starting Oct 30, 2026, Supabase stops auto-granting access to
-- the "public" schema for existing projects, so without these statements
-- supabase-js will start returning 42501 errors. The app is auth-gated, so we
-- only grant to authenticated + service_role (no anon).
-- Run this in the Supabase SQL Editor.

grant select, insert, update, delete on public.body_weights   to authenticated, service_role;
grant select, insert, update, delete on public.logged_sets    to authenticated, service_role;
grant select, insert, update, delete on public.plan_exercises to authenticated, service_role;
grant select, insert, update, delete on public.plans          to authenticated, service_role;
grant select, insert, update, delete on public.sessions       to authenticated, service_role;
grant select, insert, update, delete on public.training_days  to authenticated, service_role;
grant select, insert, update, delete on public.water_logs     to authenticated, service_role;
