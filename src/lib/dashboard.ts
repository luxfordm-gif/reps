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
  now: Date = new Date(),
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
  weeksBack = 8,
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
  now: Date = new Date(),
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
    if (t < baseEnd)
      baseline.set(s.normalizedName, Math.max(baseline.get(s.normalizedName) ?? 0, e));
    if (t >= recentStart)
      recent.set(s.normalizedName, Math.max(recent.get(s.normalizedName) ?? 0, e));
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
export function computeMostImproved(
  sets: StrengthSet[],
  now: Date = new Date(),
): MostImproved | null {
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
  activatedAt: string | null,
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
export function bodyWeightRange<T extends { recorded_on: string }>(
  rows: T[],
  days: number,
  now = new Date(),
): T[] {
  const cutoff = new Date(now.getTime() - days * DAY_MS).toISOString().slice(0, 10);
  return [...rows]
    .filter((r) => r.recorded_on >= cutoff)
    .sort((a, b) => (a.recorded_on < b.recorded_on ? -1 : 1));
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

/**
 * The line under a workout in the weekly card: what was actually done.
 *
 * Sets lead because they're the one figure that survives every kind of
 * training — a press-up has no weight to report, and a session of them would
 * otherwise read as nothing at all. Weight follows when there is one to give;
 * see WeekSessionBreakdown.volumeKg for when there isn't.
 */
export function formatSessionMetrics(s: {
  setCount: number;
  repCount: number;
  volumeKg: number | null;
}): string {
  const parts: string[] = [];
  if (s.setCount > 0) parts.push(`${s.setCount} ${s.setCount === 1 ? 'set' : 'sets'}`);
  if (s.repCount > 0) parts.push(`${s.repCount} ${s.repCount === 1 ? 'rep' : 'reps'}`);
  return parts.join(' · ');
}

/** The weight figure for the right of the card, or null when there isn't one. */
export function formatSessionVolume(volumeKg: number | null): string | null {
  if (volumeKg == null || volumeKg <= 0) return null;
  return Math.round(volumeKg).toLocaleString('en-GB');
}

/**
 * "vs last Legs", as an arrow and a percentage.
 *
 * Down is stated, not scolded: an easier session than last time is a deload as
 * often as it is a bad day, and the card has no way of telling which. So the
 * sign is carried by an arrow rather than by red, and 0 gets its own word
 * instead of a directionless "0%".
 */
export function formatVolumeChange(pct: number | null): string | null {
  if (pct == null) return null;
  if (pct === 0) return 'same as last time';
  const arrow = pct > 0 ? '↑' : '↓';
  return `${arrow} ${Math.abs(pct)}% vs last time`;
}

// --- Showing up, week after week -------------------------------------------------------

/**
 * Seven days on, in local time.
 *
 * Not `+ 7 * WEEK_MS`: across a clocks-change weekend that arrives an hour
 * early or late, and an hour early on a Monday lands in the previous week —
 * which would silently break a streak twice a year.
 */
function addWeeks(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n * 7);
  return out;
}

export interface WeekStreak {
  /** Consecutive weeks hitting the target, counting this one if it's there. */
  current: number;
  /** The longest such run there has ever been. */
  longest: number;
  /** Whether this week is already among them. */
  thisWeekCounts: boolean;
}

/**
 * Consecutive weeks of hitting the plan's weekly target.
 *
 * Deliberately not the same thing as consistency. Consistency is a ratio and
 * it forgives — a missed week disappears into an average, and 92% stays 92%.
 * A streak is a run: it breaks, and it can be rebuilt. That's the whole reason
 * it's worth having as well.
 *
 * The week in progress is never counted against you. On a Monday you have had
 * no chance to train yet, and a streak that reads zero every Monday morning is
 * one nobody would keep. So a target not yet met this week leaves the run
 * standing on the completed weeks behind it; meeting it extends the run early.
 */
export function computeWeekStreak(
  sessions: { completed_at: string }[],
  weeklyTarget: number,
  now: Date = new Date(),
): WeekStreak {
  if (weeklyTarget <= 0 || sessions.length === 0) {
    return { current: 0, longest: 0, thisWeekCounts: false };
  }

  const counts = new Map<string, number>();
  for (const s of sessions) {
    const k = weekStartISO(new Date(s.completed_at));
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const hit = (d: Date) => (counts.get(weekStartISO(d)) ?? 0) >= weeklyTarget;

  const thisWeekCounts = hit(now);
  let current = thisWeekCounts ? 1 : 0;
  for (let i = 1; ; i++) {
    if (!hit(addWeeks(now, -i))) break;
    current += 1;
  }

  // Longest runs over finished weeks only, then the run in progress is offered
  // alongside it — an unfinished week can't be the thing that breaks a record.
  const weeks = [...counts.keys()].sort();
  let longest = 0;
  let run = 0;
  const thisWeekKey = weekStartISO(now);
  for (
    let d = new Date(`${weeks[0]}T00:00:00`);
    weekStartISO(d) < thisWeekKey;
    d = addWeeks(d, 1)
  ) {
    if (hit(d)) {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }

  return { current, longest: Math.max(longest, current), thisWeekCounts };
}

// --- Training load ---------------------------------------------------------------------

export interface WeeklyLoadPoint {
  /** Monday (yyyy-mm-dd) of the week. */
  weekStart: string;
  /** Sets logged that week. */
  sets: number;
}

/**
 * Sets per week over the last `weeks` weeks, oldest first.
 *
 * Sets rather than kilograms, and not as a consolation: the weight column
 * mixes kilograms with the pin positions a stack machine logs (see units.ts),
 * so a total across machines isn't a quantity of anything. Sets are exactly
 * true, they include the press-up and mobility work a weight total scores as
 * zero, and weekly set count is the measure training programmes are actually
 * written in.
 *
 * Every week in the window is returned, including the empty ones. A series
 * that omits them draws a straight line over a fortnight off and hides the
 * one thing a twelve-week chart exists to show.
 */
export function computeWeeklyLoad(
  sets: { completedAt: string }[],
  weeks = 12,
  now: Date = new Date(),
): WeeklyLoadPoint[] {
  const counts = new Map<string, number>();
  for (const s of sets) {
    const k = weekStartISO(new Date(s.completedAt));
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const out: WeeklyLoadPoint[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const weekStart = weekStartISO(addWeeks(now, -i));
    out.push({ weekStart, sets: counts.get(weekStart) ?? 0 });
  }
  return out;
}
