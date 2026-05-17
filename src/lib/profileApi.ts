import { supabase } from './supabase';

export type Gender = 'male' | 'female' | 'other';
export type TopGoal = 'build_muscle' | 'gain_strength' | 'fat_loss';
export type Experience = 'beginner' | 'intermediate' | 'advanced';

export interface Profile {
  user_id: string;
  gender: Gender | null;
  date_of_birth: string | null; // YYYY-MM-DD
  starting_weight_kg: number | null;
  height_cm: number | null;
  top_goal: TopGoal | null;
  experience_level: Experience | null;
  onboarding_completed: boolean;
  created_at: string;
  updated_at: string;
}

export type ProfilePatch = Partial<Omit<Profile, 'user_id' | 'created_at' | 'updated_at'>>;

export async function getMyProfile(): Promise<Profile | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  return (data as Profile) ?? null;
}

export async function upsertProfile(patch: ProfilePatch): Promise<Profile> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { data, error } = await supabase
    .from('profiles')
    .upsert({ user_id: user.id, ...patch }, { onConflict: 'user_id' })
    .select()
    .single();
  if (error) throw error;
  return data as Profile;
}

export async function markOnboardingComplete(): Promise<Profile> {
  return upsertProfile({ onboarding_completed: true });
}
