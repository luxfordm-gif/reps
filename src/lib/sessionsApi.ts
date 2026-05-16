import { supabase } from './supabase';

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

export async function getSessionNotes(sessionId: string): Promise<SessionNotes> {
  const { data, error } = await supabase
    .from('sessions')
    .select('feedback_for_self, notes_to_coach')
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw error;
  return {
    feedbackForSelf: (data?.feedback_for_self as string | null) ?? '',
    notesToCoach: (data?.notes_to_coach as string | null) ?? '',
  };
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
  const { error } = await supabase.from('sessions').update(update).eq('id', sessionId);
  if (error) throw error;
}

export interface WeekNoteRow {
  sessionId: string;
  completedAt: string;
  dayName: string;
  feedbackForSelf: string | null;
  notesToCoach: string | null;
}

export async function getRecentSessionNotes(daysBack = 7): Promise<WeekNoteRow[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('sessions')
    .select('id, completed_at, feedback_for_self, notes_to_coach, training_days(name)')
    .eq('user_id', user.id)
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

export async function getLastCompletedTrainingDayName(
  sinceIso?: string | null
): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  let query = supabase
    .from('sessions')
    .select('training_day_id, completed_at, training_days(name)')
    .eq('user_id', user.id)
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(1);
  if (sinceIso) query = query.gte('completed_at', sinceIso);
  const { data, error } = await query.maybeSingle();
  if (error) return null;
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

export async function getAnyActiveSession(): Promise<ActiveSessionContext | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('sessions')
    .select('id, started_at, training_day_id, training_days(name)')
    .eq('user_id', user.id)
    .is('completed_at', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  if (!data) return null;
  const td = (data as { training_days: { name: string } | { name: string }[] | null }).training_days;
  const tdObj = Array.isArray(td) ? td[0] : td;
  const stats = await getSessionStats((data as { id: string }).id);
  return {
    sessionId: (data as { id: string }).id,
    startedAt: (data as { started_at: string }).started_at,
    trainingDayId: (data as { training_day_id: string }).training_day_id,
    trainingDayName: tdObj?.name ?? 'Workout',
    lastPlanExerciseId: stats.lastPlanExerciseId,
  };
}

export async function getActiveSessionForDay(
  trainingDayId: string
): Promise<SessionRow | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('user_id', user.id)
    .eq('training_day_id', trainingDayId)
    .is('completed_at', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as SessionRow | null) ?? null;
}

export async function getSessionStats(
  sessionId: string
): Promise<{ setsLogged: number; lastPlanExerciseId: string | null }> {
  const { data, error } = await supabase
    .from('logged_sets')
    .select('plan_exercise_id, completed_at')
    .eq('session_id', sessionId)
    .order('completed_at', { ascending: false });
  if (error) throw error;
  const rows = data ?? [];
  return {
    setsLogged: rows.length,
    lastPlanExerciseId: rows[0]?.plan_exercise_id ?? null,
  };
}

export interface SessionRecap {
  setsLogged: number;
  totalWeight: number;
  durationMinutes: number | null;
  bestSets: { exercise: string; weight: number; reps: number }[];
  /** Total weight from the last completed session for the same training day, if any. */
  previousTotalWeight: number | null;
}

export async function getSessionRecap(sessionId: string): Promise<SessionRecap> {
  const [{ data: sets, error: setsErr }, { data: sess, error: sessErr }] = await Promise.all([
    supabase
      .from('logged_sets')
      .select('exercise_display_name, weight, reps, completed_at')
      .eq('session_id', sessionId),
    supabase
      .from('sessions')
      .select('started_at, completed_at')
      .eq('id', sessionId)
      .maybeSingle(),
  ]);
  if (setsErr) throw setsErr;
  if (sessErr) throw sessErr;
  type Row = { exercise_display_name: string; weight: number | null; reps: number | null };
  const rows: Row[] = (sets as Row[]) ?? [];
  let totalWeight = 0;
  const bestPerExercise = new Map<string, { weight: number; reps: number }>();
  for (const r of rows) {
    if (r.weight != null && r.reps != null) {
      totalWeight += r.weight * r.reps;
      const prev = bestPerExercise.get(r.exercise_display_name);
      if (!prev || r.weight > prev.weight) {
        bestPerExercise.set(r.exercise_display_name, { weight: r.weight, reps: r.reps });
      }
    }
  }
  const bestSets = [...bestPerExercise.entries()]
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
      for (const r of (priorSets as Row[]) ?? []) {
        if (r.weight != null && r.reps != null) sum += r.weight * r.reps;
      }
      previousTotalWeight = sum;
    }
  }

  return { setsLogged: rows.length, totalWeight, durationMinutes, bestSets, previousTotalWeight };
}

export interface LastDayRecap {
  completedAt: string;
  totalWeight: number;
  durationMinutes: number | null;
  bestImprovement: { exercise: string; deltaReps: number } | null;
}

