import { supabase } from './supabase';
import { normalizeExerciseName } from './normalizeExerciseName';
import {
  fromKgFor,
  toKgFor,
  getLiftWeightUnit,
  type MachineUnit,
} from './units';
import { clearCachedExerciseUnit } from './exercisePrefsApi';

export interface MachineRow {
  normalizedName: string;
  displayName: string;
  bodyPart: string | null;
  unit: MachineUnit;
  setCount: number;
  planRefCount: number;
}

interface PlanExerciseSlim {
  normalized_name: string;
  name: string;
  body_part: string | null;
  training_day_id: string;
}

interface UnitPrefRow {
  normalized_name: string;
  weight_unit: string | null;
  display_name: string | null;
  body_part_override: string | null;
}

async function getUserId(): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  return user.id;
}

function pickUnit(raw: string | null | undefined, fallback: MachineUnit): MachineUnit {
  return raw === 'kg' || raw === 'lb' || raw === 'pin' ? raw : fallback;
}

function pickBodyPart(rows: PlanExerciseSlim[]): string | null {
  const tally = new Map<string, number>();
  for (const r of rows) {
    if (!r.body_part) continue;
    tally.set(r.body_part, (tally.get(r.body_part) ?? 0) + 1);
  }
  let best: { bp: string; n: number } | null = null;
  for (const [bp, n] of tally) {
    if (!best || n > best.n) best = { bp, n };
  }
  return best?.bp ?? null;
}

export async function listMachines(): Promise<MachineRow[]> {
  const userId = await getUserId();
  const globalFallback: MachineUnit = getLiftWeightUnit();

  // plan_exercises are not user-scoped directly — they belong to a training
  // day, which belongs to a plan, which belongs to a user. The RLS policy on
  // plan_exercises must already permit only the owner's rows for queries to
  // be safe; if not, an explicit join is needed.
  const [peRes, lsRes, prefRes] = await Promise.all([
    supabase
      .from('plan_exercises')
      .select('normalized_name, name, body_part, training_day_id, training_days!inner(plans!inner(user_id))')
      .eq('training_days.plans.user_id', userId),
    supabase
      .from('logged_sets')
      .select('exercise_normalized_name, exercise_display_name')
      .eq('user_id', userId),
    supabase
      .from('exercise_unit_prefs')
      .select('normalized_name, weight_unit, display_name, body_part_override')
      .eq('user_id', userId),
  ]);
  if (peRes.error) throw peRes.error;
  if (lsRes.error) throw lsRes.error;
  if (prefRes.error) throw prefRes.error;

  const planRows = (peRes.data ?? []) as unknown as PlanExerciseSlim[];
  const setRows = (lsRes.data ?? []) as unknown as {
    exercise_normalized_name: string;
    exercise_display_name: string;
  }[];
  const prefRows = (prefRes.data ?? []) as unknown as UnitPrefRow[];

  const grouped = new Map<
    string,
    {
      planRows: PlanExerciseSlim[];
      setCount: number;
      lastSetName: string | null;
      pref: UnitPrefRow | null;
    }
  >();

  function ensure(key: string) {
    let g = grouped.get(key);
    if (!g) {
      g = { planRows: [], setCount: 0, lastSetName: null, pref: null };
      grouped.set(key, g);
    }
    return g;
  }

  for (const r of planRows) {
    if (!r.normalized_name) continue;
    ensure(r.normalized_name).planRows.push(r);
  }
  for (const r of setRows) {
    if (!r.exercise_normalized_name) continue;
    const g = ensure(r.exercise_normalized_name);
    g.setCount += 1;
    if (r.exercise_display_name) g.lastSetName = r.exercise_display_name;
  }
  for (const r of prefRows) {
    if (!r.normalized_name) continue;
    ensure(r.normalized_name).pref = r;
  }

  const out: MachineRow[] = [];
  for (const [normalizedName, g] of grouped) {
    const displayName =
      g.pref?.display_name ??
      g.planRows[0]?.name ??
      g.lastSetName ??
      normalizedName;
    const bodyPart =
      g.pref?.body_part_override ?? pickBodyPart(g.planRows);
    out.push({
      normalizedName,
      displayName,
      bodyPart,
      unit: pickUnit(g.pref?.weight_unit, globalFallback),
      setCount: g.setCount,
      planRefCount: g.planRows.length,
    });
  }
  return out;
}

