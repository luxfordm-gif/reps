// On-device mirror of the workout tables.
//
// Every session and set the app sees — whether it came back from Supabase or
// was created on the phone with no signal — is written here, so the logger can
// render a workout end to end without a single request. Server reads overwrite
// the mirror when they succeed; when they fail we read straight out of it.

import type { LoggedSet, SessionRow } from '../sessionsApi';
import {
  readCache,
  writeCache,
  dropCache,
  listCacheNames,
  allKeys,
  parseCacheKey,
  readJson,
  removeKey,
  setEvictionPlan,
} from './storage';

const SESSIONS_KEY = 'sessions';
const SETS_PREFIX = 'sets.';
const NOTES_PREFIX = 'notes.';
const FINISHED_KEY = 'finishedSessions';
const UNVERIFIED_KEY = 'unverifiedSets';
/** Sets are kept for the most recent sessions only, so localStorage can't grow
 *  without bound on a phone that's been logging for a year. */
const MAX_SESSIONS_KEPT = 20;
/** How many "I finished this one" receipts to keep. Only needed until the
 *  server agrees, so a short list is plenty. */
const MAX_FINISHED_KEPT = 20;

export interface LocalSession {
  id: string;
  training_day_id: string;
  started_at: string;
  completed_at: string | null;
  /** False until the row has been acknowledged by the server. */
  synced: boolean;
}

export function getLocalSessions(userId: string | null): LocalSession[] {
  return readCache<LocalSession[]>(userId, SESSIONS_KEY) ?? [];
}

function saveLocalSessions(userId: string | null, sessions: LocalSession[]): void {
  if (!userId) return;
  const sorted = [...sessions].sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
  // Browsing History mirrors old workouts too, so the cap can bite. A session
  // the server hasn't confirmed is never the one to drop: it only exists here.
  const atRisk = atRiskSessionIds(userId);
  const kept = sorted.filter((s) => atRisk.has(s.id) || !s.synced);
  for (const s of sorted) {
    if (kept.length >= MAX_SESSIONS_KEPT) break;
    if (!kept.includes(s)) kept.push(s);
  }
  kept.sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
  writeCache(userId, SESSIONS_KEY, kept);
  pruneOrphanSets(userId, new Set(kept.map((s) => s.id)));
}

/** Sessions whose sets still only exist on this device. */
function atRiskSessionIds(userId: string): Set<string> {
  const ids = new Set(getUnverifiedSets(userId).map((u) => u.sessionId));
  for (const f of getFinishedSessions(userId)) ids.add(f.id);
  for (const id of queuedSessionIds()) ids.add(id);
  return ids;
}

/** Sets are also mirrored when browsing old workouts in History; drop any that
 *  no longer belong to a session we're keeping so storage stays bounded. */
function pruneOrphanSets(userId: string, keepIds: Set<string>): void {
  for (const name of listCacheNames(userId, SETS_PREFIX)) {
    const sessionId = name.slice(SETS_PREFIX.length);
    if (!keepIds.has(sessionId)) dropCache(userId, name);
  }
}

export function upsertLocalSession(
  userId: string | null,
  session: LocalSession
): void {
  if (!userId) return;
  const all = getLocalSessions(userId);
  const idx = all.findIndex((s) => s.id === session.id);
  if (idx >= 0) {
    const existing = all[idx];
    all[idx] = { ...existing, ...session };
    // The server is the source of truth for everything except "is it over".
    // A session the user finished on this phone stays finished even while the
    // server still lists it as open — otherwise a completion that failed to
    // send comes back as a workout in progress on the next launch.
    if (session.completed_at == null && existing.completed_at != null) {
      all[idx].completed_at = existing.completed_at;
    }
  } else {
    all.push(session);
  }
  saveLocalSessions(userId, all);
}

interface FinishedSession {
  id: string;
  completedAt: string;
}

/**
 * Remember that the user finished a workout, independently of the session
 * mirror. This is the receipt the app checks before believing a server row that
 * still says "in progress".
 */
export function markSessionFinished(
  userId: string | null,
  id: string,
  completedAt: string
): void {
  if (!userId) return;
  const kept = getFinishedSessions(userId).filter((f) => f.id !== id);
  kept.push({ id, completedAt });
  writeCache(userId, FINISHED_KEY, kept.slice(-MAX_FINISHED_KEPT));
}

