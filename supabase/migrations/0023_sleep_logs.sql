-- Hours slept, logged by hand each morning for the night before.
--
-- Shaped like step_logs: one row per day the user can edit or delete, so a
-- night typed in wrong can be corrected and the history can be charted. The
-- day is the morning the hours were logged — Tuesday's row is Monday night's
-- sleep, which is the night that shaped Tuesday's session.
-- Run this in the Supabase SQL Editor.

create table if not exists public.sleep_logs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  hours        numeric(3,1) not null check (hours >= 0 and hours <= 24),
  recorded_on  date not null default current_date,
  created_at   timestamptz not null default now(),
  unique (user_id, recorded_on)
);

create index if not exists sleep_logs_user_date_idx
  on public.sleep_logs(user_id, recorded_on desc);

alter table public.sleep_logs enable row level security;

drop policy if exists "sleep_logs_select_own" on public.sleep_logs;
create policy "sleep_logs_select_own"
  on public.sleep_logs for select using (auth.uid() = user_id);

drop policy if exists "sleep_logs_insert_own" on public.sleep_logs;
create policy "sleep_logs_insert_own"
  on public.sleep_logs for insert with check (auth.uid() = user_id);

drop policy if exists "sleep_logs_update_own" on public.sleep_logs;
create policy "sleep_logs_update_own"
  on public.sleep_logs for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "sleep_logs_delete_own" on public.sleep_logs;
create policy "sleep_logs_delete_own"
  on public.sleep_logs for delete using (auth.uid() = user_id);

-- Explicit Data API grants, same as 0005 does for the older tables.
grant select, insert, update, delete on public.sleep_logs to authenticated, service_role;
