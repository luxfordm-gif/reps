-- Weighted profiles: machines that load at more than one point.
--
-- Plate-loaded machines (PRIME's range, for one) have two or three numbered
-- loading pegs — always 1, 2, 3 — and each peg is a different leverage, so
-- 20 kg on peg 3 is not 20 kg on peg 1. A set on one of these machines is
-- really a list of weights, one per peg, with only some of them loaded.
--
-- Two pieces of state:
--   exercise_unit_prefs.load_positions — how many points this machine loads at
--     (1 = an ordinary machine, which is what a missing row means). Lives
--     beside weight_unit because it is the same kind of per-machine fact and
--     follows the machine across plans via normalized_name.
--   logged_sets.position_weights — the per-point breakdown of one logged set,
--     as a JSON array in kg with null for an unloaded point: [10, null, 20].
--     `weight` keeps the total across every point, so volume, PRs, records and
--     history carry on reading the one number they always have.
--
-- Run this in the Supabase SQL Editor.

alter table public.exercise_unit_prefs
  add column if not exists load_positions smallint;

alter table public.exercise_unit_prefs
  drop constraint if exists exercise_unit_prefs_load_positions_check;
alter table public.exercise_unit_prefs
  add constraint exercise_unit_prefs_load_positions_check
  check (load_positions is null or (load_positions >= 1 and load_positions <= 3));

alter table public.logged_sets
  add column if not exists position_weights jsonb;
