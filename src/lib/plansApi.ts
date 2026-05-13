import { supabase } from './supabase';
import type { ParsedPlan } from './parseTrainingPlan';

export interface PlanRow {
  id: string;
  name: string;
  uploaded_at: string;
  is_active: boolean;
  raw_text: string | null;
}

export interface TrainingDayRow {
  id: string;
  plan_id: string;
  name: string;
  position: number;
}

export interface PlanExerciseRow {
  id: string;
  training_day_id: string;
  body_part: string | null;
  name: string;
  normalized_name: string;
  total_sets: number | null;
  rep_range: string;
  tempo: string | null;
  notes: string | null;
  set_scheme: string;
  superset_group: number | null;
  position: number;
  rest_seconds: number | null;
  baseline_reset_at: string | null;
}

export async function updatePlanExerciseRest(
  exerciseId: string,
  restSeconds: number
): Promise<void> {
  const { error } = await supabase
    .from('plan_exercises')
    .update({ rest_seconds: restSeconds })
    .eq('id', exerciseId);
  if (error) throw error;
}

export async function updatePlanExerciseName(
  exerciseId: string,
  name: string,
  options: { resetBaseline: boolean }
): Promise<string | null> {
  const update: { name: string; baseline_reset_at?: string } = { name };
  if (options.resetBaseline) {
    update.baseline_reset_at = new Date().toISOString();
  }
  const { data, error } = await supabase
    .from('plan_exercises')
    .update(update)
    .eq('id', exerciseId)
    .select('baseline_reset_at')
    .single();
  if (error) throw error;
  return (data?.baseline_reset_at as string | null) ?? null;
}

export interface FullPlan extends PlanRow {
  training_days: (TrainingDayRow & { plan_exercises: PlanExerciseRow[] })[];
}

export async function savePlan(
  parsed: ParsedPlan,
  name: string,
  rawText: string
): Promise<PlanRow> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  // Deactivate any existing plans
  await supabase.from('plans').update({ is_active: false }).eq('user_id', user.id);

  const { data: plan, error: planErr } = await supabase
    .from('plans')
    .insert({ user_id: user.id, name, raw_text: rawText, is_active: true })
    .select()
    .single();
  if (planErr) throw planErr;

  for (const day of parsed.days) {
    const { data: td, error: tdErr } = await supabase
      .from('training_days')
      .insert({
        plan_id: plan.id,
        user_id: user.id,
        name: day.name,
        position: day.position,
      })
      .select()
      .single();
    if (tdErr) throw tdErr;

    if (day.exercises.length > 0) {
      const rows = day.exercises.map((e) => ({
        training_day_id: td.id,
        user_id: user.id,
        body_part: e.bodyPart,
        name: e.name,
        normalized_name: e.normalizedName,
        total_sets: e.totalSets,
        rep_range: e.repRange,
        tempo: e.tempo,
        notes: e.notes,
        set_scheme: e.setScheme,
        position: e.position,
      }));
      const { error: exErr } = await supabase.from('plan_exercises').insert(rows);
      if (exErr) throw exErr;
    }
  }

  return plan as PlanRow;
}

export async function getActivePlan(): Promise<FullPlan | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('plans')
    .select('*, training_days(*, plan_exercises(*))')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .order('uploaded_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  // Sort nested arrays
  data.training_days?.sort((a: TrainingDayRow, b: TrainingDayRow) => a.position - b.position);
  for (const td of data.training_days ?? []) {
    td.plan_exercises?.sort(
      (a: PlanExerciseRow, b: PlanExerciseRow) => a.position - b.position
    );
  }
  return data as FullPlan;
}
