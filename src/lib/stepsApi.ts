import { supabase, currentUserId } from './supabase';
import { isOfflineError, query } from './offline/net';
import { enqueue } from './offline/outbox';
import { newId, readCache, writeCache } from './offline/storage';

export interface StepRow {
  id: string;
  steps: number;
  recorded_on: string; // YYYY-MM-DD
  created_at: string;
}

const CACHE = 'steps';
const GOAL_KEY = 'reps.stepGoal';

export const DEFAULT_STEP_GOAL = 7000;
/** A day's count has to fit in the column's check constraint. */
export const MAX_STEPS = 300000;

export function getStepGoal(): number {
  if (typeof window === 'undefined') return DEFAULT_STEP_GOAL;
  const v = window.localStorage.getItem(GOAL_KEY);
  const n = v ? parseInt(v, 10) : DEFAULT_STEP_GOAL;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_STEP_GOAL;
}

export function setStepGoal(n: number) {
  if (typeof window === 'undefined') return;
  const clamped = Math.min(MAX_STEPS, Math.max(1, Math.round(n)));
  window.localStorage.setItem(GOAL_KEY, String(clamped));
}

function todayISO(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function sortRows(rows: StepRow[]): StepRow[] {
  return [...rows].sort((a, b) => (a.recorded_on < b.recorded_on ? 1 : -1));
}

/** Apply a saved/queued count to the cached history (one entry per day). */
function cacheUpsert(userId: string | null, row: StepRow): void {
  const rows = (readCache<StepRow[]>(userId, CACHE) ?? []).filter(
    (r) => r.recorded_on !== row.recorded_on
  );
  writeCache(userId, CACHE, sortRows([row, ...rows]));
}

export async function logSteps(steps: number, date?: string): Promise<StepRow> {
  const userId = await currentUserId();
  if (!userId) throw new Error('Not signed in');

  const recordedOn = date ?? todayISO();
  // Mint the id here so a count saved with no signal keeps the same row id once
  // it syncs — deleting it later still hits the right row.
  const row: StepRow = {
    id: newId(),
    steps,
    recorded_on: recordedOn,
    created_at: new Date().toISOString(),
  };
  try {
    const data = await query(
      supabase
        .from('step_logs')
        .upsert(
          { id: row.id, user_id: userId, steps, recorded_on: recordedOn },
          { onConflict: 'user_id,recorded_on' }
        )
        .select()
        .single(),
      { label: 'logSteps' }
    );
    const saved = data as StepRow;
    cacheUpsert(userId, saved);
    return saved;
  } catch (e) {
    if (!isOfflineError(e)) throw e;
    cacheUpsert(userId, row);
    enqueue(userId, {
      kind: 'steps',
      row: { id: row.id, steps, recorded_on: recordedOn },
    });
    return row;
  }
}

export async function listSteps(): Promise<StepRow[]> {
  const userId = await currentUserId();
  if (!userId) return [];

  try {
    const data = await query(
      supabase
        .from('step_logs')
        .select('*')
        .eq('user_id', userId)
        .order('recorded_on', { ascending: false }),
      { label: 'listSteps' }
    );
    const rows = (data as StepRow[]) ?? [];
    writeCache(userId, CACHE, rows);
    return rows;
  } catch (e) {
    if (!isOfflineError(e)) throw e;
    return readCache<StepRow[]>(userId, CACHE) ?? [];
  }
}

export async function deleteSteps(id: string): Promise<void> {
  const userId = await currentUserId();
  const rows = (readCache<StepRow[]>(userId, CACHE) ?? []).filter((r) => r.id !== id);
  writeCache(userId, CACHE, rows);
  try {
    await query(supabase.from('step_logs').delete().eq('id', id).select('id'), {
      label: 'deleteSteps',
    });
  } catch (e) {
    if (!isOfflineError(e) || !userId) throw e;
    enqueue(userId, { kind: 'delete_steps', id });
  }
}

export function getTodayEntry(rows: StepRow[]): StepRow | undefined {
  const t = todayISO();
  return rows.find((r) => r.recorded_on === t);
}

/** Today's count for the home tile — 0 when nothing has been logged yet. */
export async function getTodayStepCount(): Promise<number> {
  const userId = await currentUserId();
  if (!userId) return 0;
  const today = todayISO();
  try {
    const data = await query(
      supabase
        .from('step_logs')
        .select('steps')
        .eq('user_id', userId)
        .eq('recorded_on', today)
        .maybeSingle(),
      { label: 'getTodayStepCount' }
    );
    return (data as { steps: number } | null)?.steps ?? 0;
  } catch (e) {
    if (!isOfflineError(e)) return 0;
    const cached = readCache<StepRow[]>(userId, CACHE) ?? [];
    return cached.find((r) => r.recorded_on === today)?.steps ?? 0;
  }
}

/** "7,431" — thousands separated, which is how step counts are always read. */
export function formatSteps(n: number): string {
  return n.toLocaleString('en-GB');
}
