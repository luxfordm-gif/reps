-- Machine brands the user has typed that the app doesn't already know.
--
-- An exercise's name still carries its brand — "Prime chest press" — because a
-- branded machine loads differently from any other and keeps its own history.
-- The brand is split off only for display, and the app knows the big makers
-- (Prime, Hammer Strength, Cybex…). This column remembers the rest, so a brand
-- typed on one device splits on the others too.
-- Run this in the Supabase SQL Editor.

alter table public.profiles
  add column if not exists machine_brands text[];
