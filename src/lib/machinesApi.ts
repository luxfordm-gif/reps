import { supabase, currentUserId } from './supabase';
import { normalizeExerciseName } from './normalizeExerciseName';
import {
  fromKgFor,
  toKgFor,
  getLiftWeightUnit,
  type MachineUnit,
} from './units';
import { clearCachedExerciseUnit } from './exercisePrefsApi';
import { dropLastSetsCache } from './sessionsApi';
import { renameQueuedExercise } from './offline/outbox';

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
  const userId = await currentUserId();
  if (!userId) throw new Error('Not signed in');
  return userId;
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

  // plan_exercises carries user_id and is reachable through its training day's
  // plan. The join is the stricter of the two, so it stays: it holds even for a
  // row written before the column existed.
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
      .eq('user_id', userId)
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
    .eq('user_id', userId)
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

  // A normalized name is just the lowercased exercise name, so it is shared
  // across accounts: "lat pulldown" is the same string for everyone. RLS is
  // what stops this reaching another user's rows, but an unqualified delete on
  // a shared key is the wrong shape to leave lying around — plan_exercises
  // carries user_id (savePlan writes it), so say so.
  const { error: peErr } = await supabase
    .from('plan_exercises')
    .delete()
    .eq('user_id', userId)
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

/** Everything a merge is about to do, for the confirm step to show. */
export interface MergePreview {
  survivorNormalized: string;
  survivorDisplay: string;
  /** Losers whose unit differs from the survivor's — the ones worth asking about. */
  unitMismatches: { normalizedName: string; unit: MachineUnit }[];
  survivorUnit: MachineUnit;
}

/**
 * What merging these machines would mean, before doing it.
 *
 * Only the unit needs a decision. Sets and plan references move whatever
 * happens, and the modal already counts those; a unit is the one thing where
 * moving a row silently changes what it says. A machine logged in pin
 * positions merged into one logged in kilograms has every number reinterpreted
 * as a weight, which is the same question changeMachineUnitInPlace asks.
 */
export async function previewMerge(
  survivorNormalized: string,
  loserNormalizeds: string[],
): Promise<MergePreview> {
  const userId = await getUserId();
  const names = [survivorNormalized, ...loserNormalizeds];
  const { data, error } = await supabase
    .from('exercise_unit_prefs')
    .select('normalized_name, weight_unit')
    .eq('user_id', userId)
    .in('normalized_name', names);
  if (error) throw error;
  const global = getLiftWeightUnit();
  const unitFor = new Map(
    ((data ?? []) as { normalized_name: string; weight_unit: string | null }[]).map((r) => [
      r.normalized_name,
      pickUnit(r.weight_unit, global),
    ]),
  );
  const survivorUnit = unitFor.get(survivorNormalized) ?? global;
  return {
    survivorNormalized,
    survivorDisplay: await resolveDisplayName(userId, survivorNormalized),
    survivorUnit,
    unitMismatches: loserNormalizeds
      .filter((n) => n !== survivorNormalized)
      .map((n) => ({ normalizedName: n, unit: unitFor.get(n) ?? global }))
      .filter((m) => m.unit !== survivorUnit),
  };
}

/**
 * How a loser's numbers should read once they belong to the survivor.
 *
 * The same choice changeMachineUnitInPlace offers, for the same reason. The
 * stored column is kilograms, but it only means kilograms on a machine whose
 * unit says so.
 *
 *   'convert'  — the stored value was a real weight, so leave it alone and
 *                let it be redisplayed in the survivor's unit.
 *   'preserve' — the number on the screen is what mattered, so rewrite the
 *                stored value to keep it reading the same.
 */
export type MergeUnitMode = 'convert' | 'preserve';

