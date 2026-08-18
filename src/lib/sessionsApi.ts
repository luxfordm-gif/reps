import { supabase, currentUserId, currentUserIdSync } from './supabase';
import { getCachedActivePlan } from './plansApi';
import { isOfflineError, isReachable, isTransportError, query } from './offline/net';
import { enqueue, pendingSetIds, requestFlush } from './offline/outbox';
import { newId, readCache, writeCache } from './offline/storage';
import {
  completeLocalSession,
  finishedAt,
  forgetFinishedSession,
  getLocalOpenSession,
  getLocalSessions,
  getLocalSets,
  markLocalSessionSynced,
  mergeServerSets,
  patchLocalSet,
  removeLocalSession,
  removeOpenLocalSessions,
  toSessionRow,
  upsertLocalSession,
  upsertLocalSet,
} from './offline/localWorkout';

export interface SessionRow {
  id: string;
  training_day_id: string;
  started_at: string;
  completed_at: string | null;
  feedback_for_self?: string | null;
  notes_to_coach?: string | null;
}

export interface SessionNotes {
  feedbackForSelf: string;
  notesToCoach: string;
}

/** Notes typed on the completion screen, kept on the device until they sync. */
interface LocalNotes {
  feedback_for_self: string | null;
  notes_to_coach: string | null;
}

function notesCacheName(sessionId: string): string {
  return `notes.${sessionId}`;
}

export async function getSessionNotes(sessionId: string): Promise<SessionNotes> {
  const userId = await currentUserId();
  const local = readCache<LocalNotes>(userId, notesCacheName(sessionId));
  try {
    const data = await query(
      supabase
        .from('sessions')
        .select('feedback_for_self, notes_to_coach')
        .eq('id', sessionId)
        .maybeSingle(),
      { label: 'getSessionNotes' }
    );
    const row = data as LocalNotes | null;
    // Anything typed offline hasn't reached the server yet, so it wins.
    return {
      feedbackForSelf: local?.feedback_for_self ?? row?.feedback_for_self ?? '',
      notesToCoach: local?.notes_to_coach ?? row?.notes_to_coach ?? '',
    };
  } catch (e) {
    if (!isOfflineError(e)) throw e;
    return {
      feedbackForSelf: local?.feedback_for_self ?? '',
      notesToCoach: local?.notes_to_coach ?? '',
    };
  }
}

export async function updateSessionNotes(
  sessionId: string,
  patch: Partial<SessionNotes>
): Promise<void> {
  const update: Record<string, string | null> = {};
  if ('feedbackForSelf' in patch) {
    update.feedback_for_self = patch.feedbackForSelf?.trim() ? patch.feedbackForSelf.trim() : null;
  }
  if ('notesToCoach' in patch) {
    update.notes_to_coach = patch.notesToCoach?.trim() ? patch.notesToCoach.trim() : null;
  }
  const userId = await currentUserId();
  const cacheName = notesCacheName(sessionId);
  const merged = { ...(readCache<LocalNotes>(userId, cacheName) ?? {}), ...update };
  try {
    await query(supabase.from('sessions').update(update).eq('id', sessionId).select('id'), {
      label: 'updateSessionNotes',
    });
    writeCache(userId, cacheName, merged);
  } catch (e) {
    if (!isOfflineError(e) || !userId) throw e;
    writeCache(userId, cacheName, merged);
    enqueue(userId, { kind: 'session_notes', id: sessionId, patch: update });
  }
}

export interface WeekNoteRow {
  sessionId: string;
  completedAt: string;
  dayName: string;
  feedbackForSelf: string | null;
  notesToCoach: string | null;
}

export async function getRecentSessionNotes(daysBack = 7): Promise<WeekNoteRow[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('sessions')
    .select('id, completed_at, feedback_for_self, notes_to_coach, training_days(name)')
    .eq('user_id', userId)
    .not('completed_at', 'is', null)
    .gte('completed_at', since)
    .order('completed_at', { ascending: true });
  if (error) throw error;
  type Row = {
    id: string;
    completed_at: string;
    feedback_for_self: string | null;
    notes_to_coach: string | null;
    training_days: { name: string } | { name: string }[] | null;
  };
  return ((data as Row[]) ?? []).map((r) => {
    const td = Array.isArray(r.training_days) ? r.training_days[0] : r.training_days;
    return {
      sessionId: r.id,
      completedAt: r.completed_at,
      dayName: td?.name ?? 'Workout',
      feedbackForSelf: r.feedback_for_self,
      notesToCoach: r.notes_to_coach,
    };
  });
}

export interface LoggedSet {
  id: string;
  session_id: string;
  plan_exercise_id: string | null;
  exercise_display_name: string;
  exercise_normalized_name: string;
  set_index: number;
  drop_index: number;
  weight: number | null;
  reps: number | null;
  hold_seconds: number | null;
  completed_at: string;
}

export async function getRecentSessionPositions(
  trainingDayIds: string[],
  limit: number = 6
): Promise<number[]> {
  const userId = await currentUserId();
  if (!userId || trainingDayIds.length === 0) return [];
  let data;
  try {
    data = await query(
      supabase
        .from('sessions')
        .select('training_day_id, completed_at, training_days(position)')
        .eq('user_id', userId)
        .not('completed_at', 'is', null)
        .in('training_day_id', trainingDayIds)
        .order('completed_at', { ascending: false })
        .limit(limit),
      { label: 'getRecentSessionPositions' }
    );
  } catch {
    return [];
  }
  type Row = {
    training_day_id: string;
    completed_at: string;
    training_days: { position: number } | { position: number }[] | null;
  };
  return ((data as Row[]) ?? [])
    .map((r) => {
      const td = Array.isArray(r.training_days) ? r.training_days[0] : r.training_days;
      return td?.position ?? -1;
    })
    .filter((p) => p >= 0);
}

export async function getLastCompletedTrainingDayName(
  sinceIso?: string | null
): Promise<string | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  let builder = supabase
    .from('sessions')
    .select('training_day_id, completed_at, training_days(name)')
    .eq('user_id', userId)
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(1);
  if (sinceIso) builder = builder.gte('completed_at', sinceIso);
  let data;
  try {
    data = await query(builder.maybeSingle(), {
      label: 'getLastCompletedTrainingDayName',
    });
  } catch {
    return null;
  }
  if (!data) return null;
  // training_days may come through as object or array depending on PostgREST inference
  const td = (data as { training_days: { name: string } | { name: string }[] | null }).training_days;
  if (!td) return null;
  if (Array.isArray(td)) return td[0]?.name ?? null;
  return td.name ?? null;
}

export interface ActiveSessionContext {
  sessionId: string;
  startedAt: string;
  trainingDayId: string;
  trainingDayName: string;
  lastPlanExerciseId: string | null;
}

function cachedTrainingDayName(
  userId: string | null,
  trainingDayId: string
): string | null {
  const plan = getCachedActivePlan(userId);
  return plan?.training_days?.find((d) => d.id === trainingDayId)?.name ?? null;
}

/** The in-progress workout as the device knows it, for when we can't ask the
 *  server (or the session was started with no signal in the first place). */
