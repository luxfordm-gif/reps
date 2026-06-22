-- Per-user alternatives attached to a plan-exercise slot.
-- An alternative is a different movement the user can swap to mid-workout when
-- the planned machine is taken (e.g. cable fly instead of pec deck fly). The
-- primary plan_exercises row always keeps its priority — alternatives live
-- alongside it and are toggled via pill buttons on the logging screen.
-- Tempo / rep range / target sets are inherited live from the parent
-- plan_exercises row, so they are NOT duplicated here. Each alternative tracks
-- its own history via its normalized_name (logged_sets group by normalized_name).
-- Run this in the Supabase SQL Editor.

create table if not exists public.plan_exercise_alternatives (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_exercise_id uuid not null references public.plan_exercises(id) on delete cascade,
  name text not null,
  normalized_name text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists plan_exercise_alternatives_pe_idx
  on public.plan_exercise_alternatives(plan_exercise_id);

alter table public.plan_exercise_alternatives enable row level security;

create policy "plan_exercise_alternatives_select_own"
  on public.plan_exercise_alternatives for select using (auth.uid() = user_id);
create policy "plan_exercise_alternatives_insert_own"
  on public.plan_exercise_alternatives for insert with check (auth.uid() = user_id);
create policy "plan_exercise_alternatives_update_own"
  on public.plan_exercise_alternatives for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "plan_exercise_alternatives_delete_own"
  on public.plan_exercise_alternatives for delete using (auth.uid() = user_id);

grant select, insert, update, delete on public.plan_exercise_alternatives to authenticated;
