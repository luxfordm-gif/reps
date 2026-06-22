import { supabase } from './supabase';

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
}

export async function listAlternativesForExercise(
  planExerciseId: string
): Promise<ExerciseAlternativeRow[]> {
  const { data, error } = await supabase
    .from('plan_exercise_alternatives')
    .select('id, plan_exercise_id, name, normalized_name, position')
    .eq('plan_exercise_id', planExerciseId)
    .order('position', { ascending: true });
  if (error) throw error;
  return (data as ExerciseAlternativeRow[]) ?? [];
}

export async function addAlternative(
  planExerciseId: string,
  name: string,
  normalizedName: string
): Promise<ExerciseAlternativeRow> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  // Append to the end of the existing list.
  const existing = await listAlternativesForExercise(planExerciseId);
  const nextPosition =
    existing.length > 0 ? Math.max(...existing.map((a) => a.position)) + 1 : 0;

  const { data, error } = await supabase
    .from('plan_exercise_alternatives')
    .insert({
      user_id: user.id,
      plan_exercise_id: planExerciseId,
      name,
      normalized_name: normalizedName,
      position: nextPosition,
    })
    .select('id, plan_exercise_id, name, normalized_name, position')
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
