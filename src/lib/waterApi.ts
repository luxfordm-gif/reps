import { supabase, currentUserId } from './supabase';
import { isOfflineError, query } from './offline/net';
import { enqueue } from './offline/outbox';
import { readCache, writeCache } from './offline/storage';

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

function waterCacheName(date: string): string {
  return `water.${date}`;
}

export async function getTodayWaterCount(): Promise<number> {
  const userId = await currentUserId();
  if (!userId) return 0;
  const today = todayISO();
  try {
    const data = await query(
      supabase
        .from('water_logs')
        .select('count')
        .eq('user_id', userId)
        .eq('recorded_on', today)
        .maybeSingle(),
      { label: 'getTodayWaterCount' }
    );
    const count = (data as { count: number } | null)?.count ?? 0;
    writeCache(userId, waterCacheName(today), count);
    return count;
  } catch (e) {
    if (!isOfflineError(e)) return 0;
    return readCache<number>(userId, waterCacheName(today)) ?? 0;
  }
}

export async function adjustWater(delta: number): Promise<number> {
  const userId = await currentUserId();
  if (!userId) throw new Error('Not signed in');
  const today = todayISO();
  const cacheName = waterCacheName(today);
  const cached = readCache<number>(userId, cacheName) ?? 0;

  try {
    const existing = await query(
      supabase
        .from('water_logs')
        .select('count')
        .eq('user_id', userId)
        .eq('recorded_on', today)
        .maybeSingle(),
      { label: 'water:read' }
    );
    const next = Math.max(0, ((existing as { count: number } | null)?.count ?? 0) + delta);
    const data = await query(
      supabase
        .from('water_logs')
        .upsert(
          { user_id: userId, recorded_on: today, count: next },
          { onConflict: 'user_id,recorded_on' }
        )
        .select()
        .single(),
      { label: 'water:write' }
    );
    const saved = (data as { count: number }).count;
    writeCache(userId, cacheName, saved);
    return saved;
  } catch (e) {
    if (!isOfflineError(e)) throw e;
    // Count from the last value we knew about and queue the absolute total, so
    // several taps offline collapse into a single write.
    const next = Math.max(0, cached + delta);
    writeCache(userId, cacheName, next);
    enqueue(userId, { kind: 'water', recorded_on: today, count: next });
    return next;
  }
}
