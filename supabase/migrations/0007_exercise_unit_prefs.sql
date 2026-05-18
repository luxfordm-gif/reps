-- Per-user, per-machine weight unit preference (kg / lb).
-- Keyed by normalized_name so the choice follows the machine across plans —
-- if a user sets a lat pulldown to lb in one plan, the same lat pulldown in
-- any other plan opens in lb too.
-- Run this in the Supabase SQL Editor.

create table if not exists public.exercise_unit_prefs (
  user_id uuid not null references auth.users(id) on delete cascade,
  normalized_name text not null,
  weight_unit text not null check (weight_unit in ('kg','lb')),
  updated_at timestamptz not null default now(),
  primary key (user_id, normalized_name)
);

alter table public.exercise_unit_prefs enable row level security;

create policy "exercise_unit_prefs_select_own"
  on public.exercise_unit_prefs for select using (auth.uid() = user_id);
create policy "exercise_unit_prefs_insert_own"
  on public.exercise_unit_prefs for insert with check (auth.uid() = user_id);
create policy "exercise_unit_prefs_update_own"
  on public.exercise_unit_prefs for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "exercise_unit_prefs_delete_own"
  on public.exercise_unit_prefs for delete using (auth.uid() = user_id);

grant select, insert, update, delete on public.exercise_unit_prefs to authenticated;
