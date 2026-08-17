import { supabase, currentUserId } from './supabase';
import { isOfflineError, query } from './offline/net';
import { enqueue } from './offline/outbox';
import { newId, readCache, writeCache } from './offline/storage';

export interface BodyWeightRow {
  id: string;
  weight_kg: number;
  recorded_on: string; // YYYY-MM-DD
  created_at: string;
}

const CACHE = 'bodyWeights';

function todayISO(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function sortRows(rows: BodyWeightRow[]): BodyWeightRow[] {
  return [...rows].sort((a, b) => (a.recorded_on < b.recorded_on ? 1 : -1));
}

/** Apply a saved/queued weight to the cached history (one entry per day). */
function cacheUpsert(userId: string | null, row: BodyWeightRow): void {
  const rows = (readCache<BodyWeightRow[]>(userId, CACHE) ?? []).filter(
    (r) => r.recorded_on !== row.recorded_on
  );
  writeCache(userId, CACHE, sortRows([row, ...rows]));
}

export async function logBodyWeight(
  weightKg: number,
  date?: string
): Promise<BodyWeightRow> {
  const userId = await currentUserId();
  if (!userId) throw new Error('Not signed in');

  const recordedOn = date ?? todayISO();
  // Mint the id here so an entry saved with no signal keeps the same row id
  // once it syncs — deleting it later still hits the right row.
  const row: BodyWeightRow = {
    id: newId(),
    weight_kg: weightKg,
    recorded_on: recordedOn,
    created_at: new Date().toISOString(),
  };
  try {
    const data = await query(
      supabase
        .from('body_weights')
        .upsert(
          {
            id: row.id,
            user_id: userId,
            weight_kg: weightKg,
            recorded_on: recordedOn,
          },
          { onConflict: 'user_id,recorded_on' }
        )
        .select()
        .single(),
      { label: 'logBodyWeight' }
    );
    const saved = data as BodyWeightRow;
    cacheUpsert(userId, saved);
    return saved;
  } catch (e) {
    if (!isOfflineError(e)) throw e;
    cacheUpsert(userId, row);
    enqueue(userId, {
      kind: 'body_weight',
      row: { id: row.id, weight_kg: weightKg, recorded_on: recordedOn },
    });
    return row;
  }
}

export async function listBodyWeights(): Promise<BodyWeightRow[]> {
  const userId = await currentUserId();
  if (!userId) return [];

  try {
    const data = await query(
      supabase
        .from('body_weights')
        .select('*')
        .eq('user_id', userId)
        .order('recorded_on', { ascending: false }),
      { label: 'listBodyWeights' }
    );
    const rows = (data as BodyWeightRow[]) ?? [];
    writeCache(userId, CACHE, rows);
    return rows;
  } catch (e) {
    if (!isOfflineError(e)) throw e;
    return readCache<BodyWeightRow[]>(userId, CACHE) ?? [];
  }
}

export async function deleteBodyWeight(id: string): Promise<void> {
  const userId = await currentUserId();
  const rows = (readCache<BodyWeightRow[]>(userId, CACHE) ?? []).filter((r) => r.id !== id);
  writeCache(userId, CACHE, rows);
  try {
    await query(supabase.from('body_weights').delete().eq('id', id).select('id'), {
      label: 'deleteBodyWeight',
    });
  } catch (e) {
    if (!isOfflineError(e) || !userId) throw e;
    enqueue(userId, { kind: 'delete_body_weight', id });
  }
}

export function getTodayEntry(rows: BodyWeightRow[]): BodyWeightRow | undefined {
  const t = todayISO();
  return rows.find((r) => r.recorded_on === t);
}
