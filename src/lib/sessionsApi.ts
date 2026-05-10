import { supabase } from './supabase';

export interface SessionRow {
  id: string;
  training_day_id: string;
  started_at: string;
  completed_at: string | null;
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

export async function getLastCompletedTrainingDayName(): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('sessions')
    .select('training_day_id, completed_at, training_days(name)')
    .eq('user_id', user.id)
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  if (!data) return null;
  // training_days may come through as object or array depending on PostgREST inference
  const td = (data as { training_days: { name: string } | { name: string }[] | null }).training_days;
  if (!td) return null;
  if (Array.isArray(td)) return td[0]?.name ?? null;
  return td.name ?? null;
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
  body_parts: string[];
}

export async function listCompletedSessions(): Promise<CompletedSessionSummary[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('sessions')
    .select('id, started_at, completed_at, training_days(name, plan_exercises(body_part))')
    .eq('user_id', user.id)
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false });
  if (error) throw error;
  type Row = {
    id: string;
    started_at: string;
    completed_at: string;
    training_days:
      | { name: string; plan_exercises: { body_part: string | null }[] }
      | { name: string; plan_exercises: { body_part: string | null }[] }[]
      | null;
  };
  return ((data as Row[]) ?? []).map((r) => {
    const td = Array.isArray(r.training_days) ? r.training_days[0] : r.training_days;
    const parts = new Set<string>();
    for (const pe of td?.plan_exercises ?? []) {
      if (pe.body_part) parts.add(pe.body_part);
    }
    return {
      id: r.id,
      started_at: r.started_at,
      completed_at: r.completed_at,
      day_name: td?.name ?? 'Workout',
      body_parts: [...parts],
    };
  });
}

export async function deleteSession(sessionId: string): Promise<void> {
  const { error } = await supabase.from('sessions').delete().eq('id', sessionId);
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
  excludeSessionId?: string
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
  const { data, error } = await query;
  if (error) throw error;
  if (!data || data.length === 0) return [];
  const sessionId = data[0].session_id;
  return (data as LoggedSet[])
    .filter((d) => d.session_id === sessionId)
    .sort((a, b) => a.set_index - b.set_index);
}
