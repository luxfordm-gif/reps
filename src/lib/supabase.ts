import { createClient } from '@supabase/supabase-js';
import { isReachable, reportNetworkFail, reportNetworkOk, withTimeout } from './offline/net';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_KEY;

export const isSupabaseConfigured = Boolean(url && key);

/** Longest we'll wait for any single Supabase request before treating the
 *  connection as dead. Without this, one bar of signal means a request that
 *  never resolves and a screen that spins forever. */
const REQUEST_TIMEOUT_MS = 10_000;
/** Auth gets a little longer: a failed token refresh signs the user out. */
const AUTH_TIMEOUT_MS = 15_000;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * fetch with a hard timeout and connectivity bookkeeping, used for every
 * Supabase call in the app.
 *
 * Once a request has failed we know the phone can't reach the server, so the
 * next ones fail instantly instead of each burning their own timeout — that's
 * what keeps the app responsive in a basement gym rather than spinning on
 * every tap. Data calls short-circuit while we're in that state; auth calls
 * still go out, since recovering the session is how we get back online.
 */
const offlineAwareFetch: typeof fetch = async (input, init) => {
  const isAuth = requestUrl(input).includes('/auth/v1/');
  if (!isAuth && !isReachable()) {
    throw new TypeError('Failed to fetch: offline');
  }
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    isAuth ? AUTH_TIMEOUT_MS : REQUEST_TIMEOUT_MS
  );
  try {
    const res = await fetch(input, { ...init, signal: controller.signal });
    // Any answer at all — even a 4xx — means we reached the server. Only data
    // calls clear the flag: auth has its own refresh loop, and letting it
    // declare the connection healthy would send every read back out over a
    // link we already know is failing.
    if (!isAuth) reportNetworkOk();
    return res;
  } catch (e) {
    reportNetworkFail();
    throw e;
  } finally {
    clearTimeout(timer);
  }
};

// Use placeholder values when missing so the app can render a visible error
// instead of crashing with a blank screen.
export const supabase = createClient(
  url ?? 'https://placeholder.supabase.co',
  key ?? 'placeholder-key',
  { global: { fetch: offlineAwareFetch } }
);

const USER_ID_KEY = 'reps.userId';

function readStoredUserId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(USER_ID_KEY);
  } catch {
    return null;
  }
}

function storeUserId(id: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (id) window.localStorage.setItem(USER_ID_KEY, id);
    else window.localStorage.removeItem(USER_ID_KEY);
  } catch {
    // ignore
  }
}

let cachedUserId: string | null = readStoredUserId();

/**
 * The signed-in user's id, without a network round trip.
 *
 * `supabase.auth.getUser()` calls the auth server on every invocation, which is
 * exactly what we can't afford at the gym — it turns every read and write into
 * a hanging request. `getSession()` reads the token from storage (only going to
 * the network when it needs a refresh), and if even that stalls we fall back to
 * the last id we saw on this device. Rows written under that id are still
 * checked by RLS when they sync, so a stale id can't write to another account.
 */
export async function currentUserId(): Promise<string | null> {
  try {
    const { data } = await withTimeout(supabase.auth.getSession(), 4000, 'getSession');
    const id = data.session?.user?.id ?? null;
    if (id) {
      if (id !== cachedUserId) {
        cachedUserId = id;
        storeUserId(id);
      }
      return id;
    }
    // No session in storage. Offline, that can just mean the refresh call
    // failed — keep using the cached id rather than locking the user out.
    return isReachable() ? null : cachedUserId;
  } catch {
    return cachedUserId;
  }
}

/** The last known user id, synchronously (for cache lookups during render). */
export function currentUserIdSync(): string | null {
  return cachedUserId;
}

export function forgetCurrentUserId(): void {
  cachedUserId = null;
  storeUserId(null);
}

supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT') {
    forgetCurrentUserId();
    return;
  }
  const id = session?.user?.id ?? null;
  if (id && id !== cachedUserId) {
    cachedUserId = id;
    storeUserId(id);
  }
});