export async function getLastDayRecap(trainingDayId: string): Promise<LastDayRecap | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: sessions } = await supabase
    .from('sessions')
    .select('id, started_at, completed_at')
    .eq('user_id', user.id)
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const out: Record<string, ExerciseHistory> = {};
  if (!user || normalizedNames.length === 0) return out;
  let query = supabase
    .from('logged_sets')
    .select('exercise_normalized_name, session_id, weight, reps, set_index, completed_at')
    .eq('user_id', user.id)
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('sessions')
    .select('id, started_at, completed_at, training_days(name, plan_exercises(id))')
    .eq('user_id', user.id)
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
  const { error } = await supabase.from('sessions').delete().eq('id', sessionId);
  if (error) throw error;
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const monday = startOfThisWeek();
  const nextMonday = new Date(monday);
  nextMonday.setDate(nextMonday.getDate() + 7);
  const { data, error } = await supabase
    .from('sessions')
    .select('completed_at, training_days(name)')
    .eq('user_id', user.id)
    .not('completed_at', 'is', null)
    .gte('completed_at', monday.toISOString())
    .lt('completed_at', nextMonday.toISOString())
    .order('completed_at', { ascending: true });
  if (error) return [];
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const emptyBars: number[][] = [[], [], [], [], [], [], []];
  const emptyDetails: WeekSessionBreakdown[][] = [[], [], [], [], [], [], []];
  if (!user) return { workoutsDone: 0, bars: emptyBars, dayDetails: emptyDetails };

  const monday = mondayOfWeek(0);
  const nextMonday = new Date(monday);
  nextMonday.setDate(nextMonday.getDate() + 7);

  const { data: sessions } = await supabase
    .from('sessions')
    .select('id, completed_at, training_days(name)')
    .eq('user_id', user.id)
    .not('completed_at', 'is', null)
    .gte('completed_at', monday.toISOString())
    .lt('completed_at', nextMonday.toISOString());
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

export interface WeeklyWorkoutSummary {
  weekStart: Date;
  weekEnd: Date;
  workoutsDone: number;
  totalVolume: number;
  totalSets: number;
  sessions: WeeklySessionRef[];
  byBodyPart: BodyPartStats[];
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
  };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return empty;

  const { data: sessionRows, error: sessErr } = await supabase
    .from('sessions')
    .select('id, completed_at, training_days(name)')
    .eq('user_id', user.id)
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
      'session_id, exercise_display_name, weight, reps, plan_exercises(body_part)'
    )
    .in('session_id', sessionIds);
  if (setsErr) throw setsErr;
  type LRow = {
    session_id: string;
    exercise_display_name: string;
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

  return {
    weekStart,
    weekEnd,
    workoutsDone: sessions.length,
    totalVolume,
    totalSets,
    sessions: sessionRefs,
    byBodyPart,
  };
}

export async function hasAnySessionsBefore(iso: string): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { count, error } = await supabase
    .from('sessions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .not('completed_at', 'is', null)
    .lt('completed_at', iso);
  if (error) return false;
  return (count ?? 0) > 0;
}

export async function deleteAllOpenSessions(): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase
    .from('sessions')
    .delete()
    .eq('user_id', user.id)
    .is('completed_at', null);
  if (error) throw error;
}

export async function createSession(trainingDayId: string): Promise<SessionRow> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { data, error } = await supabase
    .from('sessions')
    .insert({ user_id: user.id, training_day_id: trainingDayId })
    .select()
    .single();
  if (error) throw error;
  return data as SessionRow;
}

export async function completeSession(sessionId: string): Promise<void> {
  const { error } = await supabase
    .from('sessions')
    .update({ completed_at: new Date().toISOString() })
    .eq('id', sessionId);
  if (error) throw error;
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { data, error } = await supabase
    .from('logged_sets')
    .insert({
      user_id: user.id,
      session_id: params.sessionId,
      plan_exercise_id: params.planExerciseId,
      exercise_display_name: params.exerciseDisplayName,
      exercise_normalized_name: params.exerciseNormalizedName,
      set_index: params.setIndex,
      drop_index: params.dropIndex ?? 0,
      weight: params.weight ?? null,
      reps: params.reps ?? null,
      hold_seconds: params.holdSeconds ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as LoggedSet;
}

export async function getAllSessionSets(sessionId: string): Promise<LoggedSet[]> {
  const { data, error } = await supabase
    .from('logged_sets')
    .select('*')
    .eq('session_id', sessionId)
    .order('completed_at', { ascending: true });
  if (error) throw error;
  return (data as LoggedSet[]) ?? [];
}

export async function updateLoggedSet(
  id: string,
  patch: { weight?: number | null; reps?: number | null; holdSeconds?: number | null }
): Promise<LoggedSet> {
  const update: Record<string, number | null> = {};
  if ('weight' in patch) update.weight = patch.weight ?? null;
  if ('reps' in patch) update.reps = patch.reps ?? null;
  if ('holdSeconds' in patch) update.hold_seconds = patch.holdSeconds ?? null;
  const { data, error } = await supabase
    .from('logged_sets')
    .update(update)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as LoggedSet;
}

export async function getSessionSets(sessionId: string, planExerciseId: string): Promise<LoggedSet[]> {
  const { data, error } = await supabase
    .from('logged_sets')
    .select('*')
    .eq('session_id', sessionId)
    .eq('plan_exercise_id', planExerciseId)
    .order('set_index', { ascending: true });
  if (error) throw error;
  return (data as LoggedSet[]) ?? [];
}

export async function getLastSessionSetsForExercise(
  normalizedName: string,
  excludeSessionId?: string,
  baselineResetAt?: string | null
): Promise<LoggedSet[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  let query = supabase
    .from('logged_sets')
    .select('*')
    .eq('user_id', user.id)
    .eq('exercise_normalized_name', normalizedName)
    .order('completed_at', { ascending: false })
    .limit(20);
  if (excludeSessionId) query = query.neq('session_id', excludeSessionId);
  if (baselineResetAt) query = query.gte('completed_at', baselineResetAt);
  const { data, error } = await query;
  if (error) throw error;
  if (!data || data.length === 0) return [];
  const sessionId = data[0].session_id;
  return (data as LoggedSet[])
    .filter((d) => d.session_id === sessionId)
    .sort((a, b) => a.set_index - b.set_index);
}
