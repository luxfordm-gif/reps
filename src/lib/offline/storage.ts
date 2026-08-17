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

export function writeJson(key: string, value: unknown): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Almost always a quota error. Free up every cache entry (the outbox is
    // deliberately left alone) and try once more.
    dropAllCaches();
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }
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

/** Wipe every cached server read (all users). The outbox survives. */
export function dropAllCaches(): void {
  if (typeof window === 'undefined') return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(CACHE_PREFIX)) doomed.push(k);
    }
    for (const k of doomed) window.localStorage.removeItem(k);
  } catch {
    // ignore
  }
}

/** Cache entry names for a user that start with `namePrefix`. */
export function listCacheNames(userId: string | null, namePrefix: string): string[] {
  if (!userId || typeof window === 'undefined') return [];
  const out: string[] = [];
  try {
    const full = cacheKey(userId, namePrefix);
    const strip = cacheKey(userId, '').length;
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(full)) out.push(k.slice(strip));
    }
  } catch {
    // ignore
  }
  return out;
}

/** Drop the caches for keys matching a prefix, e.g. all cached session sets. */
export function dropCachesStartingWith(userId: string | null, namePrefix: string): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    const prefix = cacheKey(userId, namePrefix);
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(prefix)) doomed.push(k);
    }
    for (const k of doomed) window.localStorage.removeItem(k);
  } catch {
    // ignore
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
