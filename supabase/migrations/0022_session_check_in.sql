-- The check-in at the end of a workout: four 1–5 ratings and a few yes/no
-- flags, tapped on the completion screen and copied to a coach each week.
-- Run this in the Supabase SQL Editor.
--
-- Every column is nullable: each question can be skipped on its own. Soreness
-- runs 1 fresh to 5 wrecked, the rest 1 low to 5 high, the same way round as
-- a coach's daily sheet. The older free-text note columns stay as they are; the text
-- boxes that wrote them are gone, but what's in them still exports.

alter table public.sessions
  add column if not exists checkin_performance smallint
    check (checkin_performance is null or checkin_performance between 1 and 5),
  add column if not exists checkin_energy smallint
    check (checkin_energy is null or checkin_energy between 1 and 5),
  add column if not exists checkin_soreness smallint
    check (checkin_soreness is null or checkin_soreness between 1 and 5),
  add column if not exists checkin_sleep smallint
    check (checkin_sleep is null or checkin_sleep between 1 and 5),
  add column if not exists checkin_flags text[] not null default '{}';