export function getFinishedSessions(userId: string | null): FinishedSession[] {
  return readCache<FinishedSession[]>(userId, FINISHED_KEY) ?? [];
}

/** When the user finished this session on this device, if they did. */
export function finishedAt(userId: string | null, id: string): string | null {
  const receipt = getFinishedSessions(userId).find((f) => f.id === id);
  if (receipt) return receipt.completedAt;
  return getLocalSessions(userId).find((s) => s.id === id)?.completed_at ?? null;
}

/** Forget the receipt once the server has caught up (or the row is gone). */
export function forgetFinishedSession(userId: string | null, id: string): void {
  if (!userId) return;
  const kept = getFinishedSessions(userId).filter((f) => f.id !== id);
  writeCache(userId, FINISHED_KEY, kept);
}

export function markLocalSessionSynced(userId: string | null, id: string): void {
  if (!userId) return;
  const all = getLocalSessions(userId);
  const row = all.find((s) => s.id === id);
  if (!row) return;
  row.synced = true;
  saveLocalSessions(userId, all);
}

export function completeLocalSession(
  userId: string | null,
  id: string,
  completedAt: string
): void {
  if (!userId) return;
  // The receipt is written whether or not the session is still in the mirror,
  // so an old workout finished on a fresh install is still remembered.
  markSessionFinished(userId, id, completedAt);
  const all = getLocalSessions(userId);
  const row = all.find((s) => s.id === id);
  if (!row) return;
  row.completed_at = completedAt;
  saveLocalSessions(userId, all);
}

export function removeLocalSession(userId: string | null, id: string): void {
  if (!userId) return;
  saveLocalSessions(
    userId,
    getLocalSessions(userId).filter((s) => s.id !== id)
  );
  dropCache(userId, SETS_PREFIX + id);
  // A session the user threw away must not be resurrected by reconciliation.
  forgetUnverifiedForSessions(userId, new Set([id]));
}

export function removeOpenLocalSessions(userId: string | null): void {
  if (!userId) return;
  const all = getLocalSessions(userId);
  const doomed = new Set<string>();
  for (const s of all) {
    if (!s.completed_at) {
      dropCache(userId, SETS_PREFIX + s.id);
      doomed.add(s.id);
    }
  }
  forgetUnverifiedForSessions(userId, doomed);
  saveLocalSessions(
    userId,
    all.filter((s) => s.completed_at)
  );
}

export function getLocalOpenSession(userId: string | null): LocalSession | null {
  const open = getLocalSessions(userId).filter((s) => !s.completed_at);
  if (open.length === 0) return null;
  return open.reduce((a, b) => (a.started_at > b.started_at ? a : b));
}

export function toSessionRow(s: LocalSession): SessionRow {
  return {
    id: s.id,
    training_day_id: s.training_day_id,
    started_at: s.started_at,
    completed_at: s.completed_at,
  };
}

export function getLocalSets(userId: string | null, sessionId: string): LoggedSet[] {
  return readCache<LoggedSet[]>(userId, SETS_PREFIX + sessionId) ?? [];
}

export function saveLocalSets(
  userId: string | null,
  sessionId: string,
  sets: LoggedSet[]
): void {
  if (!userId) return;
  writeCache(userId, SETS_PREFIX + sessionId, sets);
}

export function upsertLocalSet(userId: string | null, set: LoggedSet): void {
  if (!userId) return;
  const sets = getLocalSets(userId, set.session_id);
  const idx = sets.findIndex((s) => s.id === set.id);
  if (idx >= 0) sets[idx] = { ...sets[idx], ...set };
  else sets.push(set);
  saveLocalSets(userId, set.session_id, sets);
}

export function patchLocalSet(
  userId: string | null,
  setId: string,
  patch: Partial<LoggedSet>
): LoggedSet | null {
  if (!userId) return null;
  for (const session of getLocalSessions(userId)) {
    const sets = getLocalSets(userId, session.id);
    const idx = sets.findIndex((s) => s.id === setId);
    if (idx >= 0) {
      sets[idx] = { ...sets[idx], ...patch };
      saveLocalSets(userId, session.id, sets);
      return sets[idx];
    }
  }
  return null;
}