function localActiveSession(userId: string | null): ActiveSessionContext | null {
  const open = getLocalOpenSession(userId);
  if (!open) return null;
  const sets = getLocalSets(userId, open.id);
  const last = [...sets].sort((a, b) => (a.completed_at < b.completed_at ? 1 : -1))[0];
  return {
    sessionId: open.id,
    startedAt: open.started_at,
    trainingDayId: open.training_day_id,
    trainingDayName: cachedTrainingDayName(userId, open.training_day_id) ?? 'Workout',
    lastPlanExerciseId: last?.plan_exercise_id ?? null,
  };
}

/**
 * Drop any session the user has already finished on this device, and re-queue
 * the completion the server never got.
 *
 * Ending a workout is a single write, and if it fails — no signal on the way
 * out of the gym, a blip on the server — the session stays open. Without this,
 * the next launch reads that row back and puts you right back in the middle of
 * a workout you finished yesterday.
 */
function dropFinishedSessions<T extends { id: string; started_at?: string }>(
  userId: string,
  rows: T[]
): T[] {
  const live: T[] = [];
  const abandoned: string[] = [];
  for (const row of rows) {
    const completedAt = finishedAt(userId, row.id);
    if (completedAt) {
      enqueue(userId, {
        kind: 'complete_session',
        id: row.id,
        completed_at: completedAt,
      });
      requestFlush();
      continue;
    }
    // Nothing on this device says it was finished, but a workout can't run for
    // the best part of a day. This is what clears a session stranded by an
    // older version of the app, without the user having to re-enter and end it.
    if (
      row.started_at &&
      Date.now() - new Date(row.started_at).getTime() > ABANDONED_AFTER_MS
    ) {
      abandoned.push(row.id);
      continue;
    }
    live.push(row);
  }
  if (abandoned.length > 0) {
    resolveAbandonedSessions(userId, abandoned).catch(() => {
      // Best effort; it'll be retried the next time the list is read.
    });
  }
  return live;
}

export async function getAnyActiveSession(): Promise<ActiveSessionContext | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  try {
    const data = await query(
      supabase
        .from('sessions')
        .select('id, started_at, training_day_id, training_days(name)')
        .eq('user_id', userId)
        .is('completed_at', null)
        .order('started_at', { ascending: false })
        // More than one, so a stale row we've already finished doesn't hide a
        // workout that really is in progress.
        .limit(5),
      { label: 'getAnyActiveSession' }
    );
    type OpenRow = {
      id: string;
      started_at: string;
      training_day_id: string;
      training_days: { name: string } | { name: string }[] | null;
    };
    const open = dropFinishedSessions(userId, (data as OpenRow[]) ?? []);
    if (open.length === 0) {
      // Nothing genuinely open on the server — but a session started offline
      // hasn't reached it yet, so keep showing that one.
      const local = localActiveSession(userId);
      return local && !localSessionIsSynced(userId, local.sessionId) ? local : null;
    }
    const row = open[0];
    const td = row.training_days;
    const tdObj = Array.isArray(td) ? td[0] : td;
    upsertLocalSession(userId, {
      id: row.id,
      training_day_id: row.training_day_id,
      started_at: row.started_at,
      completed_at: null,
      synced: true,
    });
    const stats = await getSessionStats(row.id);
    return {
      sessionId: row.id,
      startedAt: row.started_at,
      trainingDayId: row.training_day_id,
      trainingDayName: tdObj?.name ?? 'Workout',
      lastPlanExerciseId: stats.lastPlanExerciseId,
    };
  } catch (e) {
    if (!isOfflineError(e)) return null;
    return localActiveSession(userId);
  }
}

function localSessionIsSynced(userId: string | null, sessionId: string): boolean {
  return getLocalSessions(userId).find((s) => s.id === sessionId)?.synced ?? false;
}

export async function getActiveSessionForDay(
  trainingDayId: string
): Promise<SessionRow | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  const localOpen = getLocalSessions(userId).find(
    (s) => !s.completed_at && s.training_day_id === trainingDayId
  );
  try {
    const data = await query(
      supabase
        .from('sessions')
        .select('*')
        .eq('user_id', userId)
        .eq('training_day_id', trainingDayId)
        .is('completed_at', null)
        .order('started_at', { ascending: false })
        .limit(5),
      { label: 'getActiveSessionForDay' }
    );
    const row = dropFinishedSessions(userId, (data as SessionRow[]) ?? [])[0] ?? null;
    if (row) {
      upsertLocalSession(userId, {
        id: row.id,
        training_day_id: row.training_day_id,
        started_at: row.started_at,
        completed_at: null,
        synced: true,
      });
      return row;
    }
    // Nothing on the server: only an unsynced local session counts here.
    return localOpen && !localOpen.synced ? toSessionRow(localOpen) : null;
  } catch {
    // However the read failed, the device knows whether this day has a workout
    // running — falling back to it beats leaving the day screen unusable.
    return localOpen ? toSessionRow(localOpen) : null;
  }
}

export async function getSessionStats(
  sessionId: string
): Promise<{ setsLogged: number; lastPlanExerciseId: string | null }> {
  const userId = await currentUserId();
  try {
    const data = await query(
      supabase
        .from('logged_sets')
        .select('*')
        .eq('session_id', sessionId)
        .order('completed_at', { ascending: false }),
      { label: 'getSessionStats' }
    );
    const rows = mergeServerSets(
      userId,
      sessionId,
      (data as LoggedSet[]) ?? [],
      pendingSetIds()
    ).sort((a, b) => (a.completed_at < b.completed_at ? 1 : -1));
    return {
      setsLogged: rows.length,
      lastPlanExerciseId: rows[0]?.plan_exercise_id ?? null,
    };
  } catch {
    const rows = [...getLocalSets(userId, sessionId)].sort((a, b) =>
      a.completed_at < b.completed_at ? 1 : -1
    );
    return {
      setsLogged: rows.length,
      lastPlanExerciseId: rows[0]?.plan_exercise_id ?? null,
    };
  }
}

export type RecapMedal = 'gold' | 'silver' | 'bronze';

export interface RecapBestSet {
  exercise: string;
  weight: number;
  reps: number;
  /** Medal when today's top set ranks 1st/2nd/3rd amongst the user's all-time distinct top weights for the exercise. */
  medal: RecapMedal | null;
}

export interface SessionRecap {
  setsLogged: number;
  totalWeight: number;
  durationMinutes: number | null;
  bestSets: RecapBestSet[];
  /** Total weight from the last completed session for the same training day, if any. */
  previousTotalWeight: number | null;
  /** Unique body parts trained, in order of first appearance in the session. */
  bodyParts: string[];
}

/**
 * The finish-workout summary, computed from the sets on the device.
 *
 * The completion screen is the one place we're almost guaranteed to be offline
 * — it's the last thing you see before leaving the gym — so it gets a full
 * local build. Medals and the week-on-week volume comparison need the whole
 * history, so they're left out until the session syncs.
 */
