-- Soft "different machine" reset for the exercise-rename flow:
-- when the user renames a plan exercise and marks it as a different machine,
-- we bump this timestamp so the prefill in the logger ignores prior sets
-- while leaving Workout History intact.
-- Run this in the Supabase SQL Editor.

alter table public.plan_exercises
  add column if not exists baseline_reset_at timestamptz;
