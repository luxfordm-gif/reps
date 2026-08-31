import { supabase, currentUserId, currentUserIdSync } from './supabase';
import { isOfflineError, query } from './offline/net';
import { enqueue } from './offline/outbox';
import { dropCache, readCache, writeCache } from './offline/storage';
import type { ParsedPlan } from './parseTrainingPlan';
import type { SetScheme } from './parseTrainingPlan';
import { restSecondsForExercises } from './restDefaults';

const ACTIVE_PLAN_CACHE = 'activePlan';

export interface PlanRow {
  id: string;
  name: string;
  uploaded_at: string;
  is_active: boolean;
  raw_text: string | null;
  activated_at: string | null;
  // Which week of the rotation you're currently on, and when that week began.
  // Null on plans that don't rotate.
  rotation_week: number | null;
  rotation_started_at: string | null;
}

export interface TrainingDayRow {
  id: string;
  plan_id: string;
  name: string;
  position: number;
  // Which week of a rotating plan this day belongs to; null runs every week.
  week_index: number | null;
  // Listed for reference rather than logged — a workout done at home.
  reference_only: boolean;
}

export interface PlanExerciseRow {
  id: string;
  training_day_id: string;
  body_part: string | null;
  name: string;
  normalized_name: string;
  total_sets: number | null;
  rep_range: string;
  tempo: string | null;
  notes: string | null;
  set_scheme: string;
  superset_group: number | null;
  position: number;
  rest_seconds: number | null;
  baseline_reset_at: string | null;
  personal_notes: string | null;
}

/**
 * Patch one plan-exercise row, tolerating no signal.
 *
 * Rest preferences, coach notes and personal cues all get edited mid-workout,
 * which is exactly when the phone is least likely to have a connection. The
 * edit is applied to the cached plan straight away and queued for the server.
 */
async function patchPlanExercise(
  exerciseId: string,
  patch: Record<string, unknown>
): Promise<void> {
  try {
    await query(
      supabase.from('plan_exercises').update(patch).eq('id', exerciseId).select('id'),
      { label: 'patchPlanExercise' }
    );
    patchCachedPlanExercise(exerciseId, patch);
  } catch (e) {
    if (!isOfflineError(e)) throw e;
    const userId = await currentUserId();
    if (!userId) throw e;
    patchCachedPlanExercise(exerciseId, patch, userId);
    enqueue(userId, { kind: 'update_row', table: 'plan_exercises', id: exerciseId, patch });
  }
}

/** Keep the offline copy of the plan in step with an edit we just made. */
function patchCachedPlanExercise(
  exerciseId: string,
  patch: Record<string, unknown>,
  userId?: string | null
): void {
  const id = userId ?? currentUserIdSync();
  const plan = getCachedActivePlan(id);
  if (!plan) return;
  let touched = false;
  for (const day of plan.training_days ?? []) {
    for (let i = 0; i < (day.plan_exercises ?? []).length; i++) {
      if (day.plan_exercises[i].id === exerciseId) {
        day.plan_exercises[i] = { ...day.plan_exercises[i], ...patch };
        touched = true;
      }
    }
  }
  if (touched) writeCache(id, ACTIVE_PLAN_CACHE, plan);
}

export async function updatePlanExerciseRest(
  exerciseId: string,
  restSeconds: number
): Promise<void> {
  await patchPlanExercise(exerciseId, { rest_seconds: restSeconds });
}

export async function updatePlanExerciseNotes(
  exerciseId: string,
  notes: string | null,
  setScheme: SetScheme
): Promise<void> {
  await patchPlanExercise(exerciseId, { notes, set_scheme: setScheme });
}

export async function updatePlanExercisePersonalNote(
  exerciseId: string,
  note: string | null
): Promise<void> {
  await patchPlanExercise(exerciseId, { personal_notes: note });
}

/**
 * Forget a machine's warmed "last time" weights.
 *
 * Named here rather than imported from `sessionsApi` (which imports this
 * module) — it must match `lastSetsCacheName` there.
 */
function dropWarmedWeights(userId: string | null, normalizedName: string): void {
  dropCache(userId, `lastSets.${normalizedName}`);
}

/** The normalized name a slot currently has, from the cached plan. */
function cachedNormalizedName(userId: string | null, exerciseId: string): string | null {
  const plan = getCachedActivePlan(userId);
  for (const day of plan?.training_days ?? []) {
    for (const ex of day.plan_exercises ?? []) {
      if (ex.id === exerciseId) return ex.normalized_name;
    }
  }
  return null;
}

