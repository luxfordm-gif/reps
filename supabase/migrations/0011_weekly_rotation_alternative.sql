-- Mark an alternative as a weekly-rotation partner.
-- Some trainer plans prescribe a movement that swaps week to week with another
-- machine (coach note: "Alternate weeks with Magnum bench press machine"). Those
-- are parsed on upload and stored as ordinary alternatives on the plan-exercise
-- slot, but flagged here so the logger can *suggest* rotating to the other
-- movement when you open the exercise (based on what you logged last time). This
-- is only a hint — the user still confirms the switch. Ordinary (manually added)
-- alternatives leave this false and never prompt.
-- Run this in the Supabase SQL Editor.

alter table public.plan_exercise_alternatives
  add column if not exists is_weekly_rotation boolean not null default false;