/**
 * Fold rows fetched from the server into what's on the device, keeping any
 * local row the server hasn't seen yet (it's still in the outbox) and
 * preferring the local copy of a row that's been edited since.
 */
export function mergeServerSets(
  userId: string | null,
  sessionId: string,
  serverSets: LoggedSet[],
  pendingIds: Set<string>
): LoggedSet[] {
  const local = getLocalSets(userId, sessionId);
  const unverified = unverifiedSetIds(userId);
  const byId = new Map<string, LoggedSet>();
  for (const s of serverSets) byId.set(s.id, s);
  // Everything the server just handed back is confirmed — stop tracking it.
  markSetsVerified(
    userId,
    serverSets.map((s) => s.id)
  );
  for (const s of local) {
    // Keep a local row while it's still queued, or while this device wrote it
    // and the server has never returned it: dropping those is how a set logged
    // in a dead spot used to disappear from history. Anything else, the server
    // is the source of truth (a set deleted elsewhere shouldn't come back).
    if (!byId.has(s.id) && (pendingIds.has(s.id) || unverified.has(s.id))) {
      byId.set(s.id, s);
    }
  }
  const merged = [...byId.values()].sort((a, b) =>
    a.completed_at < b.completed_at ? -1 : 1
  );
  saveLocalSets(userId, sessionId, merged);
  return merged;
}

/**
 * Sets this device wrote that the server has never handed back.
 *
 * A set logged with no signal only exists here and in the outbox. Once the
 * outbox entry is gone we can no longer tell "the server has it" from "the
 * write was lost", which is how a workout used to quietly turn into an empty
 * one. This index is the difference: an id stays in it until a server read
 * returns that row, and reconciliation re-sends anything still listed.
 */
export interface UnverifiedSet {
  id: string;
  sessionId: string;
  at: string;
}

/** Plenty for months of offline training, and small enough to keep. */
const MAX_UNVERIFIED_KEPT = 500;

export function getUnverifiedSets(userId: string | null): UnverifiedSet[] {
  return readCache<UnverifiedSet[]>(userId, UNVERIFIED_KEY) ?? [];
}

export function markSetUnverified(userId: string | null, set: LoggedSet): void {
  if (!userId) return;
  const kept = getUnverifiedSets(userId).filter((u) => u.id !== set.id);
  kept.push({ id: set.id, sessionId: set.session_id, at: new Date().toISOString() });
  writeCache(userId, UNVERIFIED_KEY, kept.slice(-MAX_UNVERIFIED_KEPT));
}

/** The server returned these rows, so they're real — stop tracking them. */
export function markSetsVerified(userId: string | null, ids: Iterable<string>): void {
  if (!userId) return;
  const drop = new Set(ids);
  if (drop.size === 0) return;
  const current = getUnverifiedSets(userId);
  const kept = current.filter((u) => !drop.has(u.id));
  if (kept.length !== current.length) writeCache(userId, UNVERIFIED_KEY, kept);
}

function forgetUnverifiedForSessions(userId: string | null, sessionIds: Set<string>): void {
  if (!userId || sessionIds.size === 0) return;
  const current = getUnverifiedSets(userId);
  const kept = current.filter((u) => !sessionIds.has(u.sessionId));
  if (kept.length !== current.length) writeCache(userId, UNVERIFIED_KEY, kept);
}

/** Ids of sets on this device the server has never confirmed. */
export function unverifiedSetIds(userId: string | null): Set<string> {
  return new Set(getUnverifiedSets(userId).map((u) => u.id));
}

// --- Making room without losing a workout -----------------------------------

const OUTBOX_KEY = 'reps.outbox';

/** Session ids with writes still queued. Read straight from the outbox's
 *  storage key rather than importing it — the outbox imports this module, and
 *  eviction must not depend on module initialisation order. */
function queuedSessionIds(): Set<string> {
  const out = new Set<string>();
  const entries = readJson<{ op: { kind: string; id?: string; row?: { id?: string; session_id?: string } } }[]>(
    OUTBOX_KEY
  );
  if (!entries) return out;
  for (const e of entries) {
    const op = e?.op;
    if (!op) continue;
    if (op.kind === 'create_session' && op.row?.id) out.add(op.row.id);
    else if (op.kind === 'log_set' && op.row?.session_id) out.add(op.row.session_id);
    else if ((op.kind === 'complete_session' || op.kind === 'session_notes') && op.id) {
      out.add(op.id);
    }
  }
  return out;
}

