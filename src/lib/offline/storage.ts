// Small localStorage wrapper for the offline layer.
//
// Two kinds of data live in here:
//   - caches   ("reps.cache.…")  — last-known-good copies of server reads, so
//                                  screens can render with no signal. Safe to
//                                  drop at any time.
//   - the outbox ("reps.outbox") — writes the user made offline that haven't
//                                  reached Supabase yet. NEVER dropped
//                                  automatically; losing it loses their sets.
//
// Everything cached is namespaced by user id so a second account signing in on
// the same phone can't read the first one's data.

const CACHE_PREFIX = 'reps.cache.';

export function cacheKey(userId: string, name: string): string {
  return `${CACHE_PREFIX}${userId}.${name}`;
}

/** The inverse of `cacheKey`, for code that has to reason about keys it finds
 *  rather than keys it wrote (eviction, cleaning up after another account). */
export function parseCacheKey(key: string): { userId: string; name: string } | null {
  if (!key.startsWith(CACHE_PREFIX)) return null;
  const rest = key.slice(CACHE_PREFIX.length);
  const dot = rest.indexOf('.');
  if (dot <= 0) return null;
  return { userId: rest.slice(0, dot), name: rest.slice(dot + 1) };
}

/** Every localStorage key, read into an array first — removing entries while
 *  iterating by index silently skips half of them. */
export function allKeys(): string[] {
  if (typeof window === 'undefined') return [];
  const out: string[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k) out.push(k);
    }
  } catch {
    // ignore
  }
  return out;
}

export function readJson<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    // Corrupt or unreadable entry — treat it as a cache miss.
    return null;
  }
}

/**
 * Decides what may be thrown away, most expendable first, when the device runs
 * out of room. Registered by `localWorkout` (which is the module that knows
 * which sessions are still unsynced); until then only the obviously disposable
 * read-through caches are offered up.
 */
export type EvictionPlan = (protectedKey: string) => string[];

function defaultEvictionPlan(protectedKey: string): string[] {
  const out: string[] = [];
  for (const key of allKeys()) {
    if (key === protectedKey) continue;
    const parsed = parseCacheKey(key);
    if (!parsed) continue;
    // Without the session bookkeeping we can only safely drop things that are
    // pure copies of server reads.
    if (
      parsed.name === 'home' ||
      parsed.name.startsWith('recap.') ||
      parsed.name.startsWith('alternatives.')
    ) {
      out.push(key);
    }
  }
  return out;
}

let evictionPlan: EvictionPlan = defaultEvictionPlan;

export function setEvictionPlan(plan: EvictionPlan): void {
  evictionPlan = plan;
}

/**
 * Write, and if the device is out of room free up space a little at a time
 * rather than all at once.
 *
 * The old behaviour here was to wipe every cache on the first quota error,
 * which took the in-progress workout's sets with it — and the write that
 * triggers the quota error is usually the outbox saving a set logged offline,
 * so it fired at the worst possible moment. Now we drop one expendable entry
 * at a time and retry after each, and the eviction plan refuses to name
 * anything the user hasn't synced yet.
 */
export function writeJson(key: string, value: unknown): boolean {
  if (typeof window === 'undefined') return false;
  const raw = JSON.stringify(value);
  try {
    window.localStorage.setItem(key, raw);
    return true;
  } catch {
    // Fall through to eviction.
  }
  for (const doomed of evictionPlan(key)) {
    if (doomed === key) continue;
    removeKey(doomed);
    try {
      window.localStorage.setItem(key, raw);
      return true;
    } catch {
      // Still short — keep freeing.
    }
  }
  return false;
}

export function removeKey(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/** Read a namespaced cache entry. */
export function readCache<T>(userId: string | null, name: string): T | null {
  if (!userId) return null;
  return readJson<T>(cacheKey(userId, name));
}

/** Write a namespaced cache entry. */
export function writeCache(userId: string | null, name: string, value: unknown): void {
  if (!userId) return;
  writeJson(cacheKey(userId, name), value);
}

export function dropCache(userId: string | null, name: string): void {
  if (!userId) return;
  removeKey(cacheKey(userId, name));
}

/**
 * Wipe every cached server read (all users). The outbox survives.
 *
 * Only for signing out — a quota error takes the measured path in `writeJson`,
 * because this one throws away workouts that haven't reached the server.
 */
export function dropAllCaches(): void {
  for (const k of allKeys()) {
    if (k.startsWith(CACHE_PREFIX)) removeKey(k);
  }
}

/** Cache entry names for a user that start with `namePrefix`. */
export function listCacheNames(userId: string | null, namePrefix: string): string[] {
  if (!userId) return [];
  const full = cacheKey(userId, namePrefix);
  const strip = cacheKey(userId, '').length;
  return allKeys()
    .filter((k) => k.startsWith(full))
    .map((k) => k.slice(strip));
}

/** Drop the caches for keys matching a prefix, e.g. all cached session sets. */
export function dropCachesStartingWith(userId: string | null, namePrefix: string): void {
  if (!userId) return;
  const prefix = cacheKey(userId, namePrefix);
  for (const k of allKeys()) {
    if (k.startsWith(prefix)) removeKey(k);
  }
}

/** UUID for rows created on the device, so an offline insert keeps its id
 *  once it syncs (and later edits to the same row line up). */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for non-secure contexts (local network testing).
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += '-';
    else if (i === 14) out += '4';
    else if (i === 19) out += hex[(Math.random() * 4) | 8];
    else out += hex[(Math.random() * 16) | 0];
  }
  return out;
}
