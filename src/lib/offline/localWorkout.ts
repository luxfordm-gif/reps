// On-device mirror of the workout tables.
//
// Every session and set the app sees — whether it came back from Supabase or
// was created on the phone with no signal — is written here, so the logger can
// render a workout end to end without a single request. Server reads overwrite
// the mirror when they succeed; when they fail we read straight out of it.

import type { LoggedSet, SessionRow } from '../sessionsApi';
import { readCache, writeCache, dropCache, listCacheNames } from './storage';

const SESSIONS_KEY = 'sessions';
const SETS_PREFIX = 'sets.';
const FINISHED_KEY = 'finishedSessions';
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
  const kept = sorted.slice(0, MAX_SESSIONS_KEPT);
  writeCache(userId, SESSIONS_KEY, kept);
  pruneOrphanSets(userId, new Set(kept.map((s) => s.id)));
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
}

export function removeOpenLocalSessions(userId: string | null): void {
  if (!userId) return;
  const all = getLocalSessions(userId);
  for (const s of all) {
    if (!s.completed_at) dropCache(userId, SETS_PREFIX + s.id);
  }
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
  const byId = new Map<string, LoggedSet>();
  for (const s of serverSets) byId.set(s.id, s);
  for (const s of local) {
    if (pendingIds.has(s.id) || !byId.has(s.id)) {
      // Unsynced local row, or one the server hasn't returned — keep it only
      // while it's still queued, otherwise the server is the source of truth
      // (a set deleted elsewhere shouldn't reappear forever).
      if (pendingIds.has(s.id)) byId.set(s.id, s);
    }
  }
  const merged = [...byId.values()].sort((a, b) =>
    a.completed_at < b.completed_at ? -1 : 1
  );
  saveLocalSets(userId, sessionId, merged);
  return merged;
}
