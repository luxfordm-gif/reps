// Everything the coach dashboard reads for one athlete, fetched once.
//
// These run as the coach, against the read-only policies migration 0024 adds,
// so they name the athlete's user id on every query. No offline cache: the
// coach is at a desk, and stale figures would be worse than a retry.

import { supabase } from '../supabase';
import { normaliseCheckIn } from '../checkin';
import { baseDayName } from '../daySlots';
import type { MachineUnit } from '../units';
import type { CoachData, CoachSession, CoachSet } from './coachWeek';

/** How far back the dashboard reads. A year is enough for any trend it draws
 *  and keeps one athlete to a handful of requests. */
const HISTORY_DAYS = 365;
/** PostgREST hands back at most this many rows per request. */
const PAGE = 1000;
/** Stop paging here; past this many sets the oldest just drop off. */
const MAX_ROWS = 10000;

export interface AthletePlan {
  name: string;
  activatedAt: string | null;
}

export interface AthleteData extends CoachData {
  plan: AthletePlan | null;
  /** Machines logged in pin positions show "pin 7", not kilos. */
  machineUnits: Map<string, MachineUnit>;
}

function sinceISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function sinceDay(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Every row a query matches, a page at a time. */
async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data as T[]) ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

type SessionRow = {
  id: string;
  completed_at: string;
  checkin_performance: number | null;
  checkin_energy: number | null;
  checkin_soreness: number | null;
  checkin_sleep: number | null;
  checkin_hunger: number | null;
  checkin_stress: number | null;
  training_days: { name: string } | { name: string }[] | null;
};

type SetRow = {
  session_id: string;
  completed_at: string;
  exercise_display_name: string;
  exercise_normalized_name: string;
  weight: number | string | null;
  reps: number | null;
  plan_exercises: { body_part: string | null } | { body_part: string | null }[] | null;
};

type PlanRow = {
  name: string;
  activated_at: string | null;
  training_days: { name: string; week_index: number | null; reference_only: boolean | null }[] | null;
};

function toSession(r: SessionRow): CoachSession {
  const td = Array.isArray(r.training_days) ? r.training_days[0] : r.training_days;
  return {
    id: r.id,
    completedAt: r.completed_at,
    dayName: td?.name ?? 'Workout',
    checkIn: normaliseCheckIn({
      performance: r.checkin_performance,
      energy: r.checkin_energy,
      soreness: r.checkin_soreness,
      sleep: r.checkin_sleep,
      hunger: r.checkin_hunger,
      stress: r.checkin_stress,
    }),
  };
}

/** The gym days a week on a plan, counted the way Home and Performance count
 *  them: one per day type, leaving out Abs and days kept for reference. */
function planShape(plan: PlanRow | null): {
  weeklyTarget: number;
  rotationWeeks: number;
  referenceDayNames: string[];
} {
  const days = plan?.training_days ?? [];
  const slots = new Map<string, boolean[]>();
  for (const d of days) {
    const name = baseDayName(d.name);
    slots.set(name, [...(slots.get(name) ?? []), d.reference_only === true]);
  }
  const weeklyTarget = [...slots.entries()].filter(
    ([name, refs]) => name !== 'Abs' && !refs.every(Boolean),
  ).length;
  const weeks = new Set(days.map((d) => d.week_index).filter((w) => w != null));
  return {
    weeklyTarget,
    rotationWeeks: weeks.size >= 2 ? weeks.size : 0,
    referenceDayNames: days.filter((d) => d.reference_only).map((d) => d.name),
  };
}