// Move all logged_sets + plan_exercises for each loser to the survivor's
// normalized_name + display name; drop loser prefs rows.
//
// Plan-exercise dedupe: if a loser plan_exercise sits on the same training_day
// as an existing survivor plan_exercise, delete the loser row instead of
// renaming it (otherwise DayView would show duplicates).
export async function mergeMachines(
  survivorNormalized: string,
  loserNormalizeds: string[],
  unitMode: MergeUnitMode = 'convert',
): Promise<void> {
  if (loserNormalizeds.length === 0) return;
  const userId = await getUserId();

  // Resolve the survivor's display name (override > plan name > normalized).
  const survivorDisplay = await resolveDisplayName(userId, survivorNormalized);

  // Units, for the rewrite decision and so the survivor can inherit one.
  const { data: prefRows } = await supabase
    .from('exercise_unit_prefs')
    .select('normalized_name, weight_unit, body_part_override, load_profile, load_positions')
    .eq('user_id', userId)
    .in('normalized_name', [survivorNormalized, ...loserNormalizeds]);
  type PrefSlim = {
    normalized_name: string;
    weight_unit: string | null;
    body_part_override: string | null;
    load_profile: string | null;
    load_positions: number | null;
  };
  const prefs = new Map(
    ((prefRows ?? []) as PrefSlim[]).map((r) => [r.normalized_name, r]),
  );
  const globalUnit = getLiftWeightUnit();
  const survivorPref = prefs.get(survivorNormalized);
  const survivorUnit = pickUnit(survivorPref?.weight_unit, globalUnit);

  // Pre-fetch survivor's plan_exercises so we know which training_day_ids
  // already host the survivor (for dedupe).
  const { data: survivorPlanRows, error: survPeErr } = await supabase
    .from('plan_exercises')
    .select('id, training_day_id, training_days!inner(plans!inner(user_id))')
    .eq('normalized_name', survivorNormalized)
    .eq('training_days.plans.user_id', userId);
  if (survPeErr) throw survPeErr;
  // Which slot the survivor occupies on each training day — the id as well as
  // the day, because a loser slot being dropped has to hand its alternatives
  // to the slot that replaces it.
  const survivorSlotByDay = new Map(
    ((survivorPlanRows ?? []) as unknown as { id: string; training_day_id: string }[]).map(
      (r) => [r.training_day_id, r.id] as const,
    ),
  );

  for (const loser of loserNormalizeds) {
    if (loser === survivorNormalized) continue;
    const loserPref = prefs.get(loser);
    const loserUnit = pickUnit(loserPref?.weight_unit, globalUnit);

    // The loser's stored numbers only meant what they said under the loser's
    // unit. Rewrite them first, while they can still be found by that name.
    if (unitMode === 'preserve' && loserUnit !== survivorUnit) {
      await rewriteStoredWeights(userId, loser, loserUnit, survivorUnit);
    }

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
    const toDelete: { id: string; training_day_id: string }[] = [];
    const toRename: string[] = [];
    for (const r of rows) {
      if (survivorSlotByDay.has(r.training_day_id)) toDelete.push(r);
      else {
        toRename.push(r.id);
        // This row is about to become the survivor's slot on that day.
        survivorSlotByDay.set(r.training_day_id, r.id);
      }
    }
    if (toDelete.length > 0) {
      // Alternatives hang off plan_exercises with on-delete cascade, so a slot
      // about to be deleted has to hand its alternatives over first or they go
      // with it silently — and an alternative list is something the user built
      // by hand. They move to the survivor's slot on the same day.
      await rehomeAlternatives(userId, toDelete, survivorSlotByDay, survivorNormalized);
      const { error } = await supabase
        .from('plan_exercises')
        .delete()
        .in('id', toDelete.map((r) => r.id));
      if (error) throw error;
    }
    if (toRename.length > 0) {
      const { error } = await supabase
        .from('plan_exercises')
        .update({ name: survivorDisplay, normalized_name: survivorNormalized })
        .in('id', toRename);
      if (error) throw error;
    }

    // An alternative pill still pointing at the loser would log new sets under
    // the old name and quietly undo the merge, so they move too.
    const { error: altErr } = await supabase
      .from('plan_exercise_alternatives')
      .update({ name: survivorDisplay, normalized_name: survivorNormalized })
      .eq('user_id', userId)
      .eq('normalized_name', loser);
    if (altErr) throw altErr;

    // And so would a set logged in the gym with no signal.
    renameQueuedExercise(userId, loser, survivorNormalized, survivorDisplay);

    // The survivor takes anything it hasn't got of its own before the loser's
    // row goes. Deleting it outright threw away the unit, the body part and
    // the whole weight profile — and when the survivor had no row at all,
    // upsertPref then invented a unit from the global default.
    const inherited: Record<string, unknown> = {};
    if (loserPref) {
      if (!survivorPref?.weight_unit && loserPref.weight_unit) {
        inherited.weight_unit = loserPref.weight_unit;
      }
      if (!survivorPref?.body_part_override && loserPref.body_part_override) {
        inherited.body_part_override = loserPref.body_part_override;
      }
      if (!survivorPref?.load_profile && loserPref.load_profile) {
        inherited.load_profile = loserPref.load_profile;
        inherited.load_positions = loserPref.load_positions;
      }
    }
    if (Object.keys(inherited).length > 0) {
      const { error } = await supabase
        .from('exercise_unit_prefs')
        .update(inherited)
        .eq('user_id', userId)
        .eq('normalized_name', survivorNormalized);
      // A survivor with no row yet cannot be updated; upsertPref below makes
      // one, and the unit it picks is the survivor's own either way.
      if (error && Object.keys(inherited).length > 0) {
        await upsertPref(userId, survivorNormalized, {
          weight_unit: pickUnit(inherited.weight_unit as string, survivorUnit),
        });
      }
    }

    // Drop the loser's prefs row.
    await supabase
      .from('exercise_unit_prefs')
      .delete()
      .eq('user_id', userId)
      .eq('normalized_name', loser);

    clearCachedExerciseUnit(loser);
    // The loser's warmed "last time" weights describe history that has moved.
    dropLastSetsCache(userId, loser);
  }

  // Make sure the survivor's prefs row reflects the survivor display name so
  // future renames stay consistent.
  await upsertPref(userId, survivorNormalized, { display_name: survivorDisplay });
  clearCachedExerciseUnit(survivorNormalized);
  // The survivor's history just grew, so its warmed copy is stale — and the
  // warm path throttles for ten minutes and treats a stale entry as good, so
  // without this the logger pre-fills from before the merge.
  dropLastSetsCache(userId, survivorNormalized);
}

