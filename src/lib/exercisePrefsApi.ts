import { supabase } from './supabase';
import { getLiftWeightUnit, type LiftWeightUnit } from './units';

const CACHE_PREFIX = 'reps.liftWeightUnit.';

function cacheKey(normalizedName: string): string {
  return CACHE_PREFIX + normalizedName;
}

// Synchronous read — used at first paint so the screen doesn't flash kg → lb.
// Falls through to the global lift weight preference when no per-machine value
// has been cached yet.
export function getCachedExerciseUnit(normalizedName: string): LiftWeightUnit {
  if (typeof window === 'undefined') return getLiftWeightUnit();
  const v = window.localStorage.getItem(cacheKey(normalizedName));
  if (v === 'kg' || v === 'lb') return v;
  return getLiftWeightUnit();
}

export async function getExerciseUnit(
  normalizedName: string
): Promise<LiftWeightUnit> {
  const { data, error } = await supabase
    .from('exercise_unit_prefs')
    .select('weight_unit')
    .eq('normalized_name', normalizedName)
    .maybeSingle();
  if (error) throw error;
  const unit: LiftWeightUnit =
    data?.weight_unit === 'lb' || data?.weight_unit === 'kg'
      ? data.weight_unit
      : getLiftWeightUnit();
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(cacheKey(normalizedName), unit);
  }
  return unit;
}

export async function setExerciseUnit(
  normalizedName: string,
  unit: LiftWeightUnit
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
