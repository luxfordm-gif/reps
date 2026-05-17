-- One row per auth user, captured during the onboarding flow.
-- We deliberately do NOT auto-create rows via a trigger on auth.users:
-- the onboarding flow upserts explicitly, which avoids RLS races on first
-- sign-up and leaves the table empty for users who never complete onboarding.
-- Run this in the Supabase SQL Editor.

create table if not exists public.profiles (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  gender               text check (gender in ('male','female','other')),
  date_of_birth        date,
  starting_weight_kg   numeric(6,2) check (starting_weight_kg is null or (starting_weight_kg > 0 and starting_weight_kg < 700)),
  height_cm            numeric(5,1) check (height_cm is null or (height_cm > 0 and height_cm < 300)),
  top_goal             text check (top_goal in ('build_muscle','gain_strength','fat_loss')),
  experience_level     text check (experience_level in ('beginner','intermediate','advanced')),
  onboarding_completed boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles for select using (auth.uid() = user_id);
create policy "profiles_insert_own"
  on public.profiles for insert with check (auth.uid() = user_id);
create policy "profiles_update_own"
  on public.profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.profiles_touch_updated_at() returns trigger
  language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at before update on public.profiles
  for each row execute function public.profiles_touch_updated_at();
