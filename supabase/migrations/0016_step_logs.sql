-- Daily step count, logged by hand from a phone's health app.
--
-- Shaped like body_weights rather than water_logs: one row per day that the
-- user can edit or delete, so a day typed in wrong can be corrected and the
-- history can be charted. The unique constraint on (user_id, recorded_on) is
-- what makes the app's upsert "one entry per day" rather than a pile of them.
-- Run this in the Supabase SQL Editor.

create table if not exists public.step_logs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  steps        integer not null check (steps >= 0 and steps <= 300000),
  recorded_on  date not null default current_date,
  created_at   timestamptz not null default now(),
  unique (user_id, recorded_on)
);

create index if not exists step_logs_user_date_idx
  on public.step_logs(user_id, recorded_on desc);

alter table public.step_logs enable row level security;

drop policy if exists "step_logs_select_own" on public.step_logs;
create policy "step_logs_select_own"
  on public.step_logs for select using (auth.uid() = user_id);

drop policy if exists "step_logs_insert_own" on public.step_logs;
create policy "step_logs_insert_own"
  on public.step_logs for insert with check (auth.uid() = user_id);

drop policy if exists "step_logs_update_own" on public.step_logs;
create policy "step_logs_update_own"
  on public.step_logs for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "step_logs_delete_own" on public.step_logs;
create policy "step_logs_delete_own"
  on public.step_logs for delete using (auth.uid() = user_id);

-- Explicit Data API grants, same as 0005 does for the older tables.
grant select, insert, update, delete on public.step_logs to authenticated, service_role;
