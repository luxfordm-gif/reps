-- Plan switching: track when a plan was activated so we can show "Week N"
-- and reset the Next-up cycle on "Start again".

alter table plans
  add column if not exists activated_at timestamptz,
  add column if not exists archived_at timestamptz;

-- Backfill: existing active plans use their upload date as the activation date.
update plans
  set activated_at = uploaded_at
  where activated_at is null and is_active = true;