// Update all references from currentNormalized to newName (fix-typo flow).
// Errors if the destination normalized name collides with an existing machine.
export async function renameMachineInPlace(
  currentNormalized: string,
  newName: string
): Promise<void> {
  const userId = await getUserId();
  const newNormalized = normalizeExerciseName(newName);
  if (!newNormalized) throw new Error('Name cannot be empty');
  if (newNormalized === currentNormalized) {
    // Display-name-only change: just update overrides + plan_exercises name.
    await supabase
      .from('plan_exercises')
      .update({ name: newName })
      .eq('normalized_name', currentNormalized);
    await supabase
      .from('logged_sets')
      .update({ exercise_display_name: newName })
      .eq('user_id', userId)
      .eq('exercise_normalized_name', currentNormalized);
    await upsertPref(userId, currentNormalized, { display_name: newName });
    clearCachedExerciseUnit(currentNormalized);
    return;
  }

  // Guard: destination must not already exist for this user.
  const { data: collide, error: collideErr } = await supabase
    .from('exercise_unit_prefs')
    .select('normalized_name')
    .eq('user_id', userId)
    .eq('normalized_name', newNormalized)
    .maybeSingle();
  if (collideErr) throw collideErr;
  if (collide)
    throw new Error('A machine with that name already exists. Use merge instead.');

  const { error: peErr } = await supabase
    .from('plan_exercises')
    .update({ name: newName, normalized_name: newNormalized })
    .eq('normalized_name', currentNormalized);
  if (peErr) throw peErr;

  const { error: lsErr } = await supabase
    .from('logged_sets')
    .update({
      exercise_display_name: newName,
      exercise_normalized_name: newNormalized,
    })
    .eq('user_id', userId)
    .eq('exercise_normalized_name', currentNormalized);
  if (lsErr) throw lsErr;

  // Move the prefs row (PK changes, so delete + insert).
  const { data: oldPref } = await supabase
    .from('exercise_unit_prefs')
    .select('weight_unit, display_name, body_part_override')
    .eq('user_id', userId)
    .eq('normalized_name', currentNormalized)
    .maybeSingle();
  await supabase
    .from('exercise_unit_prefs')
    .delete()
    .eq('user_id', userId)
    .eq('normalized_name', currentNormalized);
  await supabase.from('exercise_unit_prefs').insert({
    user_id: userId,
    normalized_name: newNormalized,
    weight_unit: oldPref?.weight_unit ?? getLiftWeightUnit(),
    display_name: newName,
    body_part_override: oldPref?.body_part_override ?? null,
    updated_at: new Date().toISOString(),
  });

  clearCachedExerciseUnit(currentNormalized);
  clearCachedExerciseUnit(newNormalized);
}

