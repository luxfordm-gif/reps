-- In-app feedback, for beta testers.
--
-- A tester in the gym should be able to report something the moment it happens,
-- with a photo or a screen recording, without leaving the app or finding an
-- email address. Feedback is write-mostly: users insert their own and can read
-- back what they sent; nobody reads anyone else's through the API.
--
-- Read the whole table from the Supabase dashboard (SQL editor / table editor),
-- which bypasses RLS via the service role. There is deliberately no in-app
-- inbox — that would be a support tool, not a training app.
-- Run this in the Supabase SQL Editor.

create table if not exists public.feedback (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  kind         text not null default 'general'
                 check (kind in ('bug', 'idea', 'plan_import', 'general')),
  message      text not null check (char_length(trim(message)) > 0),
  -- Storage paths in the 'feedback' bucket, in the order the user attached them.
  attachments  text[] not null default '{}',
  -- What the app knew at the moment of sending: version, screen, screen size,
  -- user agent, online/offline. Saves a round trip of "which screen were you on?".
  context      jsonb  not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists feedback_created_at_idx on public.feedback(created_at desc);
create index if not exists feedback_user_idx on public.feedback(user_id);

alter table public.feedback enable row level security;

create policy "feedback_insert_own"
  on public.feedback for insert with check (auth.uid() = user_id);
create policy "feedback_select_own"
  on public.feedback for select using (auth.uid() = user_id);

grant select, insert on public.feedback to authenticated;
grant all on public.feedback to service_role;

-- Attachments bucket. Private: a screen recording can show the user's whole
-- training history, so nothing here is world-readable.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'feedback',
  'feedback',
  false,
  52428800, -- 50 MB, enough for a short screen recording from a phone
  array[
    'image/png','image/jpeg','image/webp','image/heic','image/heif','image/gif',
    'video/mp4','video/quicktime','video/webm'
  ]
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types,
      public = false;

-- Each user owns a folder named after their uid; policies key off that first
-- path segment, which is the standard Supabase Storage per-user pattern.
drop policy if exists "feedback_upload_own" on storage.objects;
create policy "feedback_upload_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'feedback'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "feedback_read_own" on storage.objects;
create policy "feedback_read_own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'feedback'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
