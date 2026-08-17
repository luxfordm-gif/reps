import { supabase, currentUserId } from './supabase';
import { isOfflineError, query } from './offline/net';
import { readCache, writeCache } from './offline/storage';

// An alternative movement attached to a plan-exercise slot. The primary
// plan_exercises row keeps its priority; alternatives are toggled via pills on
// the logging screen. Tempo / rep range / sets are inherited from the parent
// plan_exercises row and are not stored here. History is tracked per
// normalized_name (logged_sets group by normalized_name).
export interface ExerciseAlternativeRow {
  id: string;
  plan_exercise_id: string;
  name: string;
  normalized_name: string;
  position: number;
  // True when this alternative came from an "alternate weeks with X" coach note.
  // The logger uses it to suggest rotating between the two movements each week.
  is_weekly_rotation: boolean;
}

const ALT_COLUMNS =
  'id, plan_exercise_id, name, normalized_name, position, is_weekly_rotation';

function altCacheName(planExerciseId: string): string {
  return `alternatives.${planExerciseId}`;
}

export async function listAlternativesForExercise(
  planExerciseId: string
): Promise<ExerciseAlternativeRow[]> {
  const userId = await currentUserId();
  try {
    const data = await query(
      supabase
        .from('plan_exercise_alternatives')
        .select(ALT_COLUMNS)
        .eq('plan_exercise_id', planExerciseId)
        .order('position', { ascending: true }),
      { label: 'listAlternativesForExercise' }
    );
    const rows = (data as ExerciseAlternativeRow[]) ?? [];
    writeCache(userId, altCacheName(planExerciseId), rows);
    return rows;
  } catch (e) {
    if (!isOfflineError(e)) throw e;
    // Swapping to an alternative happens when the machine is taken — that can't
    // depend on signal, so the list is kept on the device.
    return readCache<ExerciseAlternativeRow[]>(userId, altCacheName(planExerciseId)) ?? [];
  }
}

export async function addAlternative(
  planExerciseId: string,
  name: string,
  normalizedName: string,
  options?: { isWeeklyRotation?: boolean }
): Promise<ExerciseAlternativeRow> {
  const userId = await currentUserId();
  if (!userId) throw new Error('Not signed in');

  // Append to the end of the existing list.
  const existing = await listAlternativesForExercise(planExerciseId);
  const nextPosition =
    existing.length > 0 ? Math.max(...existing.map((a) => a.position)) + 1 : 0;

  const { data, error } = await supabase
    .from('plan_exercise_alternatives')
    .insert({
      user_id: userId,
      plan_exercise_id: planExerciseId,
      name,
      normalized_name: normalizedName,
      position: nextPosition,
      is_weekly_rotation: options?.isWeeklyRotation ?? false,
    })
    .select(ALT_COLUMNS)
    .single();
  if (error) throw error;
  return data as ExerciseAlternativeRow;
}

export async function removeAlternative(id: string): Promise<void> {
  const { error } = await supabase
    .from('plan_exercise_alternatives')
    .delete()
    .eq('id', id);
  if (error) throw error;
}
