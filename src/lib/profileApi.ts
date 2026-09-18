import { supabase, currentUserId } from './supabase';

export type Gender = 'male' | 'female' | 'other';
export type TopGoal = 'build_muscle' | 'gain_strength' | 'fat_loss';
export type Experience = 'beginner' | 'intermediate' | 'advanced';

export interface Profile {
  user_id: string;
  /** What to greet them by. Null until they tell us — see lib/displayName. */
  display_name: string | null;
  gender: Gender | null;
  date_of_birth: string | null; // YYYY-MM-DD
  starting_weight_kg: number | null;
  height_cm: number | null;
  top_goals: TopGoal[] | null;
  experience_level: Experience | null;
  onboarding_completed: boolean;
  created_at: string;
  updated_at: string;
}

export type ProfilePatch = Partial<Omit<Profile, 'user_id' | 'created_at' | 'updated_at'>>;

export async function getMyProfile(): Promise<Profile | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as Profile) ?? null;
}

/** A write that named a column this database hasn't got yet (migration 0019
 *  not run). Postgres says 42703; PostgREST's schema cache says PGRST204. */
function isMissingDisplayName(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const err = e as { code?: string; message?: string };
  if (err.code === '42703' || err.code === 'PGRST204') return true;
  return /display_name/.test(err.message ?? '');
}

export async function upsertProfile(patch: ProfilePatch): Promise<Profile> {
  const userId = await currentUserId();
  if (!userId) throw new Error('Not signed in');
  const write = async (p: ProfilePatch) =>
    supabase
      .from('profiles')
      .upsert({ user_id: userId, ...p }, { onConflict: 'user_id' })
      .select()
      .single();

  const { data, error } = await write(patch);
  if (!error) return data as Profile;
  // A name is worth asking for, but not worth failing onboarding over: on a
  // database without 0019 applied, save everything else and carry on.
  if ('display_name' in patch && isMissingDisplayName(error)) {
    const { display_name: _dropped, ...rest } = patch;
    void _dropped;
    if (Object.keys(rest).length === 0) return (await getMyProfile()) as Profile;
    const retry = await write(rest);
    if (retry.error) throw retry.error;
    return retry.data as Profile;
  }
  throw error;
}

export async function markOnboardingComplete(): Promise<Profile> {
  return upsertProfile({ onboarding_completed: true });
}
