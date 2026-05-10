import { supabase } from './supabase';

export interface BodyWeightRow {
  id: string;
  weight_kg: number;
  recorded_on: string; // YYYY-MM-DD
  created_at: string;
}

function todayISO(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function logBodyWeight(weightKg: number, date?: string): Promise<BodyWeightRow> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const recordedOn = date ?? todayISO();
  const { data, error } = await supabase
    .from('body_weights')
    .upsert(
      { user_id: user.id, weight_kg: weightKg, recorded_on: recordedOn },
      { onConflict: 'user_id,recorded_on' }
    )
    .select()
    .single();
  if (error) throw error;
  return data as BodyWeightRow;
}

export async function listBodyWeights(): Promise<BodyWeightRow[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('body_weights')
    .select('*')
    .eq('user_id', user.id)
    .order('recorded_on', { ascending: false });
  if (error) throw error;
  return (data as BodyWeightRow[]) ?? [];
}

export async function deleteBodyWeight(id: string): Promise<void> {
  const { error } = await supabase.from('body_weights').delete().eq('id', id);
  if (error) throw error;
}

export function getTodayEntry(rows: BodyWeightRow[]): BodyWeightRow | undefined {
  const t = todayISO();
  return rows.find((r) => r.recorded_on === t);
}