function localSessionRecap(userId: string | null, sessionId: string): SessionRecap {
  const sets = getLocalSets(userId, sessionId);
  const session = getLocalSessions(userId).find((s) => s.id === sessionId) ?? null;
  const plan = getCachedActivePlan(userId);
  const bodyPartByExerciseId = new Map<string, string>();
  for (const day of plan?.training_days ?? []) {
    for (const ex of day.plan_exercises ?? []) {
      if (ex.body_part?.trim()) bodyPartByExerciseId.set(ex.id, ex.body_part.trim());
    }
  }

  let totalWeight = 0;
  const bestPerExercise = new Map<string, { weight: number; reps: number }>();
  const bodyParts: string[] = [];
  for (const s of [...sets].sort((a, b) => (a.completed_at < b.completed_at ? -1 : 1))) {
    if (s.weight != null && s.reps != null) {
      totalWeight += s.weight * s.reps;
      const prev = bestPerExercise.get(s.exercise_display_name);
      if (!prev || s.weight > prev.weight) {
        bestPerExercise.set(s.exercise_display_name, { weight: s.weight, reps: s.reps });
      }
    }
    const bp = s.plan_exercise_id ? bodyPartByExerciseId.get(s.plan_exercise_id) : null;
    if (bp && !bodyParts.includes(bp)) bodyParts.push(bp);
  }

  let durationMinutes: number | null = null;
  if (session?.started_at && session.completed_at) {
    const ms = new Date(session.completed_at).getTime() - new Date(session.started_at).getTime();
    if (ms > 0) durationMinutes = Math.round(ms / 60000);
  }

  return {
    setsLogged: sets.length,
    totalWeight,
    durationMinutes,
    bestSets: [...bestPerExercise.entries()]
      .map(([exercise, v]) => ({ exercise, weight: v.weight, reps: v.reps, medal: null }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 5),
    previousTotalWeight: null,
    bodyParts,
  };
}

export async function getSessionRecap(sessionId: string): Promise<SessionRecap> {
  const userId = await currentUserId();
  try {
    return await serverSessionRecap(sessionId);
  } catch (e) {
    if (!isOfflineError(e) && !isTransportError(e)) throw e;
    return localSessionRecap(userId, sessionId);
  }
}

async function serverSessionRecap(sessionId: string): Promise<SessionRecap> {
  const [{ data: sets, error: setsErr }, { data: sess, error: sessErr }] = await Promise.all([
    supabase
      .from('logged_sets')
      .select(
        'exercise_display_name, exercise_normalized_name, weight, reps, completed_at, plan_exercises(body_part)'
      )
      .eq('session_id', sessionId)
      .order('completed_at', { ascending: true }),
    supabase
      .from('sessions')
      .select('started_at, completed_at')
      .eq('id', sessionId)
      .maybeSingle(),
  ]);
  if (setsErr) throw setsErr;
  if (sessErr) throw sessErr;
  type Row = {
    exercise_display_name: string;
    exercise_normalized_name: string;
    weight: number | null;
    reps: number | null;
    plan_exercises?: { body_part: string | null } | { body_part: string | null }[] | null;
  };
  const rows: Row[] = (sets as Row[]) ?? [];
  let totalWeight = 0;
  const bestPerExercise = new Map<
    string,
    { normalizedName: string; weight: number; reps: number }
  >();
  const bodyParts: string[] = [];
  const seenBodyParts = new Set<string>();
  for (const r of rows) {
    if (r.weight != null && r.reps != null) {
      totalWeight += r.weight * r.reps;
      const prev = bestPerExercise.get(r.exercise_display_name);
      if (!prev || r.weight > prev.weight) {
        bestPerExercise.set(r.exercise_display_name, {
          normalizedName: r.exercise_normalized_name,
          weight: r.weight,
          reps: r.reps,
        });
      }
    }
    const pe = Array.isArray(r.plan_exercises) ? r.plan_exercises[0] : r.plan_exercises;
    const bp = pe?.body_part?.trim();
    if (bp && !seenBodyParts.has(bp)) {
      seenBodyParts.add(bp);
      bodyParts.push(bp);
    }
  }
  const bestEntries = [...bestPerExercise.entries()]
    .map(([exercise, v]) => ({ exercise, ...v }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5);
  let durationMinutes: number | null = null;
  if (sess?.started_at && sess?.completed_at) {
    const ms = new Date(sess.completed_at).getTime() - new Date(sess.started_at).getTime();
    if (ms > 0) durationMinutes = Math.round(ms / 60000);
  }

  // Look up the most recent prior session for the same training day to compare volume.
  let previousTotalWeight: number | null = null;
  const { data: thisSess } = await supabase
    .from('sessions')
    .select('training_day_id, user_id')
    .eq('id', sessionId)
    .maybeSingle();
  if (thisSess?.training_day_id && thisSess?.user_id) {
    const { data: prior } = await supabase
      .from('sessions')
      .select('id')
      .eq('user_id', thisSess.user_id)
      .eq('training_day_id', thisSess.training_day_id)
      .neq('id', sessionId)
      .not('completed_at', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (prior?.id) {
      const { data: priorSets } = await supabase
        .from('logged_sets')
        .select('weight, reps')
        .eq('session_id', prior.id);
      let sum = 0;
      for (const r of (priorSets as { weight: number | null; reps: number | null }[]) ?? []) {
        if (r.weight != null && r.reps != null) sum += r.weight * r.reps;
      }
      previousTotalWeight = sum;
    }
  }

  // Rank each top set by weight against the user's all-time distinct top
  // weights for that exercise. Today's logged sets are already in the DB so
  // a new PR naturally ranks first.
  const medalByExercise = new Map<string, RecapMedal | null>();
  const normalizedNames = bestEntries
    .filter((e) => e.weight > 0)
    .map((e) => e.normalizedName);
  if (thisSess?.user_id && normalizedNames.length > 0) {
    const { data: hist } = await supabase
      .from('logged_sets')
      .select('exercise_normalized_name, weight')
      .eq('user_id', thisSess.user_id)
      .in('exercise_normalized_name', normalizedNames)
      .not('weight', 'is', null);
    const distinctByName = new Map<string, Set<number>>();
    for (const r of (hist as { exercise_normalized_name: string; weight: number }[]) ?? []) {
      if (r.weight == null) continue;
      const key = Math.round(r.weight * 10) / 10;
      let set = distinctByName.get(r.exercise_normalized_name);
      if (!set) {
        set = new Set();
        distinctByName.set(r.exercise_normalized_name, set);
      }
      set.add(key);
    }
    for (const e of bestEntries) {
      if (e.weight <= 0) {
        medalByExercise.set(e.exercise, null);
        continue;
      }
      const distinct = [...(distinctByName.get(e.normalizedName) ?? [])].sort(
        (a, b) => b - a
      );
      const todays = Math.round(e.weight * 10) / 10;
      const rank = distinct.indexOf(todays);
      const medal: RecapMedal | null =
        rank === 0 ? 'gold' : rank === 1 ? 'silver' : rank === 2 ? 'bronze' : null;
      medalByExercise.set(e.exercise, medal);
    }
  }

  const bestSets: RecapBestSet[] = bestEntries.map((e) => ({
    exercise: e.exercise,
    weight: e.weight,
    reps: e.reps,
    medal: medalByExercise.get(e.exercise) ?? null,
  }));

  return {
    setsLogged: rows.length,
    totalWeight,
    durationMinutes,
    bestSets,
    previousTotalWeight,
    bodyParts,
  };
}

export interface LastDayRecap {
  completedAt: string;
  totalWeight: number;
  durationMinutes: number | null;
  bestImprovement: { exercise: string; deltaReps: number } | null;
}

export async function getLastDayRecap(trainingDayId: string): Promise<LastDayRecap | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  const { data: sessions } = await supabase
    .from('sessions')
    .select('id, started_at, completed_at')
    .eq('user_id', userId)
    .eq('training_day_id', trainingDayId)
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(2);
  const list = (sessions as { id: string; started_at: string; completed_at: string }[]) ?? [];
  if (list.length === 0) return null;
  const latest = list[0];
  const prior = list[1] ?? null;

  async function sumSession(sid: string) {
    const { data } = await supabase
      .from('logged_sets')
      .select('exercise_display_name, weight, reps')
      .eq('session_id', sid);
    const rows = (data as { exercise_display_name: string; weight: number | null; reps: number | null }[]) ?? [];
    let total = 0;
    const bestReps = new Map<string, number>();
    for (const r of rows) {
      if (r.weight != null && r.reps != null) total += r.weight * r.reps;
      if (r.reps != null) {
        const prev = bestReps.get(r.exercise_display_name);
        if (prev == null || r.reps > prev) bestReps.set(r.exercise_display_name, r.reps);
      }
    }
    return { total, bestReps };
  }

  const latestStats = await sumSession(latest.id);
  let bestImprovement: LastDayRecap['bestImprovement'] = null;
  if (prior) {
    const priorStats = await sumSession(prior.id);
    let bestDelta = 0;
    let bestEx: string | null = null;
    for (const [ex, reps] of latestStats.bestReps) {
      const priorReps = priorStats.bestReps.get(ex) ?? 0;
      const delta = reps - priorReps;
      if (delta > bestDelta) {
        bestDelta = delta;
        bestEx = ex;
      }
    }
    if (bestEx) bestImprovement = { exercise: bestEx, deltaReps: bestDelta };
  }

  let durationMinutes: number | null = null;
  const ms = new Date(latest.completed_at).getTime() - new Date(latest.started_at).getTime();
  if (ms > 0) durationMinutes = Math.round(ms / 60000);

  return {
    completedAt: latest.completed_at,
    totalWeight: latestStats.total,
    durationMinutes,
    bestImprovement,
  };
}

export interface ExerciseHistory {
  lastSummary: { weight: number | null; reps: number; sets: number } | null;
  prBest: { weight: number; reps: number } | null;
}

export async function getExerciseHistories(
  normalizedNames: string[],
  excludeSessionId?: string
): Promise<Record<string, ExerciseHistory>> {
  const userId = await currentUserId();
  const out: Record<string, ExerciseHistory> = {};
  if (!userId || normalizedNames.length === 0) return out;
  let query = supabase
    .from('logged_sets')
    .select('exercise_normalized_name, session_id, weight, reps, set_index, completed_at')
    .eq('user_id', userId)
    .in('exercise_normalized_name', normalizedNames)
    .order('completed_at', { ascending: false })
    .limit(500);
  if (excludeSessionId) query = query.neq('session_id', excludeSessionId);
  const { data } = await query;
  type Row = {
    exercise_normalized_name: string;
    session_id: string;
    weight: number | null;
    reps: number | null;
    set_index: number;
  };
  const rows = (data as Row[]) ?? [];
  for (const name of normalizedNames) {
    const byEx = rows.filter((r) => r.exercise_normalized_name === name);
    if (byEx.length === 0) {
      out[name] = { lastSummary: null, prBest: null };
      continue;
    }
    const lastSessionId = byEx[0].session_id;
    const lastSets = byEx.filter((r) => r.session_id === lastSessionId);
    const validLast = lastSets.filter((r) => r.reps != null);
    let prBest: { weight: number; reps: number } | null = null;
    for (const r of byEx) {
      if (r.weight != null && r.reps != null) {
        if (!prBest || r.weight > prBest.weight) prBest = { weight: r.weight, reps: r.reps };
      }
    }
    out[name] = {
      lastSummary:
        validLast.length > 0
          ? {
              weight: validLast[0].weight,
              reps: validLast[0].reps ?? 0,
              sets: validLast.length,
            }
          : null,
      prBest,
    };
  }
  return out;
}

export interface CompletedSessionSummary {
  id: string;
  started_at: string;
  completed_at: string;
  day_name: string;
  total_exercises: number;
  recorded_exercises: number;
}

export async function listCompletedSessions(): Promise<CompletedSessionSummary[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  const { data, error } = await supabase
    .from('sessions')
    .select('id, started_at, completed_at, training_days(name, plan_exercises(id))')
    .eq('user_id', userId)
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false });
  if (error) throw error;
  type Row = {
    id: string;
    started_at: string;
    completed_at: string;
    training_days:
      | { name: string; plan_exercises: { id: string }[] }
      | { name: string; plan_exercises: { id: string }[] }[]
      | null;
  };
  const rows = (data as Row[]) ?? [];
  const sessionIds = rows.map((r) => r.id);

  const recordedBySession = new Map<string, Set<string>>();
  if (sessionIds.length > 0) {
    const { data: logged } = await supabase
      .from('logged_sets')
      .select('session_id, plan_exercise_id')
      .in('session_id', sessionIds);
    for (const ls of ((logged as { session_id: string; plan_exercise_id: string | null }[]) ?? [])) {
      if (!ls.plan_exercise_id) continue;
      let set = recordedBySession.get(ls.session_id);
      if (!set) {
        set = new Set();
        recordedBySession.set(ls.session_id, set);
      }
      set.add(ls.plan_exercise_id);
    }
  }

  return rows.map((r) => {
    const td = Array.isArray(r.training_days) ? r.training_days[0] : r.training_days;
    const total = td?.plan_exercises?.length ?? 0;
    const recorded = recordedBySession.get(r.id)?.size ?? 0;
    return {
      id: r.id,
      started_at: r.started_at,
      completed_at: r.completed_at,
      day_name: td?.name ?? 'Workout',
      total_exercises: total,
      recorded_exercises: recorded,
    };
  });
}

