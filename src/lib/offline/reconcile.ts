// Checking that what left the queue actually arrived.
//
// The outbox knows when a write is still waiting, and it now keeps retrying
// instead of quietly dropping anything. But there is one thing it can't tell
// us: whether a write it stopped tracking ever reached the server at all — a
// response we never saw, a build that discarded the entry, a row deleted by
// something else. That gap is why a workout logged in a dead spot could end up
// as an empty session in history.
//
// So on the first launch with signal after training, we ask the server which
// rows it actually has for the last few workouts, and re-send anything the
// device holds that the server doesn't. Every replay is an upsert keyed on the
// id the device minted, so doing this when everything is fine costs one small
// query and changes nothing.

import { supabase, currentUserId } from '../supabase';
import { isReachable, query } from './net';
import { enqueue, pendingSetIds, requestFlush } from './outbox';
import { readCache, writeCache } from './storage';
import {
  finishedAt,
  getLocalSessions,
  getLocalSets,
  getUnverifiedSets,
  markSetsVerified,
  removeLocalSession,
} from './localWorkout';

const HEALTH_KEY = 'syncHealth';
/** Don't re-check more often than this; nothing changes in between. */
const THROTTLE_MS = 5 * 60 * 1000;
const DEFAULT_SESSIONS = 3;
const DEFAULT_MAX_AGE_DAYS = 14;

export interface SyncHealth {
  checkedAt: string;
  lastSessionId: string | null;
  lastSessionCompletedAt: string | null;
  /** Every set this device holds for the checked workouts is on the server. */
  verified: boolean;
  missingSets: number;
  requeued: number;
}

export function getSyncHealth(userId: string | null): SyncHealth | null {
  return readCache<SyncHealth>(userId, HEALTH_KEY);
}

interface ServerSession {
  id: string;
  completed_at: string | null;
}

interface ServerSetId {
  id: string;
  session_id: string;
}

/**
 * Compare the last few workouts on this device against the server and re-queue
 * whatever is missing. Returns null when it didn't run (offline, signed out, or
 * checked a moment ago).
 */
export async function reconcileRecentWorkouts(
  options: { sessions?: number; maxAgeDays?: number; force?: boolean } = {}
): Promise<SyncHealth | null> {
  if (!isReachable()) return null;
  const userId = await currentUserId();
  if (!userId) return null;

  const previous = getSyncHealth(userId);
  if (
    !options.force &&
    previous &&
    Date.now() - new Date(previous.checkedAt).getTime() < THROTTLE_MS
  ) {
    return previous;
  }

  const maxAgeDays = options.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
  const local = getLocalSessions(userId)
    .filter((s) => s.started_at >= cutoff)
    .sort((a, b) => (a.started_at < b.started_at ? 1 : -1));

  // The recent finished workouts, plus anything the device knows is unfinished
  // business: a session the server never acknowledged, or one still holding
  // sets no server read has ever returned.
  const unverifiedSessions = new Set(getUnverifiedSets(userId).map((u) => u.sessionId));
  const candidates = local.filter(
    (s, i) =>
      (s.completed_at != null && i < (options.sessions ?? DEFAULT_SESSIONS)) ||
      !s.synced ||
      unverifiedSessions.has(s.id)
  );
  if (candidates.length === 0) return previous ?? null;

  const ids = candidates.map((s) => s.id);
  let serverSessions: ServerSession[];
  let serverSets: ServerSetId[];
  try {
    serverSessions =
      ((await query(supabase.from('sessions').select('id, completed_at').in('id', ids), {
        label: 'reconcile:sessions',
      })) as ServerSession[]) ?? [];
    serverSets =
      ((await query(
        supabase.from('logged_sets').select('id, session_id').in('session_id', ids),
        { label: 'reconcile:sets' }
      )) as ServerSetId[]) ?? [];
  } catch {
    // No signal, or the read failed — leave the last known health alone.
    return previous ?? null;
  }

  const sessionById = new Map(serverSessions.map((s) => [s.id, s]));
  const setIdsOnServer = new Set(serverSets.map((s) => s.id));
  // Everything the server just listed is confirmed.
  markSetsVerified(userId, setIdsOnServer);

  const pending = pendingSetIds();
  const stillUnverified = new Set(getUnverifiedSets(userId).map((u) => u.id));
  let requeued = 0;
  let missingSets = 0;

  for (const session of candidates) {
    const onServer = sessionById.get(session.id);
    if (!onServer) {
      if (session.synced) {
        // The server had this workout and no longer does — deleted on another
        // device. Follow suit rather than resurrecting it.
        removeLocalSession(userId, session.id);
        continue;
      }
      enqueue(userId, {
        kind: 'create_session',
        row: {
          id: session.id,
          training_day_id: session.training_day_id,
          started_at: session.started_at,
        },
      });
      requeued += 1;
    }
    const finished = finishedAt(userId, session.id);
    if (onServer && onServer.completed_at == null && finished) {
      // Finished on this phone, still "in progress" on the server.
      enqueue(userId, { kind: 'complete_session', id: session.id, completed_at: finished });
      requeued += 1;
    }
    for (const set of getLocalSets(userId, session.id)) {
      if (setIdsOnServer.has(set.id)) continue;
      if (pending.has(set.id)) {
        missingSets += 1; // already queued — it will land on its own
        continue;
      }
      if (!stillUnverified.has(set.id) && session.synced) {
        // Not written by this device and not tracked as unsent: it was removed
        // somewhere else, so don't push it back.
        continue;
      }
      missingSets += 1;
      enqueue(userId, {
        kind: 'log_set',
        row: {
          id: set.id,
          session_id: set.session_id,
          plan_exercise_id: set.plan_exercise_id,
          exercise_display_name: set.exercise_display_name,
          exercise_normalized_name: set.exercise_normalized_name,
          set_index: set.set_index,
          drop_index: set.drop_index,
          weight: set.weight,
          reps: set.reps,
          hold_seconds: set.hold_seconds,
          completed_at: set.completed_at,
        },
      });
      requeued += 1;
    }
  }

  const newest = candidates.find((s) => s.completed_at != null) ?? null;
  const health: SyncHealth = {
    checkedAt: new Date().toISOString(),
    lastSessionId: newest?.id ?? null,
    lastSessionCompletedAt: newest?.completed_at ?? null,
    verified: missingSets === 0 && requeued === 0,
    missingSets,
    requeued,
  };
  writeCache(userId, HEALTH_KEY, health);
  if (requeued > 0) {
    console.warn('[reconcile] re-queued', requeued, 'writes the server was missing');
    requestFlush();
  }
  return health;
}
