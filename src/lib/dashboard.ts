import { estimate1RM } from './oneRepMax';
import { recordAchievedAt, type LiftRecord } from './records';

// The numbers behind the Performance dashboard tiles.
//
// Everything here is pure and works on plain arrays, so each tile's figure can
// be tested without a browser or a database. The rule for every metric: if the
// data can't support the number honestly, return null and let the tile say
// "not enough data yet" rather than show something made from noise.

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** A weighted set, as the dashboard needs it. Structural, so any source fits. */
export interface StrengthSet {
  normalizedName: string;
  displayName: string;
  weight: number | null;
  reps: number | null;
  completedAt: string;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Monday (yyyy-mm-dd) of the week containing `d`. Weeks start Monday here. */
export function weekStartISO(d: Date): string {
  const dow = (d.getDay() + 6) % 7;
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow);
  return `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
}

/** Weeks on the plan so far, counting the current partial week. Matches plansApi.weeksOnPlan. */
export function weeksOnPlanAt(activatedAt: string | null, now: Date): number {
  if (!activatedAt) return 1;
  const ms = now.getTime() - new Date(activatedAt).getTime();
  if (ms < 0) return 1;
  return Math.floor(ms / WEEK_MS) + 1;
}

// --- Consistency -------------------------------------------------------------------

export interface Consistency {
  /** Completed ÷ planned since the plan started, capped at 100. Null with no plan. */
  pct: number | null;
  done: number;
  planned: number;
}

/**
 * How much of the plan has actually been done.
 *
 * Planned = the plan's gym days per week × weeks on the plan (the current week
 * counts in full, so mid-week the figure runs a little low rather than a little
 * flattering). Capped at 100: doing extra sessions is not "110% consistent".
 */
export function computeConsistency(
  sessions: { completed_at: string }[],
  activatedAt: string | null,
  weeklyTarget: number,
  now: Date = new Date()
): Consistency {
  if (!activatedAt || weeklyTarget <= 0) return { pct: null, done: 0, planned: 0 };
  const start = new Date(activatedAt).getTime();
  const done = sessions.filter((s) => new Date(s.completed_at).getTime() >= start).length;
  const planned = weeklyTarget * weeksOnPlanAt(activatedAt, now);
  return { pct: Math.min(100, Math.round((done / planned) * 100)), done, planned };
}

// --- Workouts per week ---------------------------------------------------------------

export interface WorkoutsPerWeek {
  /** Mean sessions per week since the plan started. Null with nothing logged. */
  average: number | null;
  /** Session counts for the last `weeksBack` weeks, oldest first, this week last. */
  weekly: number[];
}

export function computeWorkoutsPerWeek(
  sessions: { completed_at: string }[],
  activatedAt: string | null,
  now: Date = new Date(),
  weeksBack = 8
): WorkoutsPerWeek {
  const counts = new Map<string, number>();
  for (const s of sessions) {
    const k = weekStartISO(new Date(s.completed_at));
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const weekly: number[] = [];
  for (let i = weeksBack - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * WEEK_MS);
    weekly.push(counts.get(weekStartISO(d)) ?? 0);
  }
  if (sessions.length === 0) return { average: null, weekly };

  let sinceStart = sessions.length;
  let weeks: number;
  if (activatedAt) {
    const start = new Date(activatedAt).getTime();
    sinceStart = sessions.filter((s) => new Date(s.completed_at).getTime() >= start).length;
    weeks = weeksOnPlanAt(activatedAt, now);
  } else {
    // No plan to anchor to: average over the weeks that have anything in them.
    weeks = Math.max(1, counts.size);
  }
  if (sinceStart === 0) return { average: null, weekly };
  return { average: Math.round((sinceStart / weeks) * 10) / 10, weekly };
}

// --- Overall strength ------------------------------------------------------------------

export interface OverallStrength {
  /** Mean % change in best est. 1RM per lift, first two weeks on plan vs last two. */
  pct: number | null;
  /** Lifts with a best in both windows — the sample the figure rests on. */
  lifts: number;
  /** Why pct is null, for the tile to say. */
  reason: 'no_plan' | 'too_early' | 'too_few_lifts' | null;
  /** Weekly strength index in % vs baseline, one point per week with data. */
  series: { weekStart: string; pct: number }[];
}

const WINDOW_DAYS = 14;
const MIN_DAYS_ON_PLAN = 28;
const MIN_LIFTS = 3;

/**
 * Whether you're getting stronger, in one number.
 *
 * Per lift: the best estimated 1RM in the first two weeks on the plan versus the
 * best in the most recent two weeks. Only lifts with a best in both count, and
 * the figure is the mean of their % changes — so adding a new exercise mid-plan
 * doesn't move it, and a lift you've dropped doesn't drag it. It needs four
 * weeks on the plan and three such lifts; before that it declines to guess.
 */
export function computeOverallStrength(
  sets: StrengthSet[],
  activatedAt: string | null,
  now: Date = new Date()
): OverallStrength {
  if (!activatedAt) return { pct: null, lifts: 0, reason: 'no_plan', series: [] };
  const start = new Date(activatedAt).getTime();
  const nowMs = now.getTime();
  if (nowMs - start < MIN_DAYS_ON_PLAN * DAY_MS) {
    return { pct: null, lifts: 0, reason: 'too_early', series: [] };
  }
  const baseEnd = start + WINDOW_DAYS * DAY_MS;
  const recentStart = nowMs - WINDOW_DAYS * DAY_MS;

  const baseline = new Map<string, number>();
  const recent = new Map<string, number>();
  const weeklyBest = new Map<string, Map<string, number>>(); // weekStart → lift → best
  for (const s of sets) {
    if (s.weight == null || s.reps == null || s.weight <= 0 || s.reps <= 0) continue;
    const t = new Date(s.completedAt).getTime();
    if (t < start) continue;
    const e = estimate1RM(s.weight, s.reps);
    if (t < baseEnd) baseline.set(s.normalizedName, Math.max(baseline.get(s.normalizedName) ?? 0, e));
    if (t >= recentStart) recent.set(s.normalizedName, Math.max(recent.get(s.normalizedName) ?? 0, e));
    const wk = weekStartISO(new Date(t));
    let m = weeklyBest.get(wk);
    if (!m) {
      m = new Map();
      weeklyBest.set(wk, m);
    }
    m.set(s.normalizedName, Math.max(m.get(s.normalizedName) ?? 0, e));
  }

  const changes: number[] = [];
  for (const [name, base] of baseline) {
    const r = recent.get(name);
    if (r == null || base <= 0) continue;
    changes.push((r / base - 1) * 100);
  }
  if (changes.length < MIN_LIFTS) {
    return { pct: null, lifts: changes.length, reason: 'too_few_lifts', series: [] };
  }
  const pct = Math.round((changes.reduce((a, b) => a + b, 0) / changes.length) * 10) / 10;

  // The series: each week, the mean % vs baseline over the lifts trained that week.
  const series = [...weeklyBest.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([weekStart, bests]) => {
      const pcts: number[] = [];
      for (const [name, best] of bests) {
        const base = baseline.get(name);
        if (base && base > 0) pcts.push((best / base - 1) * 100);
      }
      return pcts.length > 0
        ? { weekStart, pct: Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 10) / 10 }
        : null;
    })
    .filter((p): p is { weekStart: string; pct: number } => p != null);

  return { pct, lifts: changes.length, reason: null, series };
}

// --- Most improved --------------------------------------------------------------------

export interface MostImproved {
  displayName: string;
  normalizedName: string;
  fromKg: number;
  toKg: number;
  deltaKg: number;
  deltaPct: number;
}

/** Biggest est-1RM gain comparing the last 30 days to the 30 before them. */
export function computeMostImproved(sets: StrengthSet[], now: Date = new Date()): MostImproved | null {
  const start30 = now.getTime() - 30 * DAY_MS;
  const start60 = now.getTime() - 60 * DAY_MS;
  const acc = new Map<string, { display: string; recent: number; prior: number }>();
  for (const s of sets) {
    if (s.weight == null || s.reps == null) continue;
    const t = new Date(s.completedAt).getTime();
    if (t < start60) continue;
    const e = estimate1RM(s.weight, s.reps);
    let a = acc.get(s.normalizedName);
    if (!a) {
      a = { display: s.displayName, recent: 0, prior: 0 };
      acc.set(s.normalizedName, a);
    }
    a.display = s.displayName;
    if (t >= start30) a.recent = Math.max(a.recent, e);
    else a.prior = Math.max(a.prior, e);
  }
  let best: MostImproved | null = null;
  for (const [name, a] of acc) {
    if (a.recent <= 0 || a.prior <= 0) continue;
    const deltaKg = a.recent - a.prior;
    if (deltaKg <= 0) continue;
    if (!best || deltaKg > best.deltaKg) {
      best = {
        displayName: a.display,
        normalizedName: name,
        fromKg: a.prior,
        toKg: a.recent,
        deltaKg,
        deltaPct: (deltaKg / a.prior) * 100,
      };
    }
  }
  return best;
}

// --- Body weight ----------------------------------------------------------------------

export interface BodyWeightSummary {
  latestKg: number;
  latestOn: string;
  /** Latest minus the first reading on or after the plan started (or the earliest reading). */
  deltaKg: number | null;
  /** What the delta is measured from. */
  since: 'plan' | 'first' | null;
}

export function summarizeBodyWeight(
  rows: { weight_kg: number; recorded_on: string }[],
  activatedAt: string | null
): BodyWeightSummary | null {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => (a.recorded_on < b.recorded_on ? -1 : 1));
  const latest = sorted[sorted.length - 1];
  let from: { weight_kg: number } | undefined;
  let since: BodyWeightSummary['since'] = null;
  if (activatedAt) {
    const planDay = activatedAt.slice(0, 10);
    from = sorted.find((r) => r.recorded_on >= planDay);
    if (from && from !== latest) since = 'plan';
    else from = undefined;
  }
  if (!from && sorted.length > 1) {
    from = sorted[0];
    since = 'first';
  }
  return {
    latestKg: latest.weight_kg,
    latestOn: latest.recorded_on,
    deltaKg: from ? Math.round((latest.weight_kg - from.weight_kg) * 10) / 10 : null,
    since,
  };
}

/** Rows from the last `days` days, oldest first — the body-weight chart's range. */
export function bodyWeightRange<T extends { recorded_on: string }>(rows: T[], days: number, now = new Date()): T[] {
  const cutoff = new Date(now.getTime() - days * DAY_MS).toISOString().slice(0, 10);
  return [...rows].filter((r) => r.recorded_on >= cutoff).sort((a, b) => (a.recorded_on < b.recorded_on ? -1 : 1));
}

// --- Records -------------------------------------------------------------------------

/** Records whose headline set was hit in the last `days` days. */
export function newRecordCount(records: LiftRecord[], now: Date = new Date(), days = 30): number {
  const cutoff = new Date(now.getTime() - days * DAY_MS).toISOString();
  return records.filter((r) => recordAchievedAt(r) >= cutoff).length;
}

/** Mon..Sun: did a session happen that day this week. */
export function weekDots(bars: number[][]): boolean[] {
  return Array.from({ length: 7 }, (_, i) => (bars[i]?.length ?? 0) > 0);
}