export async function deleteSession(sessionId: string): Promise<void> {
  const userId = await currentUserId();
  removeLocalSession(userId, sessionId);
  try {
    await query(supabase.from('sessions').delete().eq('id', sessionId).select('id'), {
      label: 'deleteSession',
    });
  } catch (e) {
    if (!isOfflineError(e) || !userId) throw e;
    enqueue(userId, { kind: 'delete_session', id: sessionId });
  }
}

// Delete every open (not-yet-completed) session belonging to the current user.
// Used when the user discards a workout — we want a truly clean slate, even if
// abandoned sessions from older app versions are lurking in the DB.
export interface WeekSessionBreakdown {
  trainingDayName: string;
  bodyParts: string[];
}

export interface WeekSummary {
  workoutsDone: number;
  // Mon..Sun. Each day is a list of session efforts (0-1), so a day with two
  // workouts has two entries that render as stacked segments with a gap.
  bars: number[][];
  // Mon..Sun. Same shape and order as `bars` — one entry per session that day
  // with the training day name and the unique body parts trained.
  dayDetails: WeekSessionBreakdown[][];
}

function startOfThisWeek(): Date {
  return mondayOfWeek(0);
}

export function mondayOfWeek(offsetWeeks: number): Date {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7; // 0=Mon..6=Sun
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - dow + offsetWeeks * 7
  );
}

