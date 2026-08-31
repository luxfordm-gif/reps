-- Two-week (or longer) rotating plans.
--
-- Some plans run a rotation: week 1 is one set of sessions, week 2 another,
-- then back to week 1. training_days.week_index says which week of the rotation
-- a day belongs to; null means it runs every week, which covers the home abs
-- workout and every day of a plan that doesn't rotate.
--
-- There is deliberately no plan-level "current week": each day type alternates
-- on its own — the Home card for Legs opens whichever of "Legs 1" / "Legs 2"
-- was completed longest ago, the same way a weekly exercise alternative swaps.
--
-- reference_only marks a day you read rather than log: the home abs workout is
-- a reference card, not a tracked session.
-- Run this in the Supabase SQL Editor.

alter table public.training_days
  add column if not exists week_index integer,
  add column if not exists reference_only boolean not null default false;
