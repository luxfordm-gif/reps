-- Two-week (or longer) rotating plans.
--
-- Some plans run a rotation: week 1 is one set of sessions, week 2 another, then
-- back to week 1. training_days.week_index says which week of the rotation a day
-- belongs to; null means it runs every week (the home abs workout, and every day
-- of a plan that doesn't rotate at all).
--
-- The plan tracks which week you're currently on. It advances when every day of
-- the current week has been trained since rotation_started_at — following the
-- training rather than the calendar, so missing a week doesn't skip a rotation —
-- and the Week switch on Home sets both columns directly.
-- Run this in the Supabase SQL Editor.

alter table public.training_days
  add column if not exists week_index integer,
  -- A day you read rather than log: the home abs workout is a reference card,
  -- not a tracked session.
  add column if not exists reference_only boolean not null default false;

alter table public.plans
  add column if not exists rotation_week integer,
  add column if not exists rotation_started_at timestamptz;
