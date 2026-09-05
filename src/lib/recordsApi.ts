import { supabase, currentUserId } from './supabase';
import { getLiftWeightUnit, type MachineUnit } from './units';
import { computeRecords, type LiftRecord, type RawSet } from './records';

// Loading personal records. The folding itself lives in ./records, which stays
// free of the Supabase client so it can be exercised by scripts/test-records.mjs.

export type { LiftRecord, RecordKind, RecordSet } from './records';
export { computeRecords, groupByBodyPart, recordAchievedAt, sortRecords } from './records';

type SetRow = {
  exercise_display_name: string;
  exercise_normalized_name: string;
  weight: number | null;
  reps: number | null;
  hold_seconds: number | null;
  completed_at: string;
  plan_exercises?: { body_part: string | null } | { body_part: string | null }[] | null;
};

type PrefRow = {
  normalized_name: string;
  weight_unit: string | null;
  display_name: string | null;
  body_part_override: string | null;
};

function pickUnit(raw: string | null | undefined, fallback: MachineUnit): MachineUnit {
  return raw === 'kg' || raw === 'lb' || raw === 'pin' ? raw : fallback;
}

/**
 * Every personal record for the signed-in user.
 *
 * Two queries: the sets themselves, and the per-machine preferences that decide
 * what a record is called and which unit it reads in. A machine renamed in
 * Settings shows under its chosen name here too.
 */
export async function loadRecords(): Promise<LiftRecord[]> {
  const userId = await currentUserId();
  if (!userId) return [];

  const [setsRes, prefsRes] = await Promise.all([
    supabase
      .from('logged_sets')
      .select(
        'exercise_display_name, exercise_normalized_name, weight, reps, hold_seconds, completed_at, plan_exercises(body_part)'
      )
      .eq('user_id', userId)
      .order('completed_at', { ascending: false })
      .limit(20000),
    supabase
      .from('exercise_unit_prefs')
      .select('normalized_name, weight_unit, display_name, body_part_override')
      .eq('user_id', userId),
  ]);
  if (setsRes.error) throw setsRes.error;
  if (prefsRes.error) throw prefsRes.error;

  const raw: RawSet[] = ((setsRes.data as SetRow[]) ?? []).map((r) => {
    const pe = Array.isArray(r.plan_exercises) ? r.plan_exercises[0] : r.plan_exercises;
    const bp = pe?.body_part?.trim();
    return {
      normalizedName: r.exercise_normalized_name,
      displayName: r.exercise_display_name,
      bodyPart: bp ? bp : null,
      weightKg: r.weight,
      reps: r.reps,
      holdSeconds: r.hold_seconds,
      completedAt: r.completed_at,
    };
  });

  const prefs = new Map<string, PrefRow>();
  for (const p of (prefsRes.data as PrefRow[]) ?? []) prefs.set(p.normalized_name, p);

  const globalUnit = getLiftWeightUnit();
  return computeRecords(raw).map((r) => {
    const p = prefs.get(r.normalizedName);
    return {
      ...r,
      displayName: p?.display_name?.trim() || r.displayName,
      bodyPart: p?.body_part_override?.trim() || r.bodyPart,
      unit: pickUnit(p?.weight_unit, globalUnit),
    };
  });
}