export async function mergeExerciseIntoIdentity(
  exerciseId: string,
  targetName: string,
  targetNormalizedName: string
): Promise<void> {
  const { error: peError } = await supabase
    .from('plan_exercises')
    .update({ name: targetName, normalized_name: targetNormalizedName })
    .eq('id', exerciseId);
  if (peError) throw peError;
  const { error: lsError } = await supabase
    .from('logged_sets')
    .update({
      exercise_display_name: targetName,
      exercise_normalized_name: targetNormalizedName,
    })
    .eq('plan_exercise_id', exerciseId);
  if (lsError) throw lsError;
  // History just moved from one name to the other, so both warmed copies are
  // wrong now. The next warm rebuilds the target's.
  const userId = currentUserIdSync();
  const previous = cachedNormalizedName(userId, exerciseId);
  if (previous && previous !== targetNormalizedName) dropWarmedWeights(userId, previous);
  dropWarmedWeights(userId, targetNormalizedName);
}

// Swap this one plan_exercise slot to a different machine identity (name +
// normalized_name) without moving the old machine's logged_sets — those stay
// attached to their original normalized_name in history. baseline_reset_at is
// set explicitly: a brand-new exercise resets to now (fresh start); swapping to
// an existing machine clears it so that machine's full history shows in prefill.
export async function swapPlanExerciseIdentity(
  exerciseId: string,
  name: string,
  normalizedName: string,
  options: { resetBaseline: boolean }
): Promise<string | null> {
  const update = {
    name,
    normalized_name: normalizedName,
    baseline_reset_at: options.resetBaseline ? new Date().toISOString() : null,
  };
  try {
    const data = await query(
      supabase
        .from('plan_exercises')
        .update(update)
        .eq('id', exerciseId)
        .select('baseline_reset_at')
        .single(),
      { label: 'swapPlanExerciseIdentity' }
    );
    patchCachedPlanExercise(exerciseId, update);
    if (options.resetBaseline) {
      // A fresh start on a new machine: last time's weights no longer apply.
      dropWarmedWeights(currentUserIdSync(), normalizedName);
    }
    return (data?.baseline_reset_at as string | null) ?? null;
  } catch (e) {
    if (!isOfflineError(e)) throw e;
    // Swapping to a free machine is a gym-floor decision — it can't need signal.
    const userId = await currentUserId();
    if (!userId) throw e;
    patchCachedPlanExercise(exerciseId, update, userId);
    enqueue(userId, {
      kind: 'update_row',
      table: 'plan_exercises',
      id: exerciseId,
      patch: update,
    });
    return update.baseline_reset_at;
  }
}

export async function updatePlanExerciseName(
  exerciseId: string,
  name: string,
  options: { resetBaseline: boolean }
): Promise<string | null> {
  const update: { name: string; baseline_reset_at?: string } = { name };
  if (options.resetBaseline) {
    update.baseline_reset_at = new Date().toISOString();
  }
  const { data, error } = await supabase
    .from('plan_exercises')
    .update(update)
    .eq('id', exerciseId)
    .select('baseline_reset_at')
    .single();
  if (error) throw error;
  return (data?.baseline_reset_at as string | null) ?? null;
}

// Persist a new exercise order after the user drags exercises up/down within a
// body-part group. Each row keeps its slot's original position value (so the
// group stays contiguous and other groups aren't disturbed) but points at a
// different exercise. Because a changed order means the user may now be
// stronger or weaker on that body part, every affected exercise's
// baseline_reset_at is bumped to now so the logger prefill falls back to base
// weight/reps instead of carrying over the old order's numbers. Returns the
// reset timestamp so callers can update their in-memory copy.
export async function reorderPlanExercises(
  updates: { id: string; position: number }[]
): Promise<string> {
  const now = new Date().toISOString();
  for (const u of updates) {
    const { error } = await supabase
      .from('plan_exercises')
      .update({ position: u.position, baseline_reset_at: now })
      .eq('id', u.id);
    if (error) throw error;
  }
  return now;
}

export interface FullPlan extends PlanRow {
  training_days: (TrainingDayRow & { plan_exercises: PlanExerciseRow[] })[];
}

