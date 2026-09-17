import { supabase, currentUserId } from './supabase';
import { getLiftWeightUnit, type MachineUnit } from './units';
import { parseLoadPositions, type LoadPositions } from './weightProfile';

const CACHE_PREFIX = 'reps.liftWeightUnit.';
const POSITIONS_PREFIX = 'reps.loadPositions.';

function cacheKey(normalizedName: string): string {
  return CACHE_PREFIX + normalizedName;
}

function positionsCacheKey(normalizedName: string): string {
  return POSITIONS_PREFIX + normalizedName;
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
  const userId = await currentUserId();
  if (!userId) throw new Error('Not signed in');
  const { error } = await supabase.from('exercise_unit_prefs').upsert(
    {
      user_id: userId,
      normalized_name: normalizedName,
      weight_unit: unit,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,normalized_name' }
  );
  if (error) throw error;
}

// Drops the localStorage cache entries so the next read goes back to the DB.
// Call this after rename / merge / delete / unit changes so ExerciseLogger
// doesn't repaint with a stale unit or weight profile.
export function clearCachedExerciseUnit(normalizedName: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(cacheKey(normalizedName));
  window.localStorage.removeItem(positionsCacheKey(normalizedName));
}

/** True when a write bounced off a database that hasn't had migration 0017 run
 *  against it — PostgREST answers an unknown column with its own code, or
 *  Postgres with 42703. Worth telling the user about, unlike a lost connection:
 *  no amount of waiting will make this one land. */
export function isMissingProfileColumn(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const err = e as { code?: string; message?: string };
  if (err.code === '42703' || err.code === 'PGRST204') return true;
  const message = err.message ?? '';
  return /load_positions|position_weights/.test(message);
}

// How many points this machine loads at — 1 for an ordinary machine, 2 or 3 for
// a plate-loaded machine with numbered pegs. Same shape as the unit preference:
// a synchronous cached read for first paint, then a DB read to reconcile.

export function getCachedExerciseLoadPositions(normalizedName: string): LoadPositions {
  if (typeof window === 'undefined') return 1;
  return parseLoadPositions(window.localStorage.getItem(positionsCacheKey(normalizedName)));
}

export async function getExerciseLoadPositions(
  normalizedName: string
): Promise<LoadPositions> {
  const { data, error } = await supabase
    .from('exercise_unit_prefs')
    .select('load_positions')
    .eq('normalized_name', normalizedName)
    .maybeSingle();
  // A profile is an opt-in extra: any trouble reading it (offline, or a database
  // that hasn't had 0017 run against it yet) leaves the machine as whatever the
  // device last knew, never mid-edit with a point that can't be saved.
  if (error) return getCachedExerciseLoadPositions(normalizedName);
  const positions = parseLoadPositions(
    (data as { load_positions?: number | null } | null)?.load_positions
  );
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(positionsCacheKey(normalizedName), String(positions));
  }
  return positions;
}

export async function setExerciseLoadPositions(
  normalizedName: string,
  positions: LoadPositions
): Promise<void> {
  // Cache first, as with the unit: the toggle holds even if the write can't land.
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(positionsCacheKey(normalizedName), String(positions));
  }
  const userId = await currentUserId();
  if (!userId) throw new Error('Not signed in');
  // Update in place where the machine already has a preferences row — an upsert
  // would have to invent a weight_unit and could overwrite a real one.
  const { data, error } = await supabase
    .from('exercise_unit_prefs')
    .update({ load_positions: positions, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('normalized_name', normalizedName)
    .select('normalized_name');
  if (error) throw error;
  if ((data?.length ?? 0) > 0) return;
  const { error: insertError } = await supabase.from('exercise_unit_prefs').insert({
    user_id: userId,
    normalized_name: normalizedName,
    weight_unit: getCachedExerciseUnit(normalizedName),
    load_positions: positions,
    updated_at: new Date().toISOString(),
  });
  if (insertError) throw insertError;
}
