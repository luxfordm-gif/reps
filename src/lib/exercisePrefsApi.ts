import { supabase, currentUserId } from './supabase';
import { getLiftWeightUnit, type MachineUnit } from './units';
import {
  NO_PROFILE,
  parseProfile,
  type MachineProfile,
} from './weightProfile';

const CACHE_PREFIX = 'reps.liftWeightUnit.';
const PROFILE_PREFIX = 'reps.loadProfile.';
// 0017's cache key, written before a profile had a kind. Still read so a machine
// tagged on this device keeps its pegs after the app updates.
const POSITIONS_PREFIX = 'reps.loadPositions.';

function cacheKey(normalizedName: string): string {
  return CACHE_PREFIX + normalizedName;
}

function profileCacheKey(normalizedName: string): string {
  return PROFILE_PREFIX + normalizedName;
}

function legacyPositionsKey(normalizedName: string): string {
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
  window.localStorage.removeItem(profileCacheKey(normalizedName));
  window.localStorage.removeItem(legacyPositionsKey(normalizedName));
}

/** True when a write bounced off a database missing the weight-profile columns
 *  against it — PostgREST answers an unknown column with its own code, or
 *  Postgres with 42703. Worth telling the user about, unlike a lost connection:
 *  no amount of waiting will make this one land. 0018 is caught the same way. */
export function isMissingProfileColumn(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const err = e as { code?: string; message?: string };
  if (err.code === '42703' || err.code === 'PGRST204') return true;
  const message = err.message ?? '';
  return /load_profile|load_positions|position_weights/.test(message);
}

// A machine's weight profile — whether it loads at several pegs or picks a cam
// position, and how many of them there are. Same shape as the unit preference:
// a synchronous cached read for first paint, then a DB read to reconcile.

export function getCachedExerciseProfile(normalizedName: string): MachineProfile {
  if (typeof window === 'undefined') return NO_PROFILE;
  const raw = window.localStorage.getItem(profileCacheKey(normalizedName));
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { kind?: unknown; positions?: unknown };
      return parseProfile(parsed.kind, parsed.positions);
    } catch {
      // Fall through to the older key.
    }
  }
  return parseProfile(null, window.localStorage.getItem(legacyPositionsKey(normalizedName)));
}

function cacheProfile(normalizedName: string, profile: MachineProfile): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(profileCacheKey(normalizedName), JSON.stringify(profile));
  // The old key would otherwise win back a profile that has been switched off.
  window.localStorage.removeItem(legacyPositionsKey(normalizedName));
}

export async function getExerciseProfile(
  normalizedName: string
): Promise<MachineProfile> {
  const { data, error } = await supabase
    .from('exercise_unit_prefs')
    .select('load_profile, load_positions')
    .eq('normalized_name', normalizedName)
    .maybeSingle();
  // A profile is an opt-in extra: any trouble reading it (offline, or a database
  // that hasn't had 0017/0018 run against it yet) leaves the machine as whatever
  // the device last knew, never mid-edit with a position that can't be saved.
  if (error) return getCachedExerciseProfile(normalizedName);
  const row = data as { load_profile?: unknown; load_positions?: unknown } | null;
  const profile = parseProfile(row?.load_profile, row?.load_positions);
  cacheProfile(normalizedName, profile);
  return profile;
}

export async function setExerciseProfile(
  normalizedName: string,
  profile: MachineProfile
): Promise<void> {
  // Cache first, as with the unit: the choice holds even if the write can't land.
  cacheProfile(normalizedName, profile);
  const userId = await currentUserId();
  if (!userId) throw new Error('Not signed in');
  const patch = {
    load_profile: profile.kind,
    load_positions: profile.kind ? profile.positions : null,
    updated_at: new Date().toISOString(),
  };
  // Update in place where the machine already has a preferences row — an upsert
  // would have to invent a weight_unit and could overwrite a real one.
  const { data, error } = await supabase
    .from('exercise_unit_prefs')
    .update(patch)
    .eq('user_id', userId)
    .eq('normalized_name', normalizedName)
    .select('normalized_name');
  if (error) throw error;
  if ((data?.length ?? 0) > 0) return;
  const { error: insertError } = await supabase.from('exercise_unit_prefs').insert({
    user_id: userId,
    normalized_name: normalizedName,
    weight_unit: getCachedExerciseUnit(normalizedName),
    ...patch,
  });
  if (insertError) throw insertError;
}