/**
 * Alternatives whose parent slot is about to be deleted.
 *
 * They cascade with it (0010_exercise_alternatives.sql), which would throw
 * away a swap list the user built by hand without saying so. Each one moves
 * to the survivor's slot on the same training day.
 *
 * Two are dropped rather than moved: one that names the survivor itself,
 * which is what that slot already is, and one whose movement is already an
 * alternative there.
 */
async function rehomeAlternatives(
  userId: string,
  doomed: { id: string; training_day_id: string }[],
  survivorSlotByDay: Map<string, string>,
  survivorNormalized: string,
): Promise<void> {
  const doomedIds = doomed.map((r) => r.id);
  const { data, error } = await supabase
    .from('plan_exercise_alternatives')
    .select('id, plan_exercise_id, normalized_name')
    .eq('user_id', userId)
    .in('plan_exercise_id', doomedIds);
  if (error) throw error;
  const alternatives = (data ?? []) as {
    id: string;
    plan_exercise_id: string;
    normalized_name: string;
  }[];
  if (alternatives.length === 0) return;

  const dayOf = new Map(doomed.map((r) => [r.id, r.training_day_id] as const));
  const destinations = [...new Set(doomed.map((r) => survivorSlotByDay.get(r.training_day_id)))]
    .filter((id): id is string => !!id);

  // What the destination slots already offer, so a move can't duplicate a pill.
  const existing = new Map<string, Set<string>>();
  if (destinations.length > 0) {
    const { data: theirs, error: theirsErr } = await supabase
      .from('plan_exercise_alternatives')
      .select('plan_exercise_id, normalized_name')
      .eq('user_id', userId)
      .in('plan_exercise_id', destinations);
    if (theirsErr) throw theirsErr;
    for (const r of (theirs ?? []) as { plan_exercise_id: string; normalized_name: string }[]) {
      let set = existing.get(r.plan_exercise_id);
      if (!set) {
        set = new Set();
        existing.set(r.plan_exercise_id, set);
      }
      set.add(r.normalized_name);
    }
  }

  const drop: string[] = [];
  const moves = new Map<string, string[]>(); // destination slot → alternative ids
  for (const alt of alternatives) {
    const day = dayOf.get(alt.plan_exercise_id);
    const destination = day ? survivorSlotByDay.get(day) : undefined;
    const already = destination ? existing.get(destination) : undefined;
    if (!destination || alt.normalized_name === survivorNormalized || already?.has(alt.normalized_name)) {
      drop.push(alt.id);
      continue;
    }
    const list = moves.get(destination);
    if (list) list.push(alt.id);
    else moves.set(destination, [alt.id]);
    already?.add(alt.normalized_name);
    if (!already) existing.set(destination, new Set([alt.normalized_name]));
  }

  for (const [destination, ids] of moves) {
    const { error: mvErr } = await supabase
      .from('plan_exercise_alternatives')
      .update({ plan_exercise_id: destination })
      .in('id', ids);
    if (mvErr) throw mvErr;
  }
  if (drop.length > 0) {
    const { error: delErr } = await supabase
      .from('plan_exercise_alternatives')
      .delete()
      .in('id', drop);
    if (delErr) throw delErr;
  }
}

/**
 * Rewrite one exercise's stored weights so they read the same under a new unit.
 *
 * The same arithmetic as changeMachineUnitInPlace's 'preserve', and the same
 * shape of loop — one row at a time, because there is nothing to batch with.
 * position_weights travels with it, which the unit-change path forgets: it is
 * a per-peg breakdown in the same units whose sum is meant to equal `weight`.
 */
async function rewriteStoredWeights(
  userId: string,
  normalizedName: string,
  oldUnit: MachineUnit,
  newUnit: MachineUnit,
): Promise<void> {
  const { data, error } = await supabase
    .from('logged_sets')
    .select('id, weight, position_weights')
    .eq('user_id', userId)
    .eq('exercise_normalized_name', normalizedName)
    .not('weight', 'is', null);
  if (error) throw error;
  const restate = (kg: number) => toKgFor(fromKgFor(kg, oldUnit), newUnit);
  for (const row of (data ?? []) as {
    id: string;
    weight: number | null;
    position_weights: (number | null)[] | null;
  }[]) {
    if (row.weight == null) continue;
    const patch: Record<string, unknown> = { weight: restate(row.weight) };
    if (Array.isArray(row.position_weights)) {
      patch.position_weights = row.position_weights.map((w) =>
        typeof w === 'number' ? restate(w) : w,
      );
    }
    const { error: updErr } = await supabase.from('logged_sets').update(patch).eq('id', row.id);
    if (updErr) throw updErr;
  }
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