/**
 * What may be thrown away when the device is out of room, most expendable
 * first.
 *
 * The rule that matters: nothing belonging to a workout the server hasn't
 * confirmed is ever offered up. Everything else is a copy of something the
 * server can give us back.
 */
function tieredEviction(userId: string | null, protectedKey: string): string[] {
  // Without a signed-in id we can't tell this account's data from another's,
  // and guessing would mean deleting someone's unsynced workout. Offer nothing.
  if (!userId) return [];
  const sessions = getLocalSessions(userId);
  const finished = new Set(getFinishedSessions(userId).map((f) => f.id));
  const queued = queuedSessionIds();
  const unverified = new Set(getUnverifiedSets(userId).map((u) => u.sessionId));
  const safeSessionIds = new Set(
    sessions
      .filter(
        (s) =>
          s.completed_at != null &&
          s.synced &&
          !finished.has(s.id) &&
          !queued.has(s.id) &&
          !unverified.has(s.id)
      )
      // Oldest first: the workout you did in March is the one you'll miss least.
      .sort((a, b) => (a.started_at < b.started_at ? -1 : 1))
      .map((s) => s.id)
  );

  const tier1: string[] = []; // another account's leftovers
  const tier2: string[] = []; // pure server read-throughs
  const tier3: string[] = []; // mirrors of workouts the server already has
  const tier4: string[] = []; // "last time" caches, oldest first
  const tier5: string[] = []; // the plan itself, as a final resort

  const lastSetsByAge: { key: string; at: string }[] = [];

  for (const key of allKeys()) {
    if (key === protectedKey) continue;
    const parsed = parseCacheKey(key);
    if (!parsed) continue; // not a cache — outbox, user id, unit prefs
    if (parsed.userId !== userId) {
      tier1.push(key);
      continue;
    }
    const name = parsed.name;
    if (name === SESSIONS_KEY || name === FINISHED_KEY || name === UNVERIFIED_KEY) continue;
    if (name === 'home' || name.startsWith('alternatives.') || name.startsWith('water.')) {
      tier2.push(key);
    } else if (name === 'bodyWeights') {
      tier2.push(key);
    } else if (name.startsWith(SETS_PREFIX) || name.startsWith(NOTES_PREFIX)) {
      const sessionId = name.slice(name.indexOf('.') + 1);
      if (safeSessionIds.has(sessionId)) tier3.push(key);
    } else if (name.startsWith('lastSets.')) {
      const entry = readJson<{ cachedAt?: string }>(key);
      lastSetsByAge.push({ key, at: entry?.cachedAt ?? '' });
    } else if (name === 'activePlan') {
      tier5.push(key);
    } else {
      tier2.push(key);
    }
  }

  lastSetsByAge.sort((a, b) => (a.at < b.at ? -1 : 1));
  for (const l of lastSetsByAge) tier4.push(l.key);

  return [...tier1, ...tier2, ...tier3, ...tier4, ...tier5];
}

/**
 * Housekeeping at launch: drop another account's caches and any mirror left
 * behind by a session that's no longer tracked, so the phone has headroom
 * before the user is standing in a gym with no signal.
 */
export function pruneCaches(userId: string | null): void {
  // Nothing to compare against — better a full cache than a wiped one.
  if (!userId) return;
  const keep = new Set(getLocalSessions(userId).map((s) => s.id));
  for (const key of allKeys()) {
    const parsed = parseCacheKey(key);
    if (!parsed) continue;
    if (parsed.userId !== userId) {
      removeKey(key);
      continue;
    }
    if (parsed.name.startsWith(SETS_PREFIX)) {
      const sessionId = parsed.name.slice(SETS_PREFIX.length);
      if (!keep.has(sessionId)) removeKey(key);
    }
  }
}

/** Teach the storage layer which caches it may sacrifice. Called with the
 *  signed-in user so eviction can tell this account's data from another's. */
export function installEvictionPlan(getUserId: () => string | null): void {
  setEvictionPlan((protectedKey) => tieredEviction(getUserId(), protectedKey));
}
