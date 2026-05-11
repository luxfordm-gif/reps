-- Add per-session notes captured on the workout-complete screen.
-- Run this in the Supabase SQL Editor.

alter table public.sessions
  add column if not exists feedback_for_self text,
  add column if not exists notes_to_coach text;
