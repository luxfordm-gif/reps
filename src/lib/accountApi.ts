import { supabase } from './supabase';
import { deleteAllBlobs } from './offline/blobStore';

/**
 * Everything this app keeps on the device lives under one key prefix, so a
 * wipe doesn't have to name each setting, cache and queue individually — and
 * won't silently miss the next one someone adds.
 */
const LOCAL_KEY_PREFIX = 'reps.';

function forgetEverythingLocal(): void {
  if (typeof window === 'undefined') return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(LOCAL_KEY_PREFIX)) keys.push(key);
    }
    for (const key of keys) window.localStorage.removeItem(key);
  } catch {
    // A locked-down browser can refuse storage entirely. Nothing to clear.
  }
}

const GENERIC_FAILURE = 'Could not delete your account. Check your connection and try again.';

/** The edge function's own error text, falling back to something sayable. */
async function messageFrom(error: unknown): Promise<string> {
  const context = (error as { context?: unknown }).context;
  if (context instanceof Response) {
    try {
      const body = (await context.clone().json()) as { error?: unknown };
      if (typeof body.error === 'string' && body.error) return body.error;
    } catch {
      try {
        const text = await context.clone().text();
        if (text.trim()) return text.trim().slice(0, 200);
      } catch {
        // Fall through to the generic message.
      }
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return GENERIC_FAILURE;
}

/**
 * Deletes the signed-in user's account: their rows, their uploads, their login,
 * and every trace of them on this device.
 *
 * The server side is a single edge function rather than a series of calls from
 * here, because only the service role can remove the login itself, and because
 * a delete half-done over a flaky connection is exactly what you don't want
 * from this button.
 *
 * Local data is cleared only once the server confirms — if the account is
 * still there, wiping the device would just look like a bug to whoever signs
 * back in.
 *
 * Throws with a message worth showing if anything goes wrong; on success the
 * caller is signed out and there is nothing left to return to.
 */
export async function deleteAccount(): Promise<void> {
  const { data, error } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>(
    'delete-account',
    { method: 'POST' }
  );
  if (error) {
    // On a non-2xx, invoke() hands back a FunctionsHttpError and leaves `data`
    // null — the function's own explanation is in the untouched Response on
    // `context`. Reading it is the difference between "check your connection"
    // and being told which table refused to go.
    throw new Error(await messageFrom(error));
  }
  if (data?.error) throw new Error(data.error);

  await deleteAllBlobs();
  forgetEverythingLocal();
  // The user this token belongs to no longer exists, so a failure here means
  // the server has already forgotten the session — nothing left to sign out of.
  try {
    await supabase.auth.signOut();
  } catch {
    // ignore
  }
}
