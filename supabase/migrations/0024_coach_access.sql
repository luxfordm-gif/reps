-- A coach can see an athlete's training, read-only, once the athlete invites
-- them.
--
-- The athlete makes a code in Profile and sends it. The coach signs in at
-- /coach (any Reps account will do) and types it in, and from then on can
-- read that athlete's sessions, sets, plan, body weight, water, steps and
-- sleep. Never write: every policy added here is SELECT. Either side can end
-- it by deleting the link.
--
-- Profiles are deliberately not opened up. The coach sees a display name
-- through coach_athletes() and nothing else from it — no date of birth.
-- Run this in the Supabase SQL Editor.

-- ---- Invites ----------------------------------------------------------------

create table if not exists public.coach_invites (
  code        text primary key,
  athlete_id  uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '7 days',
  used_at     timestamptz
);

create index if not exists coach_invites_athlete_idx on public.coach_invites(athlete_id);

alter table public.coach_invites enable row level security;

-- Codes are made by create_coach_invite(), never inserted directly, so the
-- athlete only needs to see and withdraw their own.
drop policy if exists "coach_invites_select_own" on public.coach_invites;
create policy "coach_invites_select_own"
  on public.coach_invites for select using (auth.uid() = athlete_id);

drop policy if exists "coach_invites_delete_own" on public.coach_invites;
create policy "coach_invites_delete_own"
  on public.coach_invites for delete using (auth.uid() = athlete_id);

grant select, delete on public.coach_invites to authenticated, service_role;

-- ---- Links ------------------------------------------------------------------

create table if not exists public.coach_links (
  athlete_id  uuid not null references auth.users(id) on delete cascade,
  coach_id    uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (athlete_id, coach_id),
  check (athlete_id <> coach_id)
);

create index if not exists coach_links_coach_idx on public.coach_links(coach_id);

alter table public.coach_links enable row level security;

-- Made only by accept_coach_invite(). Either end can see and remove it.
drop policy if exists "coach_links_select_party" on public.coach_links;
create policy "coach_links_select_party"
  on public.coach_links for select
  using (auth.uid() = athlete_id or auth.uid() = coach_id);

drop policy if exists "coach_links_delete_party" on public.coach_links;
create policy "coach_links_delete_party"
  on public.coach_links for delete
  using (auth.uid() = athlete_id or auth.uid() = coach_id);

grant select, delete on public.coach_links to authenticated, service_role;

-- ---- Functions --------------------------------------------------------------

-- A fresh 8-character code from an alphabet with no 0/O or 1/I, so it can be
-- read out over the phone. Any earlier unused code of the athlete's is
-- withdrawn: there's only ever one live code to worry about.
create or replace function public.create_coach_invite()
returns public.coach_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  me uuid := auth.uid();
  bytes bytea;
  candidate text;
  result public.coach_invites;
begin
  if me is null then
    raise exception 'not_signed_in';
  end if;

  delete from public.coach_invites where athlete_id = me and used_at is null;

  loop
    -- gen_random_uuid() is cryptographically random; its bytes pick letters.
    bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    candidate := '';
    for i in 0..7 loop
      candidate := candidate || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
    end loop;
    begin
      insert into public.coach_invites (code, athlete_id)
      values (candidate, me)
      returning * into result;
      return result;
    exception when unique_violation then
      -- Vanishingly rare; just draw again.
    end;
  end loop;
end;
$$;

-- The coach's side: check the code, link the two accounts, spend the code.
-- Errors are short tokens the app turns into copy.
create or replace function public.accept_coach_invite(invite_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  cleaned text := upper(regexp_replace(coalesce(invite_code, ''), '[^A-Za-z0-9]', '', 'g'));
  invite public.coach_invites;
begin
  if me is null then
    raise exception 'not_signed_in';
  end if;

  select * into invite from public.coach_invites where code = cleaned for update;
  if not found then
    raise exception 'invite_not_found';
  end if;
  if invite.athlete_id = me then
    raise exception 'invite_own';
  end if;
  if invite.used_at is not null then
    raise exception 'invite_used';
  end if;
  if invite.expires_at < now() then
    raise exception 'invite_expired';
  end if;

  insert into public.coach_links (athlete_id, coach_id)
  values (invite.athlete_id, me)
  on conflict do nothing;

  update public.coach_invites set used_at = now() where code = cleaned;
  return invite.athlete_id;
end;
$$;

-- The coach's athletes, with the one profile field a coach needs.
create or replace function public.coach_athletes()
returns table (athlete_id uuid, display_name text, linked_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select l.athlete_id, p.display_name, l.created_at
  from public.coach_links l
  left join public.profiles p on p.user_id = l.athlete_id
  where l.coach_id = auth.uid()
  order by l.created_at;
$$;

-- The athlete's coaches, named so the athlete knows who they're removing: the
-- coach's display name if they have one, otherwise their email.
create or replace function public.athlete_coaches()
returns table (coach_id uuid, name text, linked_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select l.coach_id, coalesce(nullif(trim(p.display_name), ''), u.email::text), l.created_at
  from public.coach_links l
  join auth.users u on u.id = l.coach_id
  left join public.profiles p on p.user_id = l.coach_id
  where l.athlete_id = auth.uid()
  order by l.created_at;
$$;

revoke all on function public.create_coach_invite() from public, anon;
revoke all on function public.accept_coach_invite(text) from public, anon;
revoke all on function public.coach_athletes() from public, anon;
revoke all on function public.athlete_coaches() from public, anon;
grant execute on function public.create_coach_invite() to authenticated;
grant execute on function public.accept_coach_invite(text) to authenticated;
grant execute on function public.coach_athletes() to authenticated;
grant execute on function public.athlete_coaches() to authenticated;

-- ---- Read access for coaches ------------------------------------------------
--
-- One SELECT policy per table the dashboard reads. Postgres ORs policies of
-- the same command together, so these sit alongside each table's *_own
-- policies without changing what the athlete can do. The subquery runs under
-- coach_links' own RLS, which only shows a coach their own links.

do $$
declare
  t text;
begin
  foreach t in array array[
    'sessions', 'logged_sets', 'plans', 'training_days', 'plan_exercises',
    'exercise_unit_prefs', 'body_weights', 'water_logs', 'step_logs', 'sleep_logs'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_select_coach', t);
    execute format(
      'create policy %I on public.%I for select using (
         user_id in (select athlete_id from public.coach_links where coach_id = (select auth.uid()))
       )',
      t || '_select_coach', t
    );
  end loop;
end;
$$;