export async function getCompletedDayNamesThisWeek(): Promise<string[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  const monday = startOfThisWeek();
  const nextMonday = new Date(monday);
  nextMonday.setDate(nextMonday.getDate() + 7);
  let data;
  try {
    data = await query(
      supabase
        .from('sessions')
        .select('completed_at, training_days(name)')
        .eq('user_id', userId)
        .not('completed_at', 'is', null)
        .gte('completed_at', monday.toISOString())
        .lt('completed_at', nextMonday.toISOString())
        .order('completed_at', { ascending: true }),
      { label: 'getCompletedDayNamesThisWeek' }
    );
  } catch {
    return [];
  }
  type Row = {
    completed_at: string;
    training_days: { name: string } | { name: string }[] | null;
  };
  const rows = (data as Row[]) ?? [];
  const names: string[] = [];
  for (const r of rows) {
    const td = Array.isArray(r.training_days) ? r.training_days[0] : r.training_days;
    if (td?.name) names.push(td.name);
  }
  return names;
}

export async function getThisWeekSummary(): Promise<WeekSummary> {
  const userId = await currentUserId();
  const emptyBars: number[][] = [[], [], [], [], [], [], []];
  const emptyDetails: WeekSessionBreakdown[][] = [[], [], [], [], [], [], []];
  if (!userId) return { workoutsDone: 0, bars: emptyBars, dayDetails: emptyDetails };

  const monday = mondayOfWeek(0);
  const nextMonday = new Date(monday);
  nextMonday.setDate(nextMonday.getDate() + 7);

  let sessions;
  try {
    sessions = await query(
      supabase
        .from('sessions')
        .select('id, completed_at, training_days(name)')
        .eq('user_id', userId)
        .not('completed_at', 'is', null)
        .gte('completed_at', monday.toISOString())
        .lt('completed_at', nextMonday.toISOString()),
      { label: 'getThisWeekSummary' }
    );
  } catch {
    return { workoutsDone: 0, bars: emptyBars, dayDetails: emptyDetails };
  }
  type SRow = {
    id: string;
    completed_at: string;
    training_days: { name: string } | { name: string }[] | null;
  };
  const sessionList = (sessions as SRow[]) ?? [];
  if (sessionList.length === 0)
    return { workoutsDone: 0, bars: emptyBars, dayDetails: emptyDetails };

  const { data: sets } = await supabase
    .from('logged_sets')
    .select('session_id, weight, reps, plan_exercises(body_part)')
    .in(
      'session_id',
      sessionList.map((s) => s.id)
    );
  type LRow = {
    session_id: string;
    weight: number | null;
    reps: number | null;
    plan_exercises:
      | { body_part: string | null }
      | { body_part: string | null }[]
      | null;
  };
  const volumeBySession = new Map<string, number>();
  const bodyPartsBySession = new Map<string, Set<string>>();
  for (const r of ((sets as LRow[]) ?? [])) {
    if (r.weight != null && r.reps != null) {
      volumeBySession.set(
        r.session_id,
        (volumeBySession.get(r.session_id) ?? 0) + r.weight * r.reps
      );
    }
    const pe = Array.isArray(r.plan_exercises) ? r.plan_exercises[0] : r.plan_exercises;
    const bp = pe?.body_part?.trim();
    if (bp) {
      let set = bodyPartsBySession.get(r.session_id);
      if (!set) {
        set = new Set();
        bodyPartsBySession.set(r.session_id, set);
      }
      set.add(bp);
    }
  }

  const dayBuckets: number[][] = [[], [], [], [], [], [], []];
  const dayDetails: WeekSessionBreakdown[][] = [[], [], [], [], [], [], []];
  const sortedByDay = [...sessionList].sort(
    (a, b) => new Date(a.completed_at).getTime() - new Date(b.completed_at).getTime()
  );
  for (const s of sortedByDay) {
    const d = new Date(s.completed_at);
    const idx = (d.getDay() + 6) % 7;
    dayBuckets[idx].push(volumeBySession.get(s.id) ?? 0);
    const td = Array.isArray(s.training_days) ? s.training_days[0] : s.training_days;
    dayDetails[idx].push({
      trainingDayName: td?.name ?? 'Workout',
      bodyParts: [...(bodyPartsBySession.get(s.id) ?? [])],
    });
  }
  // Normalize: bar height for any single session is its volume relative to
  // the heaviest day's TOTAL volume in the week (so the column tops match
  // the biggest training day).
  const dayTotals = dayBuckets.map((arr) => arr.reduce((a, b) => a + b, 0));
  const max = Math.max(...dayTotals, 0);
  // Preserve segment counts even if all volumes are 0 (e.g. body-weight-only
  // workouts) so each completed session still gets a visible bar.
  const bars: number[][] = dayBuckets.map((arr) =>
    arr.map((v) => (max > 0 ? v / max : 0))
  );
  return { workoutsDone: sessionList.length, bars, dayDetails };
}

export interface BodyPartStats {
  bodyPart: string;
  volume: number;
  setCount: number;
  sessionCount: number;
  topSet: { exercise: string; weight: number; reps: number } | null;
}

export interface WeeklySessionRef {
  trainingDayName: string;
  completedAt: string;
}

/** The single best set (by estimated 1RM) logged for one exercise in a week. */
export interface ExerciseWeekBest {
  normalizedName: string;
  displayName: string;
  bodyPart: string | null;
  /** Weight (kg) and reps of the set that produced the best estimated 1RM. */
  topWeightKg: number;
  topReps: number;
  /** Epley estimated 1RM (kg) of that set — used to rank week-over-week gains. */
  bestE1RMkg: number;
}

export interface WeeklyWorkoutSummary {
  weekStart: Date;
  weekEnd: Date;
  workoutsDone: number;
  totalVolume: number;
  totalSets: number;
  sessions: WeeklySessionRef[];
  byBodyPart: BodyPartStats[];
  /** Best set per exercise this week, for per-exercise progress comparisons. */
  exerciseBests: ExerciseWeekBest[];
}

/** Epley estimated one-rep max. Single reps return the lifted weight unchanged. */
function epley1RM(weight: number, reps: number): number {
  if (reps <= 1) return weight;
  return weight * (1 + reps / 30);
}

