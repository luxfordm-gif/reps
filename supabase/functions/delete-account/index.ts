// Deletes a signed-in user's account and everything attached to it.
//
// This has to be a function rather than a handful of client calls. The browser
// holds an anon key, and an anon key can never remove a row from auth.users —
// only the service role can, and that key must never leave the server. Without
// this, "delete my account" would clear the user's data but leave the login
// itself alive, which is not what anyone means by it.
//
// The caller proves who they are with their own access token, and we delete
// THAT user — the token is the authority, never a user id in the body. That
// distinction is the whole security model here: with a service-role client,
// trusting an id from the request would let anyone delete anyone.
//
// Setup (once), from the repo root with the Supabase CLI logged in:
//
//   supabase functions deploy delete-account
//
// (No --no-verify-jwt: the caller is a signed-in user and the platform's own
// JWT check is a useful first gate. SUPABASE_URL, SUPABASE_ANON_KEY and
// SUPABASE_SERVICE_ROLE_KEY are injected automatically.)

import { createClient } from 'npm:@supabase/supabase-js@2';

/**
 * Every table holding user data, children before parents.
 *
 * Some of these cascade from auth.users already and would go on their own, but
 * not all of them do, and which is which lives in the database rather than in
 * this repo. Deleting explicitly means the answer doesn't depend on remembering
 * to add a cascade to the next table someone creates — and re-deleting rows
 * that have already gone is free.
 *
 * Order matters for the plan tree: plan_exercises point at training_days, which
 * point at plans, and a restrictive foreign key would refuse a parent that
 * still has children.
 */
const TABLES = [
  'logged_sets',
  'sessions',
  'plan_exercise_alternatives',
  'plan_exercises',
  'training_days',
  'plans',
  'body_weights',
  'water_logs',
  'step_logs',
  'exercise_unit_prefs',
  'feedback',
  'profiles',
] as const;

/** Storage buckets holding per-user files, keyed by a `<user id>/…` prefix. */
const BUCKETS = ['feedback'] as const;

// supabase-js sends more than it looks like: as well as the bearer token it
// attaches `apikey` and `x-client-info`. Every one of those has to be named
// here, because the browser asks permission for the whole set in its preflight
// and refuses the request outright if any is missing — which surfaces as
// "Failed to send a request to the Edge Function", with nothing in the
// function's own logs, since it was never reached.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing secret ${name}`);
  return v;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'not signed in' }, 401);

  // Who the token belongs to. This is the only place the user id comes from.
  const asCaller = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await asCaller.auth.getUser();
  const user = userData?.user;
  if (userError || !user) return json({ error: 'not signed in' }, 401);

  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));

  // Rows first. If any of this fails we stop and say so, leaving the account
  // intact: a half-deleted account the user can still sign into is recoverable,
  // one whose login is gone while its data lingers is not.
  for (const table of TABLES) {
    const { error } = await admin.from(table).delete().eq('user_id', user.id);
    if (error) {
      console.error(`delete-account: ${table} failed`, error);
      return json({ error: `Could not delete your ${table.replace(/_/g, ' ')}.` }, 500);
    }
  }

  // Then anything they uploaded. Best-effort: a leftover file is a tidiness
  // problem, and failing here would strand the account mid-delete.
  for (const bucket of BUCKETS) {
    try {
      const { data: files } = await admin.storage.from(bucket).list(user.id);
      const paths = (files ?? []).map((f) => `${user.id}/${f.name}`);
      if (paths.length > 0) await admin.storage.from(bucket).remove(paths);
    } catch (e) {
      console.error(`delete-account: bucket ${bucket} cleanup failed`, e);
    }
  }

  // Finally the login itself. After this the token in the caller's hands refers
  // to a user that no longer exists.
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    console.error('delete-account: auth user delete failed', deleteError);
    return json({ error: 'Your data was removed, but the account itself could not be deleted.' }, 500);
  }

  return json({ ok: true }, 200);
});
