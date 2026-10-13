import { supabase, currentUserId } from './supabase';
import { isOfflineError, query } from './offline/net';
import { enqueue } from './offline/outbox';
import { newId, readCache, writeCache } from './offline/storage';

export interface SleepRow {
  id: string;
  hours: number;
  /** The morning it was logged: Tuesday's row is Monday night's sleep. */
  recorded_on: string; // YYYY-MM-DD
  created_at: string;
}

const CACHE = 'sleep';
const GOAL_KEY = 'reps.sleepGoal';

export const DEFAULT_SLEEP_GOAL = 8;
/** A night's hours have to fit in the column's check constraint. */
export const MAX_SLEEP_HOURS = 24;

export function getSleepGoal(): number {
  if (typeof window === 'undefined') return DEFAULT_SLEEP_GOAL;
  const v = window.localStorage.getItem(GOAL_KEY);
  const n = v ? parseFloat(v) : DEFAULT_SLEEP_GOAL;
  return Number.isFinite(n) && n > 0 && n <= MAX_SLEEP_HOURS ? n : DEFAULT_SLEEP_GOAL;
}

export function setSleepGoal(n: number) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(GOAL_KEY, String(roundToHalf(n)));
}

/** Hours are kept to the nearest half hour — nobody knows their sleep closer. */
export function roundToHalf(n: number): number {
  return Math.min(MAX_SLEEP_HOURS, Math.max(0, Math.round(n * 2) / 2));
}

function todayISO(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function sortRows(rows: SleepRow[]): SleepRow[] {
  return [...rows].sort((a, b) => (a.recorded_on < b.recorded_on ? 1 : -1));
}

/** Postgres numeric comes back as a string from PostgREST; the app wants a number. */
function normalize(row: SleepRow): SleepRow {
  return { ...row, hours: Number(row.hours) };
}

/** Apply a saved/queued night to the cached history (one entry per day). */
function cacheUpsert(userId: string | null, row: SleepRow): void {
  const rows = (readCache<SleepRow[]>(userId, CACHE) ?? []).filter(
    (r) => r.recorded_on !== row.recorded_on
  );
  writeCache(userId, CACHE, sortRows([row, ...rows]));
}

export async function logSleep(hours: number, date?: string): Promise<SleepRow> {
  const userId = await currentUserId();
  if (!userId) throw new Error('Not signed in');

  const recordedOn = date ?? todayISO();
  // Mint the id here so a night saved with no signal keeps the same row id once
  // it syncs — deleting it later still hits the right row.
  const row: SleepRow = {
    id: newId(),
    hours,
    recorded_on: recordedOn,
    created_at: new Date().toISOString(),
  };
  try {
    const data = await query(
      supabase
        .from('sleep_logs')
        .upsert(
          { id: row.id, user_id: userId, hours, recorded_on: recordedOn },
          { onConflict: 'user_id,recorded_on' }
        )
        .select()
        .single(),
      { label: 'logSleep' }
    );
    const saved = normalize(data as SleepRow);
    cacheUpsert(userId, saved);
    return saved;
  } catch (e) {
    if (!isOfflineError(e)) throw e;
    cacheUpsert(userId, row);
    enqueue(userId, {
      kind: 'sleep',
      row: { id: row.id, hours, recorded_on: recordedOn },
    });
    return row;
  }
}

export async function listSleep(): Promise<SleepRow[]> {
  const userId = await currentUserId();
  if (!userId) return [];

  try {
    const data = await query(
      supabase
        .from('sleep_logs')
        .select('*')
        .eq('user_id', userId)
        .order('recorded_on', { ascending: false }),
      { label: 'listSleep' }
    );
    const rows = ((data as SleepRow[]) ?? []).map(normalize);
    writeCache(userId, CACHE, rows);
    return rows;
  } catch (e) {
    if (!isOfflineError(e)) throw e;
    return readCache<SleepRow[]>(userId, CACHE) ?? [];
  }
}

export async function deleteSleep(id: string): Promise<void> {
  const userId = await currentUserId();
  const rows = (readCache<SleepRow[]>(userId, CACHE) ?? []).filter((r) => r.id !== id);
  writeCache(userId, CACHE, rows);
  try {
    await query(supabase.from('sleep_logs').delete().eq('id', id).select('id'), {
      label: 'deleteSleep',
    });
  } catch (e) {
    if (!isOfflineError(e) || !userId) throw e;
    enqueue(userId, { kind: 'delete_sleep', id });
  }
}

export function getTodayEntry(rows: SleepRow[]): SleepRow | undefined {
  const t = todayISO();
  return rows.find((r) => r.recorded_on === t);
}

/** Last night's hours for the home tile — null when nothing has been logged yet. */
export async function getTodaySleepHours(): Promise<number | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  const today = todayISO();
  try {
    const data = await query(
      supabase
        .from('sleep_logs')
        .select('hours')
        .eq('user_id', userId)
        .eq('recorded_on', today)
        .maybeSingle(),
      { label: 'getTodaySleepHours' }
    );
    const hours = (data as { hours: number | string } | null)?.hours;
    return hours == null ? null : Number(hours);
  } catch (e) {
    if (!isOfflineError(e)) return null;
    const cached = readCache<SleepRow[]>(userId, CACHE) ?? [];
    return cached.find((r) => r.recorded_on === today)?.hours ?? null;
  }
}

/** "7.5 h" — one decimal only when there is a half hour to show. */
export function formatSleep(hours: number): string {
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`;
}