export async function getWeeklyWorkoutSummary(weekStart: Date): Promise<WeeklyWorkoutSummary> {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const empty: WeeklyWorkoutSummary = {
    weekStart,
    weekEnd,
    workoutsDone: 0,
    totalVolume: 0,
    totalSets: 0,
    sessions: [],
    byBodyPart: [],
    exerciseBests: [],
  };

  const userId = await currentUserId();
  if (!userId) return empty;

  const { data: sessionRows, error: sessErr } = await supabase
    .from('sessions')
    .select('id, completed_at, training_days(name)')
    .eq('user_id', userId)
    .not('completed_at', 'is', null)
    .gte('completed_at', weekStart.toISOString())
    .lt('completed_at', weekEnd.toISOString())
    .order('completed_at', { ascending: true });
  if (sessErr) throw sessErr;
  type SRow = {
    id: string;
    completed_at: string;
    training_days: { name: string } | { name: string }[] | null;
  };
  const sessions = (sessionRows as SRow[]) ?? [];
  if (sessions.length === 0) return empty;

  const sessionIds = sessions.map((s) => s.id);
  const sessionRefs: WeeklySessionRef[] = sessions.map((s) => {
    const td = Array.isArray(s.training_days) ? s.training_days[0] : s.training_days;
    return { trainingDayName: td?.name ?? 'Workout', completedAt: s.completed_at };
  });

  const { data: setsRows, error: setsErr } = await supabase
    .from('logged_sets')
    .select(
      'session_id, exercise_display_name, exercise_normalized_name, weight, reps, plan_exercises(body_part)'
    )
    .in('session_id', sessionIds);
  if (setsErr) throw setsErr;
  type LRow = {
    session_id: string;
    exercise_display_name: string;
    exercise_normalized_name: string;
    weight: number | null;
    reps: number | null;
    plan_exercises: { body_part: string | null } | { body_part: string | null }[] | null;
  };
  const setRows = (setsRows as LRow[]) ?? [];

  const groups = new Map<
    string,
    {
      volume: number;
      setCount: number;
      sessions: Set<string>;
      topSet: { exercise: string; weight: number; reps: number } | null;
    }
  >();
  // Best set per exercise (by estimated 1RM), keyed by normalized name.
  const exGroups = new Map<string, ExerciseWeekBest>();
  let totalVolume = 0;
  let totalSets = 0;
  for (const r of setRows) {
    const pe = Array.isArray(r.plan_exercises) ? r.plan_exercises[0] : r.plan_exercises;
    const bodyPart = pe?.body_part?.trim() ? pe.body_part.trim() : 'Other';
    let group = groups.get(bodyPart);
    if (!group) {
      group = { volume: 0, setCount: 0, sessions: new Set(), topSet: null };
      groups.set(bodyPart, group);
    }
    group.setCount += 1;
    group.sessions.add(r.session_id);
    totalSets += 1;
    if (r.weight != null && r.reps != null) {
      const v = r.weight * r.reps;
      group.volume += v;
      totalVolume += v;
      if (!group.topSet || r.weight > group.topSet.weight) {
        group.topSet = {
          exercise: r.exercise_display_name,
          weight: r.weight,
          reps: r.reps,
        };
      }
      const e = epley1RM(r.weight, r.reps);
      const ex = exGroups.get(r.exercise_normalized_name);
      if (!ex || e > ex.bestE1RMkg) {
        exGroups.set(r.exercise_normalized_name, {
          normalizedName: r.exercise_normalized_name,
          displayName: r.exercise_display_name,
          bodyPart: pe?.body_part?.trim() ? pe.body_part.trim() : null,
          topWeightKg: r.weight,
          topReps: r.reps,
          bestE1RMkg: e,
        });
      }
    }
  }

  const byBodyPart: BodyPartStats[] = [...groups.entries()]
    .map(([bodyPart, g]) => ({
      bodyPart,
      volume: g.volume,
      setCount: g.setCount,
      sessionCount: g.sessions.size,
      topSet: g.topSet,
    }))
    .sort((a, b) => b.volume - a.volume || b.setCount - a.setCount);

  const exerciseBests = [...exGroups.values()].sort((a, b) => b.bestE1RMkg - a.bestE1RMkg);

  return {
    weekStart,
    weekEnd,
    workoutsDone: sessions.length,
    totalVolume,
    totalSets,
    sessions: sessionRefs,
    byBodyPart,
    exerciseBests,
  };
}

export async function hasAnySessionsBefore(iso: string): Promise<boolean> {
  const userId = await currentUserId();
  if (!userId) return false;
  const { count, error } = await supabase
    .from('sessions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .not('completed_at', 'is', null)
    .lt('completed_at', iso);
  if (error) return false;
  return (count ?? 0) > 0;
}

export async function deleteAllOpenSessions(): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  removeOpenLocalSessions(userId);
  try {
    await query(
      supabase
        .from('sessions')
        .delete()
        .eq('user_id', userId)
        .is('completed_at', null)
        .select('id'),
      { label: 'deleteAllOpenSessions' }
    );
  } catch (e) {
    if (!isOfflineError(e)) throw e;
    enqueue(userId, { kind: 'delete_open_sessions' });
  }
}

export async function createSession(trainingDayId: string): Promise<SessionRow> {
  const userId = await currentUserId();
  if (!userId) throw new Error('Not signed in');
  // The id is minted here rather than by Postgres so the sets logged against
  // this session have something stable to point at before it ever syncs.
  const row: SessionRow = {
    id: newId(),
    training_day_id: trainingDayId,
    started_at: new Date().toISOString(),
    completed_at: null,
  };
  try {
    const data = await query(
      supabase
        .from('sessions')
        .insert({
          id: row.id,
          user_id: userId,
          training_day_id: trainingDayId,
          started_at: row.started_at,
        })
        .select()
        .single(),
      { label: 'createSession' }
    );
    const saved = data as SessionRow;
    upsertLocalSession(userId, {
      id: saved.id,
      training_day_id: saved.training_day_id,
      started_at: saved.started_at,
      completed_at: null,
      synced: true,
    });
    return saved;
  } catch {
    // Any failure, not just a recognised "no signal" one. A gateway error on
    // one bar of signal used to leave Start workout doing nothing at all; the
    // row is idempotent (upsert on id), so banking it and replaying is always
    // safe.
    upsertLocalSession(userId, {
      id: row.id,
      training_day_id: trainingDayId,
      started_at: row.started_at,
      completed_at: null,
      synced: false,
    });
    enqueue(userId, {
      kind: 'create_session',
      row: {
        id: row.id,
        training_day_id: trainingDayId,
        started_at: row.started_at,
      },
    });
    return row;
  }
}

export async function completeSession(sessionId: string): Promise<void> {
  const userId = await currentUserId();
  const completedAt = new Date().toISOString();
  // Record it on the device first: from here on, this workout is over as far
  // as the app is concerned, whatever the server does or doesn't hear.
  completeLocalSession(userId, sessionId, completedAt);
  try {
    await query(
      supabase
        .from('sessions')
        .update({ completed_at: completedAt })
        .eq('id', sessionId)
        .select('id'),
      { label: 'completeSession' }
    );
    markLocalSessionSynced(userId, sessionId);
    forgetFinishedSession(userId, sessionId);
    if (userId) await closeStrayOpenSessions(userId, sessionId);
  } catch (e) {
    if (!userId) throw e;
    // Any failure at all — no signal, a server error — gets queued. Ending a
    // workout is one write, and losing it silently is what leaves people
    // staring at yesterday's session next time they open the app.
    enqueue(userId, { kind: 'complete_session', id: sessionId, completed_at: completedAt });
    // Finishing a workout is the moment to try to push everything — if a bar
    // of signal has come back on the walk out, it all lands now.
    requestFlush();
    if (!isOfflineError(e)) {
      console.error('[sessions] completing the workout failed, queued for retry', e);
    }
  }
}

/**
 * A workout that has been "in progress" for this long was abandoned, not
 * paused. Long enough to cover an evening session you come back to after a
 * night's sleep, short enough that a session left open by a failed completion
 * clears itself the next day.
 */
const ABANDONED_AFTER_MS = 18 * 60 * 60 * 1000;

/**
 * Close out sessions that are open but shouldn't be.
 *
 * Empty ones are deleted — nothing was logged, so there's nothing to keep.
 * Ones with sets in them are marked complete, so the work stays in history and
 * they stop masquerading as a live workout.
 */
