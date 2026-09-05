import { supabase, currentUserId } from './supabase';
import { listBodyWeights, type BodyWeightRow } from './bodyWeightApi';
import { estimate1RM } from './oneRepMax';

export { estimate1RM };

// Performance page data + aggregation.
//
// All weights are stored in kg; aggregation here stays in kg and the display
// layer converts to the user's preferred unit. Estimated 1RM uses the Epley
// formula, the de-facto standard for gym apps.

export type TrendMetric = 'est1rm' | 'volume' | 'reps' | 'bodyweight';

export interface PerfSet {
  displayName: string;
  normalizedName: string;
  weight: number | null;
  reps: number | null;
  completedAt: string;
  bodyPart: string | null;
}

export interface TrendPoint {
  /** ISO date (yyyy-mm-dd) of the Monday that starts the bucket's week. */
  weekStart: string;
  value: number;
}

export interface PerformanceData {
  /** All weighted sets, ascending by completion. The screen re-buckets these in memory for the trend chart. */
  sets: PerfSet[];
  bodyWeights: BodyWeightRow[];
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Monday (yyyy-mm-dd) of the week containing `d`, matching the app's Mon-start weeks. */
function weekStartISO(d: Date): string {
  const dow = (d.getDay() + 6) % 7; // 0=Mon..6=Sun
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow);
  return `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
}

type SetRow = {
  exercise_display_name: string;
  exercise_normalized_name: string;
  weight: number | null;
  reps: number | null;
  completed_at: string;
  plan_exercises?: { body_part: string | null } | { body_part: string | null }[] | null;
};

// Most recent N sets for the user, oldest-first. Capped like the rest of the
// app's history queries; all-time bests for users beyond the cap may miss very
// old lifts, an acceptable trade for a single fast query.
async function fetchPerfSets(limit = 5000): Promise<PerfSet[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  const { data, error } = await supabase
    .from('logged_sets')
    .select(
      'exercise_display_name, exercise_normalized_name, weight, reps, completed_at, plan_exercises(body_part)'
    )
    .eq('user_id', userId)
    .order('completed_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = (data as SetRow[]) ?? [];
  return rows
    .map((r) => {
      const pe = Array.isArray(r.plan_exercises) ? r.plan_exercises[0] : r.plan_exercises;
      const bp = pe?.body_part?.trim();
      return {
        displayName: r.exercise_display_name,
        normalizedName: r.exercise_normalized_name,
        weight: r.weight,
        reps: r.reps,
        completedAt: r.completed_at,
        bodyPart: bp ? bp : null,
      };
    })
    .reverse();
}

/**
 * Bucket sets into weekly trend points. `est1rm` takes the best set of each
 * week; `volume`/`reps` sum the week. Pass `normalizedName` to scope to one
 * lift (required for `est1rm`/`reps` to be meaningful).
 */
export function buildWeeklySeries(
  sets: PerfSet[],
  metric: Exclude<TrendMetric, 'bodyweight'>,
  opts?: { normalizedName?: string }
): TrendPoint[] {
  const filtered = opts?.normalizedName
    ? sets.filter((s) => s.normalizedName === opts.normalizedName)
    : sets;
  const byWeek = new Map<string, number>();
  for (const s of filtered) {
    if (metric === 'reps') {
      if (s.reps == null) continue;
      const wk = weekStartISO(new Date(s.completedAt));
      byWeek.set(wk, (byWeek.get(wk) ?? 0) + s.reps);
      continue;
    }
    if (s.weight == null || s.reps == null) continue;
    const wk = weekStartISO(new Date(s.completedAt));
    if (metric === 'est1rm') {
      byWeek.set(wk, Math.max(byWeek.get(wk) ?? 0, estimate1RM(s.weight, s.reps)));
    } else {
      byWeek.set(wk, (byWeek.get(wk) ?? 0) + s.weight * s.reps);
    }
  }
  return [...byWeek.entries()]
    .map(([weekStart, value]) => ({ weekStart, value }))
    .sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
}

export interface SessionSet {
  weightKg: number | null;
  reps: number | null;
}

export interface ExerciseHistoryPoint {
  /** Local yyyy-mm-dd of the workout day. */
  date: string;
  /** ISO timestamp of the first set that day (tooltip label + stable sort). */
  at: string;
  /** Heaviest weight lifted that day (kg). null if no weighted sets. */
  topWeightKg: number | null;
  /** Reps achieved on the heaviest set that day. */
  repsAtTopWeight: number | null;
  /** Best Epley estimated 1RM across the day's sets (kg). */
  bestEst1RMkg: number | null;
  /** Every set that day, in logged order. */
  sets: SessionSet[];
}

/** Local yyyy-mm-dd day key (history is grouped by calendar day). */
function dayISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Per-session history for one exercise, ascending by date. Each point captures
 * the day's heaviest set (weight + the reps hit on it) and best estimated 1RM,
 * plus every set for the history list. `sets` arrives ascending by completion,
 * so logged order within a day is preserved.
 */
export function buildExerciseHistory(
  sets: PerfSet[],
  normalizedName: string
): ExerciseHistoryPoint[] {
  const byDay = new Map<string, ExerciseHistoryPoint>();
  for (const s of sets) {
    if (s.normalizedName !== normalizedName) continue;
    const key = dayISO(new Date(s.completedAt));
    let p = byDay.get(key);
    if (!p) {
      p = {
        date: key,
        at: s.completedAt,
        topWeightKg: null,
        repsAtTopWeight: null,
        bestEst1RMkg: null,
        sets: [],
      };
      byDay.set(key, p);
    }
    p.sets.push({ weightKg: s.weight, reps: s.reps });
    if (s.weight == null) continue;
    if (p.topWeightKg == null || s.weight > p.topWeightKg) {
      p.topWeightKg = s.weight;
      p.repsAtTopWeight = s.reps; // raw rep count — never unit-converted
    }
    if (s.reps != null) {
      const e = estimate1RM(s.weight, s.reps);
      if (p.bestEst1RMkg == null || e > p.bestEst1RMkg) p.bestEst1RMkg = e;
    }
  }
  return [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

// All-time bests live in lib/records.ts now (every set, three record kinds);
// the top-eight leaderboard that used to be computed here went with the card
// that showed it.
export async function loadPerformanceData(): Promise<PerformanceData> {
  const [sets, bodyWeights] = await Promise.all([fetchPerfSets(), listBodyWeights()]);
  return { sets, bodyWeights };
}
