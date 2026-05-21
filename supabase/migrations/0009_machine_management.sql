-- Make exercise_unit_prefs act as the per-machine metadata table so the
-- Machines settings panel can store a user-chosen display name and body part
-- per machine, even when no plan_exercises or logged_sets row exists yet
-- (the "fork to a new machine" flow inserts an empty row here).

alter table public.exercise_unit_prefs
  add column if not exists display_name text,
  add column if not exists body_part_override text;

-- Allow 'pin' as a weight unit for stack machines where the user logs the
-- pin position rather than a calibrated weight in kg or lb.
alter table public.exercise_unit_prefs
  drop constraint if exists exercise_unit_prefs_weight_unit_check;
alter table public.exercise_unit_prefs
  add constraint exercise_unit_prefs_weight_unit_check
  check (weight_unit in ('kg','lb','pin'));
