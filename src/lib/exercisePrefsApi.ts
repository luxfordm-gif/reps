import { supabase } from './supabase';
import { getLiftWeightUnit, type MachineUnit } from './units';

const CACHE_PREFIX = 'reps.liftWeightUnit.';

function cacheKey(normalizedName: string): string {
  return CACHE_PREFIX + normalizedName;
}

function parseUnit(v: string | null | undefined): MachineUnit | null {
  return v === 'kg' || v === 'lb' || v === 'pin' ? v : null;
}

// Synchronous read — used at first paint so the screen doesn't flash kg → lb.
// Falls through to the global lift weight preference when no per-machine value
// has been cached yet.
export function getCachedExerciseUnit(normalizedName: string): MachineUnit {
  if (typeof window === 'undefined') return getLiftWeightUnit();
  return parseUnit(window.localStorage.getItem(cacheKey(normalizedName))) ?? getLiftWeightUnit();
}

export async function getExerciseUnit(
  normalizedName: string
): Promise<MachineUnit> {
  const { data, error } = await supabase
    .from('exercise_unit_prefs')
    .select('weight_unit')
    .eq('normalized_name', normalizedName)
    .maybeSingle();
  if (error) throw error;
  const unit: MachineUnit = parseUnit(data?.weight_unit) ?? getLiftWeightUnit();
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(cacheKey(normalizedName), unit);
  }
  return unit;
}

export async function setExerciseUnit(
  normalizedName: string,
  unit: MachineUnit
): Promise<void> {
  // Write cache first so a navigate-away/return shows the new unit instantly,
  // even if the DB write is in flight or fails.
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(cacheKey(normalizedName), unit);
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { error } = await supabase.from('exercise_unit_prefs').upsert(
    {
      user_id: user.id,
      normalized_name: normalizedName,
      weight_unit: unit,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,normalized_name' }
  );
  if (error) throw error;
}

// Drops the localStorage cache entry so the next read goes back to the DB.
// Call this after rename / merge / delete / unit changes so ExerciseLogger
// doesn't repaint with a stale unit.
export function clearCachedExerciseUnit(normalizedName: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(cacheKey(normalizedName));
}