async function resolveAbandonedSessions(userId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const sets = await query(
    supabase.from('logged_sets').select('session_id').in('session_id', ids),
    { label: 'abandonedSessionSets' }
  );
  const withSets = new Set(
    ((sets as { session_id: string }[]) ?? []).map((s) => s.session_id)
  );
  const empty = ids.filter((id) => !withSets.has(id));
  const used = ids.filter((id) => withSets.has(id));

  if (empty.length > 0) {
    await query(supabase.from('sessions').delete().in('id', empty).select('id'), {
      label: 'deleteAbandonedSessions',
    });
    for (const id of empty) removeLocalSession(userId, id);
  }
  if (used.length > 0) {
    const completedAt = new Date().toISOString();
    await query(
      supabase
        .from('sessions')
        .update({ completed_at: completedAt })
        .in('id', used)
        .select('id'),
      { label: 'closeAbandonedSessions' }
    );
    for (const id of used) completeLocalSession(userId, id, completedAt);
  }
}

/**
 * Tidy up sessions that were left open before the one just finished.
 *
 * A session is orphaned whenever a workout ends without its completion
 * landing, and it then shows up forever as "workout in progress". The user has
 * just finished training, so anything still open from earlier is abandoned.
 */
async function closeStrayOpenSessions(
  userId: string,
  justFinishedId: string
): Promise<void> {
  try {
    const startedAt = getLocalSessions(userId).find((s) => s.id === justFinishedId)
      ?.started_at;
    const rows = await query(
      supabase
        .from('sessions')
        .select('id, started_at')
        .eq('user_id', userId)
        .is('completed_at', null)
        .neq('id', justFinishedId)
        .limit(20),
      { label: 'strayOpenSessions' }
    );
    const stray = ((rows as { id: string; started_at: string }[]) ?? []).filter(
      (s) => !startedAt || s.started_at < startedAt
    );
    await resolveAbandonedSessions(
      userId,
      stray.map((s) => s.id)
    );
  } catch {
    // Housekeeping only — never let it break finishing a workout.
  }
}

export async function logSet(params: {
  sessionId: string;
  planExerciseId: string;
  exerciseDisplayName: string;
  exerciseNormalizedName: string;
  setIndex: number;
  dropIndex?: number;
  weight?: number | null;
  reps?: number | null;
  holdSeconds?: number | null;
}): Promise<LoggedSet> {
  const userId = await currentUserId();
  if (!userId) throw new Error('Not signed in');
  const row: LoggedSet = {
    id: newId(),
    session_id: params.sessionId,
    plan_exercise_id: params.planExerciseId,
    exercise_display_name: params.exerciseDisplayName,
    exercise_normalized_name: params.exerciseNormalizedName,
    set_index: params.setIndex,
    drop_index: params.dropIndex ?? 0,
    weight: params.weight ?? null,
    reps: params.reps ?? null,
    hold_seconds: params.holdSeconds ?? null,
    completed_at: new Date().toISOString(),
  };
  try {
    const data = await query(
      supabase
        .from('logged_sets')
        .insert({ ...row, user_id: userId })
        .select()
        .single(),
      { label: 'logSet' }
    );
    const saved = data as LoggedSet;
    upsertLocalSet(userId, saved);
    return saved;
  } catch {
    // The set is banked on the device and pushed when the write can land —
    // whether the request never left the phone or the server refused it. A
    // logged set is never worth losing to a bad minute of signal.
    upsertLocalSet(userId, row);
    enqueue(userId, { kind: 'log_set', row });
    return row;
  }
}

export async function getAllSessionSets(sessionId: string): Promise<LoggedSet[]> {
  const userId = await currentUserId();
  try {
    const data = await query(
      supabase
        .from('logged_sets')
        .select('*')
        .eq('session_id', sessionId)
        .order('completed_at', { ascending: true }),
      { label: 'getAllSessionSets' }
    );
    return mergeServerSets(userId, sessionId, (data as LoggedSet[]) ?? [], pendingSetIds());
  } catch (e) {
    if (!isOfflineError(e)) throw e;
    return [...getLocalSets(userId, sessionId)].sort((a, b) =>
      a.completed_at < b.completed_at ? -1 : 1
    );
  }
}

/** Returns the saved row, or null when the edit was queued offline and we have
 *  no local copy of the row to hand back (editing an old workout with no signal). */
export async function updateLoggedSet(
  id: string,
  patch: { weight?: number | null; reps?: number | null; holdSeconds?: number | null }
): Promise<LoggedSet | null> {
  const update: Record<string, number | null> = {};
  if ('weight' in patch) update.weight = patch.weight ?? null;
  if ('reps' in patch) update.reps = patch.reps ?? null;
  if ('holdSeconds' in patch) update.hold_seconds = patch.holdSeconds ?? null;
  const userId = await currentUserId();
  try {
    const data = await query(
      supabase.from('logged_sets').update(update).eq('id', id).select().single(),
      { label: 'updateLoggedSet' }
    );
    const saved = data as LoggedSet;
    upsertLocalSet(userId, saved);
    return saved;
  } catch (e) {
    if (!userId) throw e;
    // Same reasoning as logSet: an edit the server didn't take is queued
    // rather than dropped.
    const local = patchLocalSet(userId, id, update);
    enqueue(userId, { kind: 'update_set', id, patch: update });
    return local;
  }
}

export async function getSessionSets(
  sessionId: string,
  planExerciseId: string,
  normalizedName?: string
): Promise<LoggedSet[]> {
  // When an exercise slot has alternatives, the primary and every alternative
  // share the same plan_exercise_id but log under different normalized_names.
  // Pass normalizedName so each active identity only sees the sets it logged
  // this session (otherwise switching pills would mark an alternative's rows
  // completed using the primary's weights).
  const userId = await currentUserId();
  const matches = (s: LoggedSet) =>
    s.session_id === sessionId &&
    s.plan_exercise_id === planExerciseId &&
    (!normalizedName || s.exercise_normalized_name === normalizedName);

  let builder = supabase
    .from('logged_sets')
    .select('*')
    .eq('session_id', sessionId)
    .eq('plan_exercise_id', planExerciseId);
  if (normalizedName) builder = builder.eq('exercise_normalized_name', normalizedName);
  try {
    const data = await query(builder.order('set_index', { ascending: true }), {
      label: 'getSessionSets',
    });
    const rows = (data as LoggedSet[]) ?? [];
    // Fold in anything logged offline for this exercise that hasn't synced yet,
    // so re-opening the exercise doesn't lose the ticks.
    const pending = pendingSetIds();
    const local = getLocalSets(userId, sessionId).filter(
      (s) => matches(s) && pending.has(s.id) && !rows.some((r) => r.id === s.id)
    );
    for (const s of rows) upsertLocalSet(userId, s);
    return [...rows, ...local].sort((a, b) => a.set_index - b.set_index);
  } catch (e) {
    if (!isOfflineError(e)) throw e;
    return getLocalSets(userId, sessionId)
      .filter(matches)
      .sort((a, b) => a.set_index - b.set_index);
  }
}

