// Connectivity state for the offline layer.
//
// `navigator.onLine` only tells us whether the device thinks it has a network —
// it happily reports `true` on one bar of signal in a basement gym, where
// requests hang for 30s and then fail. So on top of it we keep a "degraded"
// flag: any request that times out or fails at the transport level parks the
// app in offline mode for a short cool-off, during which reads come straight
// from cache and writes go straight to the outbox. That's what makes the app
// feel instant with no signal instead of spinning on every tap.

import { useSyncExternalStore } from 'react';

/** How long a transport failure keeps us in offline mode before we retry. */
const DEGRADED_MS = 20_000;

/** Default budget for a single Supabase call before we give up and use cache. */
export const DEFAULT_TIMEOUT_MS = 6_000;

export class TimeoutError extends Error {
  constructor(label: string) {
    super(`Timed out: ${label}`);
    this.name = 'TimeoutError';
  }
}

/** Thrown by `query()` when the request couldn't reach Supabase. Callers use it
 *  to fall back to cached data or to queue the write. */
export class OfflineError extends Error {
  constructor(message = 'No connection') {
    super(message);
    this.name = 'OfflineError';
  }
}

export function isOfflineError(err: unknown): boolean {
  return err instanceof OfflineError;
}

let degradedUntil = 0;
const listeners = new Set<() => void>();
let snapshot = { online: true, reachable: true };

function computeOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine !== false;
}

function refresh(): void {
  const online = computeOnline();
  const reachable = online && Date.now() >= degradedUntil;
  if (snapshot.online === online && snapshot.reachable === reachable) return;
  snapshot = { online, reachable };
  for (const l of listeners) l();
}

/** Device-level connectivity. */
export function isOnline(): boolean {
  return computeOnline();
}

/** Whether it's worth attempting a network call right now. */
export function isReachable(): boolean {
  return computeOnline() && Date.now() >= degradedUntil;
}

/** A call succeeded — leave offline mode immediately. */
export function reportNetworkOk(): void {
  if (degradedUntil !== 0) {
    degradedUntil = 0;
    refresh();
  }
}

/** A call timed out or failed at the transport level. */
export function reportNetworkFail(): void {
  degradedUntil = Date.now() + DEGRADED_MS;
  refresh();
  // Re-check once the cool-off ends so the UI stops saying "offline" on its own.
  if (typeof window !== 'undefined') {
    window.setTimeout(refresh, DEGRADED_MS + 100);
  }
}

export function subscribeNet(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return snapshot;
}

/** Live connectivity for components: `{ online, reachable }`. */
export function useNetStatus() {
  return useSyncExternalStore(subscribeNet, getSnapshot, getSnapshot);
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    degradedUntil = 0;
    refresh();
  });
  window.addEventListener('offline', refresh);
  refresh();
}

/** Reject with TimeoutError if a promise takes longer than `ms`. The
 *  underlying request is left to finish (or not) in the background. */
export function withTimeout<T>(
  promise: PromiseLike<T>,
  ms: number,
  label = 'request'
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(label)), ms);
    Promise.resolve(promise).then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

interface SupabaseErrorish {
  message?: string;
  code?: string;
  status?: number;
  details?: string;
}

/** Distinguish "couldn't reach the server" from "the server said no". Only the
 *  former should fall back to cache — a real 4xx needs to surface. */
export function isTransportError(err: unknown): boolean {
  if (err instanceof TimeoutError || err instanceof OfflineError) return true;
  if (!err) return false;
  if (err instanceof TypeError) return true; // fetch() rejects with TypeError
  const e = err as SupabaseErrorish;
  if (e.status === 0) return true;
  const msg = `${e.message ?? ''} ${e.details ?? ''}`.toLowerCase();
  return (
    msg.includes('fetcherror') ||
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('load failed') ||
    msg.includes('timed out') ||
    msg.includes('timeout')
  );
}

interface PostgrestLike<T> {
  data: T;
  error: SupabaseErrorish | null;
}

/**
 * Run a supabase-js query with a timeout and offline detection.
 *
 * Resolves with `data`, throws `OfflineError` when the request couldn't reach
 * the server (so callers can use cache / the outbox), and re-throws genuine
 * server errors unchanged.
 */
export async function query<T>(
  builder: PromiseLike<PostgrestLike<T>>,
  options: { timeoutMs?: number; label?: string; force?: boolean } = {}
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, label = 'supabase', force = false } = options;
  if (!force && !isReachable()) throw new OfflineError();
  let res: PostgrestLike<T>;
  try {
    res = await withTimeout(builder, timeoutMs, label);
  } catch (e) {
    if (isTransportError(e)) {
      reportNetworkFail();
      throw new OfflineError();
    }
    throw e;
  }
  if (res.error) {
    if (isTransportError(res.error)) {
      reportNetworkFail();
      throw new OfflineError();
    }
    // A real response from the server, even if it's an error — we're online.
    reportNetworkOk();
    throw res.error;
  }
  reportNetworkOk();
  return res.data;
}