// Insert an empty machine row at newName. Original machine + history are
// untouched — this is the "I want this name to be a new machine going forward"
// flow.
export async function forkMachineToNew(
  currentNormalized: string,
  newName: string
): Promise<void> {
  const userId = await getUserId();
  const newNormalized = normalizeExerciseName(newName);
  if (!newNormalized) throw new Error('Name cannot be empty');
  if (newNormalized === currentNormalized)
    throw new Error('Pick a different name for the new machine.');

  const { data: existing } = await supabase
    .from('exercise_unit_prefs')
    .select('normalized_name')
    .eq('user_id', userId)
    .eq('normalized_name', newNormalized)
    .maybeSingle();
  if (existing) throw new Error('A machine with that name already exists.');

  const { data: source } = await supabase
    .from('exercise_unit_prefs')
    .select('weight_unit, body_part_override')
    .eq('user_id', userId)
    .eq('normalized_name', currentNormalized)
    .maybeSingle();

  const inheritedUnit = pickUnit(source?.weight_unit, getLiftWeightUnit());

  const { error } = await supabase.from('exercise_unit_prefs').insert({
    user_id: userId,
    normalized_name: newNormalized,
    weight_unit: inheritedUnit,
    display_name: newName,
    body_part_override: source?.body_part_override ?? null,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

// Cascade delete: history (logged_sets) -> plan refs (plan_exercises) -> prefs.
export async function deleteMachine(normalizedName: string): Promise<void> {
  const userId = await getUserId();

  const { error: lsErr } = await supabase
    .from('logged_sets')
    .delete()
    .eq('user_id', userId)
    .eq('exercise_normalized_name', normalizedName);
  if (lsErr) throw lsErr;

  // plan_exercises rows are scoped via the plan -> user_id chain in RLS, so
  // a direct delete only affects this user's rows.
  const { error: peErr } = await supabase
    .from('plan_exercises')
    .delete()
    .eq('normalized_name', normalizedName);
  if (peErr) throw peErr;

  const { error: prErr } = await supabase
    .from('exercise_unit_prefs')
    .delete()
    .eq('user_id', userId)
    .eq('normalized_name', normalizedName);
  if (prErr) throw prErr;

  clearCachedExerciseUnit(normalizedName);
}

// Move all logged_sets + plan_exercises for each loser to the survivor's
// normalized_name + display name; drop loser prefs rows.
//
// Plan-exercise dedupe: if a loser plan_exercise sits on the same training_day
// as an existing survivor plan_exercise, delete the loser row instead of
// renaming it (otherwise DayView would show duplicates).
export async function mergeMachines(
  survivorNormalized: string,
  loserNormalizeds: string[]
): Promise<void> {
  if (loserNormalizeds.length === 0) return;
  const userId = await getUserId();

  // Resolve the survivor's display name (override > plan name > normalized).
  const survivorDisplay = await resolveDisplayName(userId, survivorNormalized);

  // Pre-fetch survivor's plan_exercises so we know which training_day_ids
  // already host the survivor (for dedupe).
  const { data: survivorPlanRows, error: survPeErr } = await supabase
    .from('plan_exercises')
    .select('training_day_id, training_days!inner(plans!inner(user_id))')
    .eq('normalized_name', survivorNormalized)
    .eq('training_days.plans.user_id', userId);
  if (survPeErr) throw survPeErr;
  const survivorTrainingDays = new Set(
    ((survivorPlanRows ?? []) as unknown as { training_day_id: string }[]).map(
      (r) => r.training_day_id
    )
  );

  for (const loser of loserNormalizeds) {
    if (loser === survivorNormalized) continue;

    // Re-point logged_sets.
    const { error: lsErr } = await supabase
      .from('logged_sets')
      .update({
        exercise_display_name: survivorDisplay,
        exercise_normalized_name: survivorNormalized,
      })
      .eq('user_id', userId)
      .eq('exercise_normalized_name', loser);
    if (lsErr) throw lsErr;

    // Handle plan_exercises with dedupe.
    const { data: loserPlanRows, error: loserPeErr } = await supabase
      .from('plan_exercises')
      .select('id, training_day_id, training_days!inner(plans!inner(user_id))')
      .eq('normalized_name', loser)
      .eq('training_days.plans.user_id', userId);
    if (loserPeErr) throw loserPeErr;
    const rows = (loserPlanRows ?? []) as unknown as {
      id: string;
      training_day_id: string;
    }[];
    const toDelete: string[] = [];
    const toRename: string[] = [];
    for (const r of rows) {
      if (survivorTrainingDays.has(r.training_day_id)) toDelete.push(r.id);
      else {
        toRename.push(r.id);
        survivorTrainingDays.add(r.training_day_id);
      }
    }
    if (toDelete.length > 0) {
      const { error } = await supabase.from('plan_exercises').delete().in('id', toDelete);
      if (error) throw error;
    }
    if (toRename.length > 0) {
      const { error } = await supabase
        .from('plan_exercises')
        .update({ name: survivorDisplay, normalized_name: survivorNormalized })
        .in('id', toRename);
      if (error) throw error;
    }

    // Drop the loser's prefs row.
    await supabase
      .from('exercise_unit_prefs')
      .delete()
      .eq('user_id', userId)
      .eq('normalized_name', loser);

    clearCachedExerciseUnit(loser);
  }

  // Make sure the survivor's prefs row reflects the survivor display name so
  // future renames stay consistent.
  await upsertPref(userId, survivorNormalized, { display_name: survivorDisplay });
  clearCachedExerciseUnit(survivorNormalized);
}

export async function setMachineBodyPart(
  normalizedName: string,
  bodyPart: string | null
): Promise<void> {
  const userId = await getUserId();
  await upsertPref(userId, normalizedName, { body_part_override: bodyPart });
}

// 'convert' = stored kg unchanged; same physical weight, new label.
// 'preserve' = rewrite stored kg so the displayed number under the new unit
// equals the displayed number under the old unit (destructive).
export async function changeMachineUnitInPlace(
  normalizedName: string,
  newUnit: MachineUnit,
  mode: 'convert' | 'preserve'
): Promise<void> {
  const userId = await getUserId();
  const { data: prefRow } = await supabase
    .from('exercise_unit_prefs')
    .select('weight_unit')
    .eq('user_id', userId)
    .eq('normalized_name', normalizedName)
    .maybeSingle();
  const oldUnit = pickUnit(prefRow?.weight_unit, getLiftWeightUnit());

  if (mode === 'preserve' && oldUnit !== newUnit) {
    const { data: setRows, error: lsErr } = await supabase
      .from('logged_sets')
      .select('id, weight')
      .eq('user_id', userId)
      .eq('exercise_normalized_name', normalizedName)
      .not('weight', 'is', null);
    if (lsErr) throw lsErr;
    const rows = (setRows ?? []) as { id: string; weight: number }[];
    for (const r of rows) {
      const displayedAsOld = fromKgFor(r.weight, oldUnit);
      const rewrittenKg = toKgFor(displayedAsOld, newUnit);
      const { error: updErr } = await supabase
        .from('logged_sets')
        .update({ weight: rewrittenKg })
        .eq('id', r.id);
      if (updErr) throw updErr;
    }
  }

  await upsertPref(userId, normalizedName, { weight_unit: newUnit });
  clearCachedExerciseUnit(normalizedName);
}

// Insert a new empty machine with the chosen unit; original is unchanged.
export async function forkMachineForNewUnit(
  currentNormalized: string,
  newName: string,
  newUnit: MachineUnit
): Promise<void> {
  const userId = await getUserId();
  const newNormalized = normalizeExerciseName(newName);
  if (!newNormalized) throw new Error('Name cannot be empty');
  if (newNormalized === currentNormalized)
    throw new Error('Pick a different name for the new machine.');

  const { data: existing } = await supabase
    .from('exercise_unit_prefs')
    .select('normalized_name')
    .eq('user_id', userId)
    .eq('normalized_name', newNormalized)
    .maybeSingle();
  if (existing) throw new Error('A machine with that name already exists.');

  const { data: source } = await supabase
    .from('exercise_unit_prefs')
    .select('body_part_override')
    .eq('user_id', userId)
    .eq('normalized_name', currentNormalized)
    .maybeSingle();

  const { error } = await supabase.from('exercise_unit_prefs').insert({
    user_id: userId,
    normalized_name: newNormalized,
    weight_unit: newUnit,
    display_name: newName,
    body_part_override: source?.body_part_override ?? null,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

async function upsertPref(
  userId: string,
  normalizedName: string,
  patch: Partial<{
    weight_unit: MachineUnit;
    display_name: string | null;
    body_part_override: string | null;
  }>
): Promise<void> {
  const { data: existing } = await supabase
    .from('exercise_unit_prefs')
    .select('weight_unit, display_name, body_part_override')
    .eq('user_id', userId)
    .eq('normalized_name', normalizedName)
    .maybeSingle();
  const next = {
    user_id: userId,
    normalized_name: normalizedName,
    weight_unit:
      patch.weight_unit ?? pickUnit(existing?.weight_unit, getLiftWeightUnit()),
    display_name:
      patch.display_name !== undefined
        ? patch.display_name
        : existing?.display_name ?? null,
    body_part_override:
      patch.body_part_override !== undefined
        ? patch.body_part_override
        : existing?.body_part_override ?? null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from('exercise_unit_prefs')
    .upsert(next, { onConflict: 'user_id,normalized_name' });
  if (error) throw error;
}

async function resolveDisplayName(
  userId: string,
  normalizedName: string
): Promise<string> {
  const { data: pref } = await supabase
    .from('exercise_unit_prefs')
    .select('display_name')
    .eq('user_id', userId)
    .eq('normalized_name', normalizedName)
    .maybeSingle();
  if (pref?.display_name) return pref.display_name;
  const { data: pe } = await supabase
    .from('plan_exercises')
    .select('name, training_days!inner(plans!inner(user_id))')
    .eq('normalized_name', normalizedName)
    .eq('training_days.plans.user_id', userId)
    .limit(1)
    .maybeSingle();
  if (pe?.name) return pe.name as string;
  const { data: ls } = await supabase
    .from('logged_sets')
    .select('exercise_display_name')
    .eq('user_id', userId)
    .eq('exercise_normalized_name', normalizedName)
    .limit(1)
    .maybeSingle();
  return (ls?.exercise_display_name as string) ?? normalizedName;
}
