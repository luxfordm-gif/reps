import { supabase } from './supabase';
import type { ParsedPlan } from './parseTrainingPlan';

export interface PlanRow {
  id: string;
  name: string;
  uploaded_at: string;
  is_active: boolean;
  raw_text: string | null;
  activated_at: string | null;
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

  // Deactivate any existing plans (keep them in the library)
  await supabase.from('plans').update({ is_active: false }).eq('user_id', user.id);

  const nowIso = new Date().toISOString();
  const { data: plan, error: planErr } = await supabase
    .from('plans')
    .insert({
      user_id: user.id,
      name,
      raw_text: rawText,
      is_active: true,
      activated_at: nowIso,
    })
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

  data.training_days?.sort((a: TrainingDayRow, b: TrainingDayRow) => a.position - b.position);
  for (const td of data.training_days ?? []) {
    td.plan_exercises?.sort(
      (a: PlanExerciseRow, b: PlanExerciseRow) => a.position - b.position
    );
  }
  return data as FullPlan;
}

export interface PlanSummary extends PlanRow {
  day_count: number;
}

export async function listPlans(): Promise<PlanSummary[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('plans')
    .select('*, training_days(id)')
    .eq('user_id', user.id)
    .order('is_active', { ascending: false })
    .order('uploaded_at', { ascending: false });
  if (error) throw error;
  type Row = PlanRow & { training_days: { id: string }[] | null };
  return ((data as Row[]) ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    uploaded_at: r.uploaded_at,
    is_active: r.is_active,
    raw_text: r.raw_text,
    activated_at: r.activated_at,
    day_count: r.training_days?.length ?? 0,
  }));
}

export async function getPlanDetail(planId: string): Promise<FullPlan | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('plans')
    .select('*, training_days(*, plan_exercises(*))')
    .eq('user_id', user.id)
    .eq('id', planId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  data.training_days?.sort((a: TrainingDayRow, b: TrainingDayRow) => a.position - b.position);
  for (const td of data.training_days ?? []) {
    td.plan_exercises?.sort(
      (a: PlanExerciseRow, b: PlanExerciseRow) => a.position - b.position
    );
  }
  return data as FullPlan;
}

export async function renamePlan(planId: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Plan name cannot be empty');
  if (trimmed.length > 80) throw new Error('Plan name is too long (max 80 chars)');
  const { error } = await supabase.from('plans').update({ name: trimmed }).eq('id', planId);
  if (error) throw error;
}

export async function activatePlan(
  planId: string,
  mode: 'resume' | 'restart'
): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  // Deactivate everything else first.
  const { error: deErr } = await supabase
    .from('plans')
    .update({ is_active: false })
    .eq('user_id', user.id);
  if (deErr) throw deErr;

  const update: { is_active: boolean; activated_at?: string } = { is_active: true };
  if (mode === 'restart') {
    update.activated_at = new Date().toISOString();
  } else {
    // Resume: only set activated_at if it's currently null (e.g. a plan that
    // was uploaded but never explicitly activated yet).
    const { data: existing } = await supabase
      .from('plans')
      .select('activated_at')
      .eq('id', planId)
      .maybeSingle();
    if (!existing?.activated_at) {
      update.activated_at = new Date().toISOString();
    }
  }

  const { error } = await supabase.from('plans').update(update).eq('id', planId);
  if (error) throw error;
}

// Week 1 starts on activation day. Day 0..6 = Week 1, day 7..13 = Week 2, etc.
export function weeksOnPlan(activatedAt: string | null): number {
  if (!activatedAt) return 1;
  const ms = Date.now() - new Date(activatedAt).getTime();
  if (ms < 0) return 1;
  return Math.floor(ms / (7 * 24 * 60 * 60 * 1000)) + 1;
}