export async function loadAthleteData(athleteId: string): Promise<AthleteData> {
  const since = sinceISO(HISTORY_DAYS);
  const sinceKey = sinceDay(HISTORY_DAYS);

  const [sessionRows, setRows, prefs, plan, weights, water, steps, sleep] = await Promise.all([
    fetchAll<SessionRow>((from, to) =>
      supabase
        .from('sessions')
        .select(
          'id, completed_at, checkin_performance, checkin_energy, checkin_soreness, checkin_sleep, checkin_hunger, checkin_stress, training_days(name)',
        )
        .eq('user_id', athleteId)
        .not('completed_at', 'is', null)
        .gte('completed_at', since)
        .order('completed_at', { ascending: false })
        .range(from, to),
    ),
    fetchAll<SetRow>((from, to) =>
      supabase
        .from('logged_sets')
        .select(
          'session_id, completed_at, exercise_display_name, exercise_normalized_name, weight, reps, plan_exercises(body_part)',
        )
        .eq('user_id', athleteId)
        .gte('completed_at', since)
        .order('completed_at', { ascending: false })
        .range(from, to),
    ),
    supabase
      .from('exercise_unit_prefs')
      .select('normalized_name, weight_unit, body_part_override')
      .eq('user_id', athleteId),
    supabase
      .from('plans')
      .select('name, activated_at, training_days(name, week_index, reference_only)')
      .eq('user_id', athleteId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle(),
    supabase.from('body_weights').select('recorded_on, weight_kg').eq('user_id', athleteId).gte('recorded_on', sinceKey),
    supabase.from('water_logs').select('recorded_on, count').eq('user_id', athleteId).gte('recorded_on', sinceKey),
    supabase.from('step_logs').select('recorded_on, steps').eq('user_id', athleteId).gte('recorded_on', sinceKey),
    supabase.from('sleep_logs').select('recorded_on, hours').eq('user_id', athleteId).gte('recorded_on', sinceKey),
  ]);
  for (const r of [prefs, plan, weights, water, steps]) if (r.error) throw r.error;
  // An athlete whose project hasn't had the sleep migration run yet still loads.
  const sleepRows = sleep.error ? [] : ((sleep.data as { recorded_on: string; hours: number | string }[]) ?? []);

  type Pref = { normalized_name: string; weight_unit: MachineUnit; body_part_override: string | null };
  const prefRows = (prefs.data as Pref[]) ?? [];
  const override = new Map(
    prefRows.filter((p) => p.body_part_override?.trim()).map((p) => [p.normalized_name, p.body_part_override!.trim()]),
  );
  const machineUnits = new Map(prefRows.map((p) => [p.normalized_name, p.weight_unit]));

  const sets: CoachSet[] = setRows.map((r) => {
    const pe = Array.isArray(r.plan_exercises) ? r.plan_exercises[0] : r.plan_exercises;
    const planPart = pe?.body_part?.trim() || null;
    return {
      sessionId: r.session_id,
      completedAt: r.completed_at,
      displayName: r.exercise_display_name,
      normalizedName: r.exercise_normalized_name,
      weight: r.weight == null ? null : Number(r.weight),
      reps: r.reps,
      bodyPart: override.get(r.exercise_normalized_name) ?? planPart,
    };
  });

  const planRow = (plan.data as PlanRow | null) ?? null;
  return {
    sessions: sessionRows.map(toSession),
    sets,
    logs: {
      weights: ((weights.data as { recorded_on: string; weight_kg: number | string }[]) ?? []).map((r) => ({
        recorded_on: r.recorded_on,
        weight_kg: Number(r.weight_kg),
      })),
      water: (water.data as { recorded_on: string; count: number }[]) ?? [],
      steps: (steps.data as { recorded_on: string; steps: number }[]) ?? [],
      sleep: sleepRows.map((r) => ({ recorded_on: r.recorded_on, hours: Number(r.hours) })),
    },
    ...planShape(planRow),
    plan: planRow ? { name: planRow.name, activatedAt: planRow.activated_at } : null,
    machineUnits,
  };
}

/**
 * Enough of an athlete's last fortnight for their card on the athletes list —
 * sessions, check-ins and daily logs, but no sets. Lift flags need the full
 * load and are left to the athlete's own page.
 */
export async function loadAthleteGlance(athleteId: string, since: Date): Promise<CoachData> {
  const sinceKey = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, '0')}-${String(since.getDate()).padStart(2, '0')}`;
  const [sessions, plan, weights, sleep] = await Promise.all([
    supabase
      .from('sessions')
      .select(
        'id, completed_at, checkin_performance, checkin_energy, checkin_soreness, checkin_sleep, checkin_hunger, checkin_stress, training_days(name)',
      )
      .eq('user_id', athleteId)
      .not('completed_at', 'is', null)
      .gte('completed_at', since.toISOString())
      .order('completed_at', { ascending: false }),
    supabase
      .from('plans')
      .select('name, activated_at, training_days(name, week_index, reference_only)')
      .eq('user_id', athleteId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle(),
    supabase.from('body_weights').select('recorded_on, weight_kg').eq('user_id', athleteId).gte('recorded_on', sinceKey),
    supabase.from('sleep_logs').select('recorded_on, hours').eq('user_id', athleteId).gte('recorded_on', sinceKey),
  ]);
  for (const r of [sessions, plan, weights]) if (r.error) throw r.error;
  return {
    sessions: ((sessions.data as SessionRow[]) ?? []).map(toSession),
    sets: [],
    logs: {
      weights: ((weights.data as { recorded_on: string; weight_kg: number | string }[]) ?? []).map((r) => ({
        recorded_on: r.recorded_on,
        weight_kg: Number(r.weight_kg),
      })),
      water: [],
      steps: [],
      sleep: sleep.error
        ? []
        : ((sleep.data as { recorded_on: string; hours: number | string }[]) ?? []).map((r) => ({
            recorded_on: r.recorded_on,
            hours: Number(r.hours),
          })),
    },
    ...planShape((plan.data as PlanRow | null) ?? null),
  };
}
