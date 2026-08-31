-- Pair up supersetted exercises. Rows in the same training day that share a
-- superset_group are performed as a superset: you alternate between them and
-- only rest once the pair is done. Null means the exercise stands alone.
--
-- The column was already declared on PlanExerciseRow in the client but had no
-- migration behind it, so it always read back as undefined.
-- Run this in the Supabase SQL Editor.

alter table public.plan_exercises
  add column if not exists superset_group integer;
