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

// --- Daily habits ----------------------------------------------------------------------

export interface DailyAverage {
  /** Mean across the days that carry an entry. Null when none do. */
  average: number | null;
  /** How many days this week carry one. */
  daysLogged: number;
}

/**
 * This week's average for something logged once a day — water, steps.
 *
 * Averaged over the days that were actually logged, not over the days that
 * have passed. Both of these are entered by hand, so a day with no row means
 * "didn't write it down" far more often than it means zero, and dividing by
 * the calendar would turn three well-tracked days into a number that looks
 * like failure. The count of days comes back alongside the figure so the tile
 * can say what it was averaged over rather than implying a full week.
 *
 * A row of zero doesn't count as a day. The water tile decrements as well as
 * increments, so zero is usually a tap taken back rather than a day's honest
 * total.
 */
export function weekDailyAverage(
  entries: { date: string; value: number }[],
  now: Date = new Date(),
): DailyAverage {
  const from = weekStartISO(now);
  const to = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  // Dates are yyyy-mm-dd, so lexical order is chronological order.
  const inWeek = entries.filter((e) => e.value > 0 && e.date >= from && e.date <= to);
  if (inWeek.length === 0) return { average: null, daysLogged: 0 };

  // One row per day is the shape of both tables, but a duplicate would double
  // count a day, so they're folded by date first.
  const byDay = new Map<string, number>();
  for (const e of inWeek) byDay.set(e.date, (byDay.get(e.date) ?? 0) + e.value);
  const total = [...byDay.values()].reduce((sum, v) => sum + v, 0);
  return { average: total / byDay.size, daysLogged: byDay.size };
}

// --- Intensity, alongside the load -------------------------------------------------------

export interface WeeklyIntensityPoint {
  /** Monday (yyyy-mm-dd) of the week. Same weeks as computeWeeklyLoad. */
  weekStart: string;
  /** How heavy the week was against the window's own baseline, as a %. */
  pct: number | null;
  /** Lifts the figure was averaged over — null pct when too few. */
  lifts: number;
}

/** A lift needs weeks either side of one to say anything about a trend. */
const INTENSITY_MIN_WEEKS = 2;
/** One lift having a good week isn't the week being heavy. */
const INTENSITY_MIN_LIFTS = 2;

/**
 * How heavy the training was each week, next to how much of it there was.
 *
 * Sets answer "how much" and nothing else: a deload week of light triples and
 * a week of grinding singles at the same set count draw the same line, which
 * is exactly the case where the line is worth doubting. This is the other
 * half — the same twelve weeks, asked whether the weight on the bar was going
 * up.
 *
 * It is a ratio, not a total, for the reason computeWeeklyLoad gives for not
 * adding kilograms up: the weight column holds kilograms on some machines and
 * pin positions on others, and those cannot be summed. A lift compared against
 * its own baseline can, because the units cancel — 60kg against a 55kg
 * baseline and pin 8 against pin 7 are both "heavier than usual", and both
 * come out as a percentage that means the same thing.
 *
 * Each lift's baseline is its own mean best over the window, so the series
 * sits around zero by construction and reads as "heavier or lighter than this
 * season's normal" rather than as progress from a start date. Lifts trained in
 * only one week of the window are left out: they have no normal to be measured
 * against, and including them would peg a week to exactly its own average.
 */
export function computeWeeklyIntensity(
  sets: StrengthSet[],
  weeks = 12,
  now: Date = new Date(),
): WeeklyIntensityPoint[] {
  const window: string[] = [];
  for (let i = weeks - 1; i >= 0; i--) window.push(weekStartISO(addWeeks(now, -i)));
  const inWindow = new Set(window);

  // lift -> week -> best estimated 1RM that week.
  const byLift = new Map<string, Map<string, number>>();
  for (const s of sets) {
    if (s.weight == null || s.reps == null) continue;
    const wk = weekStartISO(new Date(s.completedAt));
    if (!inWindow.has(wk)) continue;
    let weeksOfLift = byLift.get(s.normalizedName);
    if (!weeksOfLift) {
      weeksOfLift = new Map();
      byLift.set(s.normalizedName, weeksOfLift);
    }
    const e = estimate1RM(s.weight, s.reps);
    weeksOfLift.set(wk, Math.max(weeksOfLift.get(wk) ?? 0, e));
  }

  const ratios = new Map<string, number[]>(window.map((w) => [w, []]));
  for (const weeksOfLift of byLift.values()) {
    if (weeksOfLift.size < INTENSITY_MIN_WEEKS) continue;
    const values = [...weeksOfLift.values()];
    const baseline = values.reduce((sum, v) => sum + v, 0) / values.length;
    if (baseline <= 0) continue;
    for (const [wk, best] of weeksOfLift) ratios.get(wk)?.push(best / baseline);
  }

  return window.map((weekStart) => {
    const rs = ratios.get(weekStart) ?? [];
    if (rs.length < INTENSITY_MIN_LIFTS) return { weekStart, pct: null, lifts: rs.length };
    const mean = rs.reduce((sum, r) => sum + r, 0) / rs.length;
    return { weekStart, pct: Math.round((mean - 1) * 1000) / 10, lifts: rs.length };
  });
}

