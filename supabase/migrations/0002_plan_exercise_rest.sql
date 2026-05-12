-- Persist a per-exercise rest preference. Lets the rest pill the user picks
-- on the rest overlay stick across opens of the same exercise.
-- Run this in the Supabase SQL Editor.

alter table public.plan_exercises
  add column if not exists rest_seconds integer;