export async function savePlan(
  parsed: ParsedPlan,
  name: string,
  rawText: string,
  // Keys ("<dayPosition>:<exercisePosition>") of exercises whose logged history
  // should be reset to zero on this upload. A new plan starts every carried-over
  // machine fresh by default; only the ones the user chose to keep are omitted here.
  // baseline_reset_at cuts the workout prefill off at upload time (see
  // getLastSessionSetsForExercise) without deleting past logged_sets.
  options?: { historyResetKeys?: ReadonlySet<string> }
): Promise<PlanRow> {
  const userId = await currentUserId();
  if (!userId) throw new Error('Not signed in');

  // Deactivate any existing plans (keep them in the library)
  await supabase.from('plans').update({ is_active: false }).eq('user_id', userId);

  const nowIso = new Date().toISOString();
  // A rotating plan starts on its lowest week; one without a rotation stays null
  // and the Home screen shows every day as it always has.
  const weeks = rotationWeeks(parsed);
  const { data: plan, error: planErr } = await supabase
    .from('plans')
    .insert({
      user_id: userId,
      name,
      raw_text: rawText,
      is_active: true,
      activated_at: nowIso,
      rotation_week: weeks[0] ?? null,
      rotation_started_at: weeks.length > 0 ? nowIso : null,
    })
    .select()
    .single();
  if (planErr) throw planErr;

  for (const day of parsed.days) {
    const { data: td, error: tdErr } = await supabase
      .from('training_days')
      .insert({
        plan_id: plan.id,
        user_id: userId,
        name: day.name,
        position: day.position,
        week_index: day.weekIndex ?? null,
        reference_only: day.referenceOnly,
      })
      .select()
      .single();
    if (tdErr) throw tdErr;

    if (day.exercises.length > 0) {
      // Rest comes from the plan itself — drop sets run straight through, heavy
      // compounds get longer, and an explicit rest in the coach's notes wins.
      // Leaving it null (as we used to) meant every exercise fell back to
      // whatever rest was last picked anywhere in the app.
      const restByIndex = restSecondsForExercises(
        day.exercises.map((e) => ({
          name: e.name,
          notes: e.notes,
          setScheme: e.setScheme,
          supersetGroup: e.supersetGroup ?? null,
        }))
      );
      const rows = day.exercises.map((e, i) => ({
        training_day_id: td.id,
        user_id: userId,
        body_part: e.bodyPart,
        name: e.name,
        normalized_name: e.normalizedName,
        total_sets: e.totalSets,
        rep_range: e.repRange,
        tempo: e.tempo,
        notes: e.notes,
        set_scheme: e.setScheme,
        superset_group: e.supersetGroup ?? null,
        rest_seconds: restByIndex[i],
        position: e.position,
        baseline_reset_at: options?.historyResetKeys?.has(
          `${day.position}:${e.position}`
        )
          ? nowIso
          : null,
      }));
      const { data: insertedExercises, error: exErr } = await supabase
        .from('plan_exercises')
        .insert(rows)
        .select('id, position');
      if (exErr) throw exErr;

      // Persist any "alternate weeks with X" partners the user confirmed on the
      // review screen as weekly-rotation alternatives on their slot. Map inserted
      // ids back by position (unique within a day) since insert order isn't
      // guaranteed. Failures here are non-fatal — the plan still saves; the
      // rotation hint just won't be available.
      const idByPosition = new Map<number, string>();
      for (const r of (insertedExercises as { id: string; position: number }[]) ?? []) {
        idByPosition.set(r.position, r.id);
      }
      const altRows = day.exercises
        .filter((e) => e.weeklyAlternative && idByPosition.has(e.position))
        .map((e) => ({
          user_id: userId,
          plan_exercise_id: idByPosition.get(e.position)!,
          name: e.weeklyAlternative!.name,
          normalized_name: e.weeklyAlternative!.normalizedName,
          position: 0,
          is_weekly_rotation: true,
        }));
      if (altRows.length > 0) {
        const { error: altErr } = await supabase
          .from('plan_exercise_alternatives')
          .insert(altRows);
        if (altErr) {
          console.error('Failed to save weekly-rotation alternatives', altErr);
        }
      }
    }
  }

  return plan as PlanRow;
}

/**
 * The last plan we successfully fetched, straight off the device.
 *
 * This is the copy the app trains from when there's no signal — the whole
 * workout (days, exercises, sets, reps, tempo, coach notes) is in here.
 */
export function getCachedActivePlan(userId?: string | null): FullPlan | null {
  return readCache<FullPlan>(userId ?? currentUserIdSync(), ACTIVE_PLAN_CACHE);
}

