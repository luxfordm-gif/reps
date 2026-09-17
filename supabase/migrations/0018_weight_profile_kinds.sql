-- Two kinds of weight profile, and no fixed number of positions.
--
-- 0017 assumed one shape: plate-loaded pegs, two or three of them, loaded at
-- the same time and added up. Cable machines vary their resistance a different
-- way — the cam (the egg-shaped pulley the cable runs over) can be set to one
-- of several numbered positions, which changes how the weight arcs through the
-- lift. That is one weight on one position, not a sum, and the number of
-- positions is a fact about the machine: three on some, six on others.
--
--   load_profile   — 'pegs' (plate positions, loaded together, summed) or
--                    'curve' (one cam position alongside the one weight).
--                    Null is an ordinary machine, whatever load_positions says.
--   load_positions — how many pegs or curve positions the machine has. The cap
--                    is a guard against a typo, not a claim about gym kit; it
--                    moves with the constant in src/lib/weightProfile.ts.
--
-- A logged set needs nothing new: a curve is a breakdown with a single loaded
-- position ([null,null,null,30] is 30 kg on curve 4), so position_weights and
-- weight already carry both kinds.
--
-- Run this in the Supabase SQL Editor.

alter table public.exercise_unit_prefs
  add column if not exists load_profile text;

alter table public.exercise_unit_prefs
  drop constraint if exists exercise_unit_prefs_load_profile_check;
alter table public.exercise_unit_prefs
  add constraint exercise_unit_prefs_load_profile_check
  check (load_profile is null or load_profile in ('pegs','curve'));

-- Machines tagged under 0017 were all plate pegs — that was the only kind.
update public.exercise_unit_prefs
  set load_profile = 'pegs'
  where load_profile is null and load_positions is not null and load_positions > 1;

alter table public.exercise_unit_prefs
  drop constraint if exists exercise_unit_prefs_load_positions_check;
alter table public.exercise_unit_prefs
  add constraint exercise_unit_prefs_load_positions_check
  check (load_positions is null or (load_positions >= 1 and load_positions <= 8));
