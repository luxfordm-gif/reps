-- What to call someone on the home screen.
--
-- The greeting was a hardcoded first name, so every account saw the same one.
-- A name is the only personal detail the app needs and never had a column for.
-- Run this in the Supabase SQL Editor.
--
-- Nullable on purpose: onboarding asks, but the step is skippable like every
-- other one, and the greeting simply drops the name when there isn't one.
-- Guessing from an email address gets it wrong more often than it helps.

alter table public.profiles
  add column if not exists display_name text
    check (display_name is null or char_length(btrim(display_name)) between 1 and 40);