export async function getActivePlan(): Promise<FullPlan | null> {
  const userId = await currentUserId();
  if (!userId) return null;

  // Home waits on this one, so when the device already has a copy of the plan
  // we give the network a short leash and fall back rather than making someone
  // stare at a spinner on one bar of signal.
  const cachedPlan = getCachedActivePlan(userId);
  let data;
  try {
    data = await query(
      supabase
        .from('plans')
        .select('*, training_days(*, plan_exercises(*))')
        .eq('user_id', userId)
        .eq('is_active', true)
        .order('uploaded_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      { label: 'getActivePlan', timeoutMs: cachedPlan ? 3500 : 12000 }
    );
  } catch (e) {
    if (!isOfflineError(e)) throw e;
    return cachedPlan;
  }
  if (!data) return null;

  data.training_days?.sort((a: TrainingDayRow, b: TrainingDayRow) => a.position - b.position);
  for (const td of data.training_days ?? []) {
    td.plan_exercises?.sort(
      (a: PlanExerciseRow, b: PlanExerciseRow) => a.position - b.position
    );
  }
  writeCache(userId, ACTIVE_PLAN_CACHE, data);
  return data as FullPlan;
}

export interface PlanSummary extends PlanRow {
  day_count: number;
}

export async function listPlans(): Promise<PlanSummary[]> {
  const userId = await currentUserId();
  if (!userId) return [];

  const { data, error } = await supabase
    .from('plans')
    .select('*, training_days(id)')
    .eq('user_id', userId)
    .order('is_active', { ascending: false })
    .order('uploaded_at', { ascending: false });
  if (error) throw error;
  type Row = PlanRow & { training_days: { id: string }[] | null };
  return ((data as Row[]) ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    uploaded_at: r.uploaded_at,
    is_active: r.is_active,
    rotation_week: r.rotation_week,
    rotation_started_at: r.rotation_started_at,
    raw_text: r.raw_text,
    activated_at: r.activated_at,
    day_count: r.training_days?.length ?? 0,
  }));
}

export async function getPlanDetail(planId: string): Promise<FullPlan | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  const { data, error } = await supabase
    .from('plans')
    .select('*, training_days(*, plan_exercises(*))')
    .eq('user_id', userId)
    .eq('id', planId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  data.training_days?.sort((a: TrainingDayRow, b: TrainingDayRow) => a.position - b.position);
  for (const td of data.training_days ?? []) {
    td.plan_exercises?.sort(
      (a: PlanExerciseRow, b: PlanExerciseRow) => a.position - b.position
    );
  }
  return data as FullPlan;
}

export async function renamePlan(planId: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Plan name cannot be empty');
  if (trimmed.length > 80) throw new Error('Plan name is too long (max 80 chars)');
  const { error } = await supabase.from('plans').update({ name: trimmed }).eq('id', planId);
  if (error) throw error;
}

export async function activatePlan(
  planId: string,
  mode: 'resume' | 'restart'
): Promise<void> {
  const userId = await currentUserId();
  if (!userId) throw new Error('Not signed in');

  // Deactivate everything else first.
  const { error: deErr } = await supabase
    .from('plans')
    .update({ is_active: false })
    .eq('user_id', userId);
  if (deErr) throw deErr;

  const update: { is_active: boolean; activated_at?: string } = { is_active: true };
  if (mode === 'restart') {
    update.activated_at = new Date().toISOString();
  } else {
    // Resume: only set activated_at if it's currently null (e.g. a plan that
    // was uploaded but never explicitly activated yet).
    const { data: existing } = await supabase
      .from('plans')
      .select('activated_at')
      .eq('id', planId)
      .maybeSingle();
    if (!existing?.activated_at) {
      update.activated_at = new Date().toISOString();
    }
  }

  const { error } = await supabase.from('plans').update(update).eq('id', planId);
  if (error) throw error;
}

// Week 1 starts on activation day. Day 0..6 = Week 1, day 7..13 = Week 2, etc.
export function weeksOnPlan(activatedAt: string | null): number {
  if (!activatedAt) return 1;
  const ms = Date.now() - new Date(activatedAt).getTime();
  if (ms < 0) return 1;
  return Math.floor(ms / (7 * 24 * 60 * 60 * 1000)) + 1;
}

/** The distinct rotation weeks a parsed plan uses, ascending. Empty if it doesn't rotate. */
export function rotationWeeks(parsed: ParsedPlan): number[] {
  const weeks = new Set<number>();
  for (const day of parsed.days) {
    if (day.weekIndex != null) weeks.add(day.weekIndex);
  }
  return [...weeks].sort((a, b) => a - b);
}