// --- This week against another one -------------------------------------------------------

export interface WeekTotals {
  /** Monday (yyyy-mm-dd) of the week. */
  weekStart: string;
  workouts: number;
  sets: number;
  exercises: number;
}

/** One lift, this week against the week being compared with. */
export interface ExerciseMove {
  normalizedName: string;
  displayName: string;
  /** Heaviest set of the week, and the reps hit on it. */
  currentKg: number;
  currentReps: number;
  previousKg: number;
  previousReps: number;
  /** Change in best estimated 1RM — what the rows are ranked on. */
  deltaPct: number;
  deltaKg: number;
}

export interface WeekComparison {
  current: WeekTotals;
  previous: WeekTotals;
  /** Lifts trained in both weeks, biggest gain first. */
  movers: ExerciseMove[];
  heavier: number;
  lighter: number;
  held: number;
}

/** Below this a lift is "held" rather than moved — logging noise, not progress. */
const MOVE_EPSILON_PCT = 1;

/**
 * This week beside an earlier one, lift by lift.
 *
 * The tab's other numbers are seasons and averages; this is the question
 * actually being asked on a Thursday — am I ahead of where I was the last time
 * round this plan? So it compares two named weeks rather than rolling windows,
 * and `weeksBack` is how far to reach: 1 for last week, 2 for the week before
 * that, which is the one to use when the plan runs on a fortnight's rotation.
 *
 * A lift only appears if it was trained in both weeks. Ranking is by estimated
 * 1RM rather than by weight, so five more kilos for three fewer reps doesn't
 * read as a clean gain, but the rows still show the sets themselves — the
 * number you'd recognise from the logger.
 */
export function compareWeeks(
  sets: StrengthSet[],
  sessions: { completed_at: string }[],
  weeksBack: number,
  now: Date = new Date(),
): WeekComparison {
  const currentWeek = weekStartISO(now);
  const previousWeek = weekStartISO(addWeeks(now, -Math.max(1, weeksBack)));

  interface Best {
    display: string;
    e1rm: number;
    topKg: number;
    topReps: number;
  }
  const bests = new Map<string, Map<string, Best>>([
    [currentWeek, new Map()],
    [previousWeek, new Map()],
  ]);
  const setCounts = new Map<string, number>([
    [currentWeek, 0],
    [previousWeek, 0],
  ]);
  const seen = new Map<string, Set<string>>([
    [currentWeek, new Set()],
    [previousWeek, new Set()],
  ]);

  for (const s of sets) {
    const wk = weekStartISO(new Date(s.completedAt));
    const week = bests.get(wk);
    if (!week) continue;
    setCounts.set(wk, (setCounts.get(wk) ?? 0) + 1);
    seen.get(wk)?.add(s.normalizedName);
    if (s.weight == null || s.reps == null) continue;
    const e = estimate1RM(s.weight, s.reps);
    const prev = week.get(s.normalizedName);
    if (!prev || e > prev.e1rm) {
      week.set(s.normalizedName, {
        display: s.displayName,
        e1rm: e,
        topKg: s.weight,
        topReps: s.reps,
      });
    }
  }

  const workouts = new Map<string, number>([
    [currentWeek, 0],
    [previousWeek, 0],
  ]);
  for (const s of sessions) {
    const wk = weekStartISO(new Date(s.completed_at));
    if (workouts.has(wk)) workouts.set(wk, (workouts.get(wk) ?? 0) + 1);
  }

  const totals = (weekStart: string): WeekTotals => ({
    weekStart,
    workouts: workouts.get(weekStart) ?? 0,
    sets: setCounts.get(weekStart) ?? 0,
    exercises: seen.get(weekStart)?.size ?? 0,
  });

  const movers: ExerciseMove[] = [];
  let heavier = 0;
  let lighter = 0;
  let held = 0;
  const currentBests = bests.get(currentWeek)!;
  const previousBests = bests.get(previousWeek)!;
  for (const [name, cur] of currentBests) {
    const prev = previousBests.get(name);
    if (!prev || prev.e1rm <= 0) continue;
    const deltaPct = Math.round(((cur.e1rm - prev.e1rm) / prev.e1rm) * 1000) / 10;
    movers.push({
      normalizedName: name,
      displayName: cur.display,
      currentKg: cur.topKg,
      currentReps: cur.topReps,
      previousKg: prev.topKg,
      previousReps: prev.topReps,
      deltaPct,
      deltaKg: Math.round((cur.topKg - prev.topKg) * 100) / 100,
    });
    if (deltaPct > MOVE_EPSILON_PCT) heavier += 1;
    else if (deltaPct < -MOVE_EPSILON_PCT) lighter += 1;
    else held += 1;
  }
  movers.sort((a, b) => b.deltaPct - a.deltaPct || a.displayName.localeCompare(b.displayName));

  return {
    current: totals(currentWeek),
    previous: totals(previousWeek),
    movers,
    heavier,
    lighter,
    held,
  };
}
