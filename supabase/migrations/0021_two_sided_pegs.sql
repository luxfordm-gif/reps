-- Two-sided pegs machines.
--
-- Some plate-loaded machines (PRIME's Extreme row, iso-lateral rows and
-- presses) carry an arm on each side, each with its own numbered pegs. You load
-- both sides the same and count one: "25 a side on peg 3". The logger types the
-- pegs as one side and logs the set at twice that, so a two-sided machine and a
-- leg extension both log the total they actually moved.
--
--   load_sides — 2 on a two-sided pegs machine. Null (or 1) is one side, which
--                is every machine tagged before this.
--
-- A logged set needs nothing new: position_weights holds one side's pegs and
-- weight holds the total, so a breakdown that adds up to half the weight is one
-- side of two.
--
-- Run this in the Supabase SQL Editor.

alter table public.exercise_unit_prefs
  add column if not exists load_sides smallint;

alter table public.exercise_unit_prefs
  drop constraint if exists exercise_unit_prefs_load_sides_check;
alter table public.exercise_unit_prefs
  add constraint exercise_unit_prefs_load_sides_check
  check (load_sides is null or load_sides in (1, 2));