/** The same, from a saved plan. */
export function planRotationWeeks(plan: FullPlan | null): number[] {
  const weeks = new Set<number>();
  for (const day of plan?.training_days ?? []) {
    if (day.week_index != null) weeks.add(day.week_index);
  }
  return [...weeks].sort((a, b) => a - b);
}

/**
 * The days to show for a given rotation week: that week's days, plus everything
 * that runs every week. A plan with no rotation returns all of its days.
 */
export function daysForRotationWeek(
  plan: FullPlan | null,
  week: number | null
): FullPlan['training_days'] {
  const days = plan?.training_days ?? [];
  if (week == null) return days;
  return days.filter((d) => d.week_index == null || d.week_index === week);
}

/** The week after this one, wrapping back to the first. */
export function nextRotationWeek(weeks: number[], current: number | null): number | null {
  if (weeks.length === 0) return null;
  const idx = current == null ? -1 : weeks.indexOf(current);
  return weeks[(idx + 1) % weeks.length];
}

/** Move the plan onto a rotation week, restarting the "days done this week" clock. */
export async function setRotationWeek(planId: string, week: number): Promise<string> {
  const startedAt = new Date().toISOString();
  const update = { rotation_week: week, rotation_started_at: startedAt };
  try {
    await query(supabase.from('plans').update(update).eq('id', planId).select('id'), {
      label: 'setRotationWeek',
    });
  } catch (e) {
    if (!isOfflineError(e)) throw e;
    const userId = await currentUserId();
    if (!userId) throw e;
    enqueue(userId, { kind: 'update_row', table: 'plans', id: planId, patch: update });
  }
  // Keep the cached plan in step so Home doesn't flip back on the next render.
  const userId = currentUserIdSync();
  const cached = getCachedActivePlan(userId);
  if (cached && cached.id === planId) {
    writeCache(userId, ACTIVE_PLAN_CACHE, { ...cached, ...update });
  }
  return startedAt;
}

/**
 * Training-day ids with a completed session since `sinceIso`.
 *
 * Queried here rather than imported from `sessionsApi` (which imports this
 * module) — same reason as dropWarmedWeights above. Returns an empty set rather
 * than throwing: a rotation that fails to advance is far less disruptive than a
 * Home screen that won't render.
 */
async function completedTrainingDayIdsSince(sinceIso: string): Promise<Set<string>> {
  const userId = await currentUserId();
  if (!userId) return new Set();
  try {
    const data = await query(
      supabase
        .from('sessions')
        .select('training_day_id')
        .eq('user_id', userId)
        .not('completed_at', 'is', null)
        .gte('completed_at', sinceIso),
      { label: 'completedTrainingDayIdsSince' }
    );
    const rows = (data as { training_day_id: string | null }[]) ?? [];
    return new Set(rows.map((r) => r.training_day_id).filter((id): id is string => !!id));
  } catch {
    return new Set();
  }
}

/**
 * Move a rotating plan on if its current week is done.
 *
 * "Done" means every gym day of the current week has been trained since the week
 * began — days that run every week (the home abs workout) don't hold the
 * rotation up, since they're not part of it. Called after finishing a workout;
 * a no-op for plans that don't rotate. Returns the week now showing.
 */
export async function advanceRotationIfWeekComplete(): Promise<number | null> {
  // Read through the cache — this runs right after a workout, when signal is
  // whatever the gym gives you.
  const plan = getCachedActivePlan(currentUserIdSync()) ?? (await getActivePlan());
  const weeks = planRotationWeeks(plan);
  if (!plan || weeks.length < 2 || plan.rotation_week == null) return plan?.rotation_week ?? null;
  const since = plan.rotation_started_at ?? plan.activated_at;
  if (!since) return plan.rotation_week;

  const thisWeeksDays = (plan.training_days ?? []).filter(
    (d) => d.week_index === plan.rotation_week
  );
  if (thisWeeksDays.length === 0) return plan.rotation_week;

  const done = await completedTrainingDayIdsSince(since);
  if (!thisWeeksDays.every((d) => done.has(d.id))) return plan.rotation_week;

  const next = nextRotationWeek(weeks, plan.rotation_week);
  if (next == null || next === plan.rotation_week) return plan.rotation_week;
  await setRotationWeek(plan.id, next);
  return next;
}