// The normalized name of the movement most recently logged against a given
// plan-exercise slot (in any prior session). A slot's primary and its
// alternatives all share plan_exercise_id but log under different
// normalized_names, so this tells us which movement the user actually did last
// time — used to suggest rotating to the other one on weekly-alternation slots.
export async function getLastLoggedNormalizedForSlot(
  planExerciseId: string,
  excludeSessionId?: string
): Promise<string | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  let builder = supabase
    .from('logged_sets')
    .select('exercise_normalized_name, session_id, completed_at')
    .eq('user_id', userId)
    .eq('plan_exercise_id', planExerciseId)
    .order('completed_at', { ascending: false })
    .limit(1);
  if (excludeSessionId) builder = builder.neq('session_id', excludeSessionId);
  try {
    const data = await query(builder.maybeSingle(), {
      label: 'getLastLoggedNormalizedForSlot',
    });
    return (
      (data as { exercise_normalized_name: string } | null)?.exercise_normalized_name ?? null
    );
  } catch {
    // Only a hint for the weekly-rotation prompt — never worth an error.
    return null;
  }
}

export async function getLastSessionSetsForExercise(
  normalizedName: string,
  excludeSessionId?: string,
  baselineResetAt?: string | null
): Promise<LoggedSet[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  let builder = supabase
    .from('logged_sets')
    .select('*')
    .eq('user_id', userId)
    .eq('exercise_normalized_name', normalizedName)
    .order('completed_at', { ascending: false })
    .limit(20);
  if (excludeSessionId) builder = builder.neq('session_id', excludeSessionId);
  if (baselineResetAt) builder = builder.gte('completed_at', baselineResetAt);
  try {
    const data = await query(builder, { label: 'getLastSessionSetsForExercise' });
    const rows = (data as LoggedSet[]) ?? [];
    const sessionId = rows[0]?.session_id;
    const lastSets = rows
      .filter((d) => d.session_id === sessionId)
      .sort((a, b) => a.set_index - b.set_index);
    // A workout logged offline may not have reached the server yet. If the
    // device has a more recent session for this exercise, that's the real
    // "last time" — otherwise a week of training in a dead spot shows up as
    // the weights from the week before.
    const local = offlineLastSetsForExercise(
      userId,
      normalizedName,
      excludeSessionId,
      baselineResetAt
    );
    const newer =
      local.length > 0 &&
      (lastSets.length === 0 || local[0].completed_at > lastSets[0].completed_at);
    const result = newer ? local : lastSets;
    // "Last time" is what the logger pre-fills every set with, so it's the one
    // read the exercise screen can't do without. Keep a copy per machine.
    writeCache(userId, lastSetsCacheName(normalizedName), result);
    return result;
  } catch (e) {
    if (!isOfflineError(e)) throw e;
    return offlineLastSetsForExercise(
      userId,
      normalizedName,
      excludeSessionId,
      baselineResetAt
    );
  }
}

function lastSetsCacheName(normalizedName: string): string {
  return `lastSets.${normalizedName}`;
}

/**
 * "Last time" with no signal: prefer a session logged on this device (two
 * offline workouts in a row still progress properly), and otherwise fall back
 * to the copy cached the last time this exercise was opened online.
 */
function offlineLastSetsForExercise(
  userId: string | null,
  normalizedName: string,
  excludeSessionId?: string,
  baselineResetAt?: string | null
): LoggedSet[] {
  const sessions = getLocalSessions(userId)
    .filter((s) => s.id !== excludeSessionId)
    .sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
  for (const session of sessions) {
    const sets = getLocalSets(userId, session.id).filter(
      (s) =>
        s.exercise_normalized_name === normalizedName &&
        (!baselineResetAt || s.completed_at >= baselineResetAt)
    );
    if (sets.length > 0) return [...sets].sort((a, b) => a.set_index - b.set_index);
  }
  const cached = readCache<LoggedSet[]>(userId, lastSetsCacheName(normalizedName)) ?? [];
  return cached.filter(
    (s) =>
      s.session_id !== excludeSessionId &&
      (!baselineResetAt || s.completed_at >= baselineResetAt)
  );
}

/**
 * "Last time" without waiting on the network — the same device-side lookup the
 * offline path uses. The exercise screen falls back to this whenever the read
 * fails for any reason, so a dropped request never leaves the sets blank.
 */
export function getCachedLastSetsForExercise(
  normalizedName: string,
  excludeSessionId?: string,
  baselineResetAt?: string | null
): LoggedSet[] {
  return offlineLastSetsForExercise(
    currentUserIdSync(),
    normalizedName,
    excludeSessionId,
    baselineResetAt
  );
}

/** Sets already logged in this session, from the device mirror. */
export function getCachedSessionSets(
  sessionId: string,
  planExerciseId: string,
  normalizedName?: string
): LoggedSet[] {
  return getLocalSets(currentUserIdSync(), sessionId)
    .filter(
      (s) =>
        s.plan_exercise_id === planExerciseId &&
        (!normalizedName || s.exercise_normalized_name === normalizedName)
    )
    .sort((a, b) => a.set_index - b.set_index);
}

/** How many previous sessions' worth of rows to pull when warming a day. */
const PREFETCH_ROW_LIMIT = 600;

export interface PrefetchExercise {
  normalizedName: string;
  baselineResetAt?: string | null;
}

/**
 * Warm the "last time" cache for a whole workout in one request.
 *
 * The per-exercise read only caches an exercise once you've opened it with
 * signal, which is the wrong way round: by the time you tap into an exercise
 * at the gym the signal is already gone. This runs when the day is opened —
 * still on wifi, usually — so every exercise in the workout has last week's
 * weights and reps on the device before the session starts.
 *
 * Best-effort: never throws, and does nothing when we already know we're
 * offline (the caches it would write are the ones being read instead).
 */
export async function prefetchLastSetsForDay(
  exercises: PrefetchExercise[],
  excludeSessionId?: string
): Promise<void> {
  if (exercises.length === 0 || !isReachable()) return;
  const userId = await currentUserId();
  if (!userId) return;
  const names = [...new Set(exercises.map((e) => e.normalizedName))];
  let builder = supabase
    .from('logged_sets')
    .select('*')
    .eq('user_id', userId)
    .in('exercise_normalized_name', names)
    .order('completed_at', { ascending: false })
    .limit(PREFETCH_ROW_LIMIT);
  if (excludeSessionId) builder = builder.neq('session_id', excludeSessionId);
  let rows: LoggedSet[];
  try {
    rows = ((await query(builder, { label: 'prefetchLastSetsForDay' })) as LoggedSet[]) ?? [];
  } catch {
    // No signal, or the read failed — the existing caches stay as they are.
    return;
  }
  // A workout that's still running isn't "last time" — caching its sets would
  // have the logger pre-filling today's numbers with today's numbers.
  const open = new Set(
    getLocalSessions(userId)
      .filter((s) => !s.completed_at)
      .map((s) => s.id)
  );
  for (const ex of exercises) {
    const mine = rows.filter(
      (r) =>
        r.exercise_normalized_name === ex.normalizedName &&
        !open.has(r.session_id) &&
        (!ex.baselineResetAt || r.completed_at >= ex.baselineResetAt)
    );
    if (mine.length === 0) continue;
    const lastSessionId = mine[0].session_id;
    const lastSets = mine
      .filter((r) => r.session_id === lastSessionId)
      .sort((a, b) => a.set_index - b.set_index);
    writeCache(userId, lastSetsCacheName(ex.normalizedName), lastSets);
  }
}
