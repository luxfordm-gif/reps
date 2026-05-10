import { supabase } from './supabase';

const GOAL_KEY = 'reps.waterGoal';
const UNIT_KEY = 'reps.waterUnit';

export type WaterUnit = 'bottles' | 'glasses' | 'cups' | 'L';

const ALLOWED_UNITS: WaterUnit[] = ['bottles', 'glasses', 'cups', 'L'];

export function getWaterGoal(): number {
  if (typeof window === 'undefined') return 6;
  const v = window.localStorage.getItem(GOAL_KEY);
  const n = v ? parseInt(v, 10) : 6;
  return Number.isFinite(n) && n > 0 ? n : 6;
}

export function setWaterGoal(n: number) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(GOAL_KEY, String(Math.max(1, Math.round(n))));
}

export function getWaterUnit(): WaterUnit {
  if (typeof window === 'undefined') return 'bottles';
  const v = window.localStorage.getItem(UNIT_KEY) as WaterUnit | null;
  return v && ALLOWED_UNITS.includes(v) ? v : 'bottles';
}

export function setWaterUnit(u: WaterUnit) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(UNIT_KEY, u);
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function getTodayWaterCount(): Promise<number> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return 0;
  const { data, error } = await supabase
    .from('water_logs')
    .select('count')
    .eq('user_id', user.id)
    .eq('recorded_on', todayISO())
    .maybeSingle();
  if (error) return 0;
  return data?.count ?? 0;
}

export async function adjustWater(delta: number): Promise<number> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const today = todayISO();
  const { data: existing } = await supabase
    .from('water_logs')
    .select('count')
    .eq('user_id', user.id)
    .eq('recorded_on', today)
    .maybeSingle();
  const next = Math.max(0, (existing?.count ?? 0) + delta);
  const { data, error } = await supabase
    .from('water_logs')
    .upsert(
      { user_id: user.id, recorded_on: today, count: next },
      { onConflict: 'user_id,recorded_on' }
    )
    .select()
    .single();
  if (error) throw error;
  return data.count;
}
