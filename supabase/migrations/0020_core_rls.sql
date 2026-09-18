-- Row-level security on the core tables.
--
-- The tables the app was first built on (plans, training_days, plan_exercises,
-- sessions, logged_sets, body_weights, water_logs) were created in the Supabase
-- dashboard rather than by a migration, so whether RLS was ever switched on for
-- them isn't visible in this repo. Everything added since (profiles,
-- exercise_unit_prefs, plan_exercise_alternatives, feedback) enables it
-- explicitly; this brings the originals in line.
--
-- Without RLS, the anon/authenticated API key — which ships in the client and
-- is readable by anyone with the app open — can read every row in the table,
-- not just its owner's. With it, Postgres filters every query by auth.uid().
-- That is the difference between "my friend can use the app" and "my friend can
-- read my training history".
--
-- Safe to run more than once: policies are dropped first, and enabling RLS on a
-- table that already has it is a no-op. It does not touch data.
-- Run this in the Supabase SQL Editor.

do $$
declare
  t text;
  tables text[] := array[
    'plans',
    'training_days',
    'plan_exercises',
    'sessions',
    'logged_sets',
    'body_weights',
    'water_logs'
  ];
begin
  foreach t in array tables loop
    -- Skip anything that isn't there (a table renamed or never created).
    if not exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t and c.relkind = 'r'
    ) then
      raise notice 'skipping %: no such table', t;
      continue;
    end if;

    -- Every one of these carries user_id; without it the app's own writes
    -- could not identify their owner. Guard anyway rather than create a
    -- policy that can never match.
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'user_id'
    ) then
      raise exception 'table % has no user_id column — cannot secure it by owner', t;
    end if;

    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format(
      'create policy %I on public.%I for select using (auth.uid() = user_id)',
      t || '_select_own', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format(
      'create policy %I on public.%I for insert with check (auth.uid() = user_id)',
      t || '_insert_own', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format(
      'create policy %I on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t || '_update_own', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);
    execute format(
      'create policy %I on public.%I for delete using (auth.uid() = user_id)',
      t || '_delete_own', t
    );

    raise notice 'secured %', t;
  end loop;
end $$;

-- What the app can reach at all. Deliberately no grants to anon: every screen
-- is behind sign-in, so a signed-out key should get nothing.
grant select, insert, update, delete on public.body_weights   to authenticated;
grant select, insert, update, delete on public.logged_sets    to authenticated;
grant select, insert, update, delete on public.plan_exercises to authenticated;
grant select, insert, update, delete on public.plans          to authenticated;
grant select, insert, update, delete on public.sessions       to authenticated;
grant select, insert, update, delete on public.training_days  to authenticated;
grant select, insert, update, delete on public.water_logs     to authenticated;

revoke all on public.body_weights   from anon;
revoke all on public.logged_sets    from anon;
revoke all on public.plan_exercises from anon;
revoke all on public.plans          from anon;
revoke all on public.sessions       from anon;
revoke all on public.training_days  from anon;
revoke all on public.water_logs     from anon;

-- Read this back: every row should say rls = true with 4 policies.
select
  c.relname                as table_name,
  c.relrowsecurity         as rls,
  count(p.polname)         as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public' and c.relkind = 'r'
group by c.relname, c.relrowsecurity
order by c.relrowsecurity, c.relname;
