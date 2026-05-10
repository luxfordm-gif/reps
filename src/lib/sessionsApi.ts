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
