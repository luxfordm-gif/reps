-- Free-text personal note per exercise row. Independent of plan_exercises.notes
-- (which holds parsed coach notes from the uploaded plan). The user adds their
-- own cues here; cleared by setting back to NULL.
-- Run this in the Supabase SQL Editor.

alter table public.plan_exercises
  add column if not exists personal_notes text;
