-- Drop-set exercises used to default to "no rest" at upload (rest_seconds = 0).
-- The logger already runs the drops of a set straight through on its own —
-- the timer only starts when the next row belongs to a different set — so the
-- zero bought nothing for the drops, and only removed the rest between the
-- ordinary working sets in front of the drop set. New uploads now give these
-- the normal 60s default (see src/lib/restDefaults.ts); this brings rows from
-- existing plans in line so nobody has to re-pick 60s by hand.
--
-- Exercises whose coach notes explicitly ask for no rest keep their zero.
-- Run this in the Supabase SQL Editor.

update public.plan_exercises
set rest_seconds = 60
where rest_seconds = 0
  and set_scheme = 'dropset'
  and coalesce(notes, '') !~* '(no|without)\s+rest|straight\s+(into|through)';
