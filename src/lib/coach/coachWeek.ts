// What a coach sees for one athlete's week, worked out from everything the
// athlete has logged. Pure: the dashboard fetches once and every view —
// a week, the weeks before it, one body part, one lift — is cut from the
// same data here.
//
// A coach opens this on a computer once or twice a week, for several
// athletes, and wants three answers fast: did they do the work, are they
// getting stronger, and is anything off (sleep, soreness, weight). So every
// figure comes with the comparison week beside it, and anything worth a
// second look is raised as a flag rather than left to be spotted in a table.

import { dayKey, DOWN_PCT, SUSPECT_PCT } from '../coachSummary';
import { RATING_QUESTIONS, type CheckIn, type RatingKey } from '../checkin';
import { summarizeWeekSets, type WeeklyWorkoutSummary } from '../weekSummary';

export interface CoachSession {
  id: string;
  completedAt: string;
  dayName: string;
  checkIn: CheckIn;
}

export interface CoachSet {
  sessionId: string;
  completedAt: string;
  displayName: string;
  normalizedName: string;
  weight: number | null;
  reps: number | null;
  /** The plan's body part, or the athlete's override for the machine. */
  bodyPart: string | null;
}

export interface CoachDailyLogs {
  weights: { recorded_on: string; weight_kg: number }[];
  water: { recorded_on: string; count: number }[];
  steps: { recorded_on: string; steps: number }[];
  sleep: { recorded_on: string; hours: number }[];
}

export interface CoachData {
  sessions: CoachSession[];
  sets: CoachSet[];
  logs: CoachDailyLogs;
  /** Gym sessions a week on the active plan; 0 when there's no plan. */
  weeklyTarget: number;
  /** How many weeks the plan rotates over: 2 for week A / week B, 0 if none. */
  rotationWeeks: number;
  /** Days that don't count towards the weekly target (the home abs workout).
   *  Still shown on the grid; just not counted as a gym session. */
  referenceDayNames?: string[];
}

/** What the week is set against. */
export type Comparison = 'last' | 'rotation';

// ---- Thresholds ------------------------------------------------------------

/** Average sleep below this is flagged. Seven hours is the usual floor
 *  for someone training hard. */
export const SLEEP_FLAG_HOURS = 7;
/** A soreness or stress average at or above this (on 1–5, 5 worst) is flagged. */
export const STRAIN_FLAG = 4;
/** Body weight moving more than this share in a week is flagged, either way. */
export const WEIGHT_FLAG_PCT = 1;

// ---- Dates -----------------------------------------------------------------

/** Monday 00:00 local of the week containing `d`. */
export function mondayOf(d: Date): Date {
  const dow = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** yyyy-mm-dd, local — how the daily logs and the URL name a week. */
export { dayKey };

/** The Monday a `?week=yyyy-mm-dd` names, or null if it doesn't parse. */
export function parseWeek(param: string | null): Date | null {
  if (!param || !/^\d{4}-\d{2}-\d{2}$/.test(param)) return null;
  const [y, m, d] = param.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : mondayOf(date);
}

// ---- One week --------------------------------------------------------------

/** A figure for the week, and the same figure for the comparison week. */
export interface Measure {
  current: number | null;
  previous: number | null;
}

export interface DayCell {
  date: string;
  sessions: {
    id: string;
    dayName: string;
    setCount: number;
    volumeKg: number;
    checkIn: CheckIn;
  }[];
  weightKg: number | null;
  water: number | null;
  steps: number | null;
  sleepHours: number | null;
}

export interface BodyPartRow {
  bodyPart: string;
  sets: Measure;
  volumeKg: Measure;
  /** Mean change on the best set across this part's lifts this week, each
   *  against the last time its session was done — see LiftCompare. */
  strengthPct: number | null;
  topSet: { exercise: string; weight: number; reps: number } | null;
}

export interface FeelSummary {
  /** Each question's average over the week's check-ins. */
  ratings: Record<RatingKey, Measure>;
  /** One 1–5 figure, higher better — see feelScore. */
  score: Measure;
  /** How many sessions this week had any check-in. */
  checkIns: number;
}

export type FlagTone = 'warn' | 'note';

export interface Flag {
  key: string;
  tone: FlagTone;
  text: string;
}

export interface CoachWeek {
  weekStart: Date;
  /** The week compared against, and how far back it is. */
  comparisonStart: Date;
  comparisonWeeksBack: number;
  /** False while the week is still going — "3 of 4 so far", not "missed one".
   *  The comparison week is then cut at the same point. */
  complete: boolean;
  current: WeeklyWorkoutSummary;
  previous: WeeklyWorkoutSummary;
  workouts: Measure;
  target: number;
  sets: Measure;
  volumeKg: Measure;
  weightKg: Measure;
  water: Measure;
  steps: Measure;
  sleepHours: Measure;
  feel: FeelSummary;
  days: DayCell[];
  /** Each session this week, lift by lift, against the last time that same
   *  session was done. */
  sessionLifts: SessionCompare[];
  /** The mean change across every lift this week that has one. */
  strengthPct: number | null;
  bodyParts: BodyPartRow[];
  flags: Flag[];
}

function inRange(iso: string, from: Date, to: Date): boolean {
  const t = new Date(iso).getTime();
  return t >= from.getTime() && t < to.getTime();
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((s, v) => s + v, 0) / values.length;
}

/**
 * A stretch of a week: the whole of it, or — for a week still going and the
 * week it's set against — only as far in as today. Comparing Tuesday's
 * figures with all of last week would read as a collapse every Tuesday.
 */
interface Span {
  start: Date;
  /** Exclusive. */
  end: Date;
  /** How many of its calendar days the daily logs are read for. */
  days: number;
}

const DAY_MS = 86_400_000;

function fullWeek(start: Date): Span {
  return { start, end: addDays(start, 7), days: 7 };
}

function weekSummary(data: CoachData, span: Span): WeeklyWorkoutSummary {
  const weekStart = span.start;
  const sessions = data.sessions
    .filter((s) => inRange(s.completedAt, span.start, span.end))
    .sort((a, b) => (a.completedAt < b.completedAt ? -1 : 1));
  const ids = new Set(sessions.map((s) => s.id));
  return summarizeWeekSets(
    weekStart,
    sessions.map((s) => ({ id: s.id, completed_at: s.completedAt, trainingDayName: s.dayName })),
    data.sets
      .filter((r) => ids.has(r.sessionId))
      .map((r) => ({
        session_id: r.sessionId,
        exercise_display_name: r.displayName,
        exercise_normalized_name: r.normalizedName,
        weight: r.weight,
        reps: r.reps,
        bodyPart: r.bodyPart,
      })),
  );
}

function spanKeys(span: Span): Set<string> {
  const keys = new Set<string>();
  for (let i = 0; i < span.days; i++) keys.add(dayKey(addDays(span.start, i)));
  return keys;
}

/** A daily log averaged over the days of the week that have one. Zeros are
 *  skipped the way the app's own habit tiles skip them: a zero is a tap taken
 *  back far more often than a real day's total. */
function logAverage<T extends { recorded_on: string }>(
  rows: T[],
  value: (r: T) => number,
  span: Span,
  skipZero = true,
): number | null {
  const keys = spanKeys(span);
  return mean(
    rows.filter((r) => keys.has(r.recorded_on)).map(value).filter((v) => !skipZero || v > 0),
  );
}

/**
 * The week's check-ins as one 1–5 figure, higher better. Workout, energy and
 * sleep count as given; soreness and stress are turned round (6 − x) because
 * on the sheet 1 is their best. Hunger is left out: more or less hungry isn't
 * better or worse on its own.
 */
export function feelScore(checkIn: CheckIn): number | null {
  const parts: number[] = [];
  if (checkIn.performance != null) parts.push(checkIn.performance);
  if (checkIn.energy != null) parts.push(checkIn.energy);
  if (checkIn.sleep != null) parts.push(checkIn.sleep);
  if (checkIn.soreness != null) parts.push(6 - checkIn.soreness);
  if (checkIn.stress != null) parts.push(6 - checkIn.stress);
  return mean(parts);
}

function sessionsIn(data: CoachData, span: Span): CoachSession[] {
  return data.sessions.filter((s) => inRange(s.completedAt, span.start, span.end));
}

function gymSessionCount(data: CoachData, span: Span): number {
  const reference = new Set(data.referenceDayNames ?? []);
  return sessionsIn(data, span).filter((s) => !reference.has(s.dayName)).length;
}

function ratingAverages(sessions: CoachSession[]): { ratings: Record<RatingKey, number | null>; score: number | null; count: number } {
  const ratings = {} as Record<RatingKey, number | null>;
  for (const q of RATING_QUESTIONS) {
    ratings[q.key] = mean(sessions.map((s) => s.checkIn[q.key]).filter((v): v is number => v != null));
  }
  const scores = sessions.map((s) => feelScore(s.checkIn)).filter((v): v is number => v != null);
  return { ratings, score: mean(scores), count: scores.length };
}

/** How far back the comparison week is: one week, or a full rotation. */
export function comparisonWeeksBack(data: CoachData, compare: Comparison): number {
  return compare === 'rotation' && data.rotationWeeks >= 2 ? data.rotationWeeks : 1;
}

export function buildCoachWeek(
  data: CoachData,
  weekStart: Date,
  compare: Comparison = 'last',
  now: Date = new Date(),
): CoachWeek {
  const weeksBack = comparisonWeeksBack(data, compare);
  const comparisonStart = addDays(weekStart, -7 * weeksBack);
  const complete = addDays(weekStart, 7).getTime() <= now.getTime();
  // A week still going is set against the same stretch of the comparison
  // week: up to this weekday and time of day, and the daily logs up to and
  // including today.
  const elapsed = now.getTime() - weekStart.getTime();
  const daysIn = complete ? 7 : Math.min(7, Math.max(1, Math.floor(elapsed / DAY_MS) + 1));
  const thisSpan = fullWeek(weekStart);
  const thatSpan: Span = complete
    ? fullWeek(comparisonStart)
    : { start: comparisonStart, end: new Date(comparisonStart.getTime() + Math.max(0, elapsed)), days: daysIn };
  const current = weekSummary(data, thisSpan);
  const previous = weekSummary(data, thatSpan);

  const { logs } = data;
  const measure = (f: (span: Span) => number | null): Measure => ({
    current: f(thisSpan),
    previous: f(thatSpan),
  });

  const weightKg = measure((w) => logAverage(logs.weights, (r) => r.weight_kg, w));
  const water = measure((w) => logAverage(logs.water, (r) => r.count, w));
  const steps = measure((w) => logAverage(logs.steps, (r) => r.steps, w));
  // A logged zero is a real answer for sleep — a night shift, a newborn — not
  // a tap taken back, so it counts.
  const sleepHours = measure((w) => logAverage(logs.sleep, (r) => r.hours, w, false));

  const curFeel = ratingAverages(sessionsIn(data, thisSpan));
  const prevFeel = ratingAverages(sessionsIn(data, thatSpan));
  const ratings = {} as Record<RatingKey, Measure>;
  for (const q of RATING_QUESTIONS) {
    ratings[q.key] = { current: curFeel.ratings[q.key], previous: prevFeel.ratings[q.key] };
  }
  const feel: FeelSummary = {
    ratings,
    score: { current: curFeel.score, previous: prevFeel.score },
    checkIns: curFeel.count,
  };

  // The grid: each day of the week with whatever was logged on it.
  const weekSessions = sessionsIn(data, thisSpan);
  const days: DayCell[] = [];
  for (let i = 0; i < 7; i++) {
    const date = dayKey(addDays(weekStart, i));
    const onDay = weekSessions
      .filter((s) => dayKey(new Date(s.completedAt)) === date)
      .sort((a, b) => (a.completedAt < b.completedAt ? -1 : 1));
    days.push({
      date,
      sessions: onDay.map((s) => {
        const sets = data.sets.filter((r) => r.sessionId === s.id);
        return {
          id: s.id,
          dayName: s.dayName,
          setCount: sets.length,
          volumeKg: sets.reduce((sum, r) => sum + (r.weight != null && r.reps != null ? r.weight * r.reps : 0), 0),
          checkIn: s.checkIn,
        };
      }),
      weightKg: logs.weights.find((r) => r.recorded_on === date)?.weight_kg ?? null,
      water: logs.water.find((r) => r.recorded_on === date && r.count > 0)?.count ?? null,
      steps: logs.steps.find((r) => r.recorded_on === date && r.steps > 0)?.steps ?? null,
      sleepHours: logs.sleep.find((r) => r.recorded_on === date)?.hours ?? null,
    });
  }

  const sessionLifts = compareSessions(data, weekSessions);
  const allLifts = sessionLifts.flatMap((s) => s.lifts);

  // Body parts trained in either week, this week's biggest first.
  const prevParts = new Map(previous.byBodyPart.map((b) => [b.bodyPart, b]));
  const curParts = new Map(current.byBodyPart.map((b) => [b.bodyPart, b]));
  const partNames = [
    ...current.byBodyPart.map((b) => b.bodyPart),
    ...previous.byBodyPart.map((b) => b.bodyPart).filter((n) => !curParts.has(n)),
  ];
  const bodyParts: BodyPartRow[] = partNames.map((name) => {
    const cur = curParts.get(name);
    const prev = prevParts.get(name);
    const partLifts = allLifts.filter((l) => (l.bodyPart?.trim() || 'Other') === name);
    return {
      bodyPart: name,
      sets: { current: cur?.setCount ?? 0, previous: prev?.setCount ?? 0 },
      volumeKg: { current: cur?.volume ?? 0, previous: prev?.volume ?? 0 },
      strengthPct: meanPct(partLifts),
      topSet: cur?.topSet ?? null,
    };
  });

  const week: CoachWeek = {
    weekStart,
    comparisonStart,
    comparisonWeeksBack: weeksBack,
    complete,
    current,
    previous,
    workouts: {
      current: gymSessionCount(data, thisSpan),
      previous: gymSessionCount(data, thatSpan),
    },
    target: data.weeklyTarget,
    sets: { current: current.totalSets, previous: previous.totalSets },
    volumeKg: { current: current.totalVolume, previous: previous.totalVolume },
    weightKg,
    water,
    steps,
    sleepHours,
    feel,
    days,
    sessionLifts,
    strengthPct: meanPct(allLifts),
    bodyParts,
    flags: [],
  };
  week.flags = weekFlags(week);
  return week;
}

/** Anything about the week worth a coach's second look, most pressing first. */
export function weekFlags(w: CoachWeek): Flag[] {
  const flags: Flag[] = [];
  const done = w.workouts.current ?? 0;
  if (w.complete && w.target > 0 && done < w.target) {
    flags.push({
      key: 'missed',
      tone: 'warn',
      text: `${done} of ${w.target} sessions done`,
    });
  }
  const sleep = w.sleepHours.current;
  if (sleep != null && sleep < SLEEP_FLAG_HOURS) {
    flags.push({ key: 'sleep', tone: 'warn', text: `Sleep averaging ${oneDp(sleep)} h a night` });
  }
  const soreness = w.feel.ratings.soreness.current;
  if (soreness != null && soreness >= STRAIN_FLAG) {
    flags.push({ key: 'soreness', tone: 'warn', text: `Soreness averaging ${oneDp(soreness)} of 5` });
  }
  const stress = w.feel.ratings.stress.current;
  if (stress != null && stress >= STRAIN_FLAG) {
    flags.push({ key: 'stress', tone: 'warn', text: `Stress averaging ${oneDp(stress)} of 5` });
  }
  const lifts = w.sessionLifts.flatMap((s) => s.lifts);
  const down = lifts.filter((l) => l.pct != null && l.pct <= -DOWN_PCT);
  if (down.length > 0) {
    flags.push({
      key: 'down',
      tone: 'warn',
      text:
        down.length === 1
          ? `${down[0].displayName} down ${Math.abs(Math.round(down[0].pct!))}%`
          : `${down.length} lifts down ${DOWN_PCT}% or more`,
    });
  }
  const { current: wNow, previous: wBefore } = w.weightKg;
  if (wNow != null && wBefore != null && wBefore > 0) {
    const pct = ((wNow - wBefore) / wBefore) * 100;
    if (Math.abs(pct) > WEIGHT_FLAG_PCT) {
      flags.push({
        key: 'weight',
        tone: 'note',
        text: `Body weight ${pct > 0 ? 'up' : 'down'} ${oneDp(Math.abs(pct))}%`,
      });
    }
  }
  const suspect = lifts.filter((l) => l.suspect);
  if (suspect.length > 0) {
    flags.push({
      key: 'suspect',
      tone: 'note',
      text:
        suspect.length === 1
          ? `${suspect[0].displayName} jumped too far to compare`
          : `${suspect.length} lifts jumped too far to compare`,
    });
  }
  return flags;
}

export function oneDp(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** Change from previous to current as a percentage, or null if either is
 *  missing or the base is zero. */
export function pctChange(m: Measure): number | null {
  if (m.current == null || m.previous == null || m.previous === 0) return null;
  return ((m.current - m.previous) / m.previous) * 100;
}

// ---- Lifts, against the last time --------------------------------------------
//
// A coach reads a lift the way the logbook does: what did you do on it last
// time, and what did you do today. So each lift is judged on its best set —
// the heaviest weight, and the most reps at that weight — set against the
// best set the last time that same session was done. On a plan that rotates
// over two weeks that's the session two weeks ago, not last week's, which was
// a different workout.
//
// The percentage is on weight × reps of that one set: 80 kg × 8 to 82.5 kg × 8
// is +3%, and 28 kg × 10 to 28 kg × 12 is +20%. More weight and more reps
// both count, and an extra or a dropped set doesn't.

export interface TopSet {
  weightKg: number;
  reps: number;
}

/** The heaviest set, the most reps breaking a tie. Null when no set had both
 *  a weight and reps (a plank, a hold). */
export function topSet(sets: { weight: number | null; reps: number | null }[]): TopSet | null {
  let best: TopSet | null = null;
  for (const s of sets) {
    if (s.weight == null || s.reps == null) continue;
    if (!best || s.weight > best.weightKg || (s.weight === best.weightKg && s.reps > best.reps)) {
      best = { weightKg: s.weight, reps: s.reps };
    }
  }
  return best;
}

/** Change from one best set to another, in weight × reps, as a percentage. */
export function topSetChangePct(before: TopSet, after: TopSet): number | null {
  const was = before.weightKg * before.reps;
  if (was <= 0) return null;
  return ((after.weightKg * after.reps - was) / was) * 100;
}

export interface LiftCompare {
  normalizedName: string;
  displayName: string;
  bodyPart: string | null;
  current: TopSet | null;
  /** Null when the lift wasn't in that session last time. */
  previous: TopSet | null;
  /** Null when there's nothing to set it against, or the jump is too big to
   *  be the same machine (see `suspect`). */
  pct: number | null;
  /** A change this large is a different machine or a slip, not training. */
  suspect: boolean;
}

export interface SessionCompare {
  sessionId: string;
  dayName: string;
  completedAt: string;
  /** The last time this same session was done, or null on its first outing. */
  previous: { sessionId: string; completedAt: string } | null;
  lifts: LiftCompare[];
  /** The mean change across this session's lifts that have one. */
  averagePct: number | null;
}

function meanPct(lifts: LiftCompare[]): number | null {
  return mean(lifts.map((l) => l.pct).filter((p): p is number => p != null));
}

/** Each set in a session, grouped by lift, in the order the lifts were done. */
function liftsIn(data: CoachData, sessionId: string): Map<string, CoachSet[]> {
  const out = new Map<string, CoachSet[]>();
  const sets = data.sets
    .filter((s) => s.sessionId === sessionId)
    .sort((a, b) => (a.completedAt < b.completedAt ? -1 : 1));
  for (const s of sets) out.set(s.normalizedName, [...(out.get(s.normalizedName) ?? []), s]);
  return out;
}

/**
 * How far back each session is set against. Unset: the last time it was
 * done. A number of weeks: the same session that many weeks back — on a
 * rotating plan only whole rotations make sense, see lookBackOptions.
 * 'start': the first time it was done on this plan.
 */
export type LookBack = number | 'start';

const DAY = 86_400_000;

/** The earlier session a session is set against, or undefined. */
function comparisonFor(
  data: CoachData,
  session: CoachSession,
  lookBack?: LookBack,
  planStart?: string | null,
): CoachSession | undefined {
  const earlier = data.sessions
    .filter((s) => s.dayName === session.dayName && s.completedAt < session.completedAt)
    .sort((a, b) => (a.completedAt < b.completedAt ? 1 : -1));
  if (lookBack == null) return earlier[0];
  if (lookBack === 'start') {
    const onPlan = planStart ? earlier.filter((s) => s.completedAt >= planStart) : earlier;
    return onPlan[onPlan.length - 1];
  }
  // Half a week's grace, so a session done on a Tuesday instead of a Monday
  // still counts as the one two weeks back.
  const cutoff = new Date(session.completedAt).getTime() - (lookBack * 7 - 3.5) * DAY;
  return earlier.find((s) => new Date(s.completedAt).getTime() <= cutoff);
}

/**
 * The look-backs worth offering for a week: whole rotations (every two weeks
 * on a two-week plan, since three weeks back is the other half of it), as far
 * back as the plan has been running — or twelve weeks without a plan.
 */
export function lookBackOptions(rotationWeeks: number, planStart: string | null, weekStart: Date): number[] {
  const step = rotationWeeks >= 2 ? rotationWeeks : 1;
  const max = planStart
    ? Math.floor((weekStart.getTime() - mondayOf(new Date(planStart)).getTime()) / (7 * DAY) + 0.5)
    : 12;
  const out: number[] = [];
  for (let w = step; w <= max; w += step) out.push(w);
  return out.length > 0 ? out : [step];
}

export function compareSessions(
  data: CoachData,
  sessions: CoachSession[],
  lookBack?: LookBack,
  planStart?: string | null,
): SessionCompare[] {
  return [...sessions]
    .sort((a, b) => (a.completedAt < b.completedAt ? -1 : 1))
    .map((session) => {
      const before = comparisonFor(data, session, lookBack, planStart);
      const now = liftsIn(data, session.id);
      const then = before ? liftsIn(data, before.id) : new Map<string, CoachSet[]>();
      const lifts: LiftCompare[] = [...now.entries()].map(([normalizedName, sets]) => {
        const current = topSet(sets);
        const previous = topSet(then.get(normalizedName) ?? []);
        const raw = current && previous ? topSetChangePct(previous, current) : null;
        const suspect = raw != null && Math.abs(raw) > SUSPECT_PCT;
        return {
          normalizedName,
          displayName: sets[sets.length - 1].displayName,
          bodyPart: sets[0].bodyPart,
          current,
          previous,
          pct: suspect ? null : raw,
          suspect,
        };
      });
      return {
        sessionId: session.id,
        dayName: session.dayName,
        completedAt: session.completedAt,
        previous: before ? { sessionId: before.id, completedAt: before.completedAt } : null,
        lifts,
        averagePct: meanPct(lifts),
      };
    });
}

/** One lift's best set, session by session, oldest first. */
export interface LiftPoint {
  sessionId: string;
  dayName: string;
  /** yyyy-mm-dd of the session. */
  date: string;
  completedAt: string;
  top: TopSet | null;
  sets: { weightKg: number | null; reps: number | null }[];
}

/**
 * One lift's history. Given a session name, only the times it was done in
 * that session — on a rotating plan Push 1 and Push 2 load the same lift
 * differently, and a line through both zigzags between them.
 */
export function liftHistory(data: CoachData, normalizedName: string, dayName?: string): LiftPoint[] {
  const sessions = new Map(data.sessions.map((s) => [s.id, s]));
  const bySession = new Map<string, CoachSet[]>();
  for (const s of data.sets) {
    if (s.normalizedName !== normalizedName) continue;
    const session = sessions.get(s.sessionId);
    if (!session || (dayName != null && session.dayName !== dayName)) continue;
    bySession.set(s.sessionId, [...(bySession.get(s.sessionId) ?? []), s]);
  }
  return [...bySession.entries()]
    .map(([sessionId, rows]) => {
      const ordered = rows.sort((a, b) => (a.completedAt < b.completedAt ? -1 : 1));
      return {
        sessionId,
        dayName: sessions.get(sessionId)!.dayName,
        date: dayKey(new Date(ordered[0].completedAt)),
        completedAt: ordered[0].completedAt,
        top: topSet(ordered),
        sets: ordered.map((r) => ({ weightKg: r.weight, reps: r.reps })),
      };
    })
    .sort((a, b) => (a.completedAt < b.completedAt ? -1 : 1));
}

/** The sessions a lift has been done in, most recently done first. */
export function liftSessionNames(data: CoachData, normalizedName: string): string[] {
  const last = new Map<string, string>();
  for (const p of liftHistory(data, normalizedName)) last.set(p.dayName, p.completedAt);
  return [...last.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([name]) => name);
}

/** First best set in a history against the last, as a percentage. */
export function historyChangePct(history: LiftPoint[]): number | null {
  const scored = history.filter((p) => p.top != null);
  if (scored.length < 2) return null;
  return topSetChangePct(scored[0].top!, scored[scored.length - 1].top!);
}

// ---- Weeks in a row --------------------------------------------------------

export interface TrendWeek {
  weekStart: string;
  workouts: number;
  sets: number;
  volumeKg: number;
  weightKg: number | null;
  water: number | null;
  steps: number | null;
  sleepHours: number | null;
  feel: number | null;
}

/** `weeks` weeks ending with the one starting `lastWeekStart`, oldest first. */
export function weeklyTrends(data: CoachData, lastWeekStart: Date, weeks = 12): TrendWeek[] {
  const out: TrendWeek[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = addDays(lastWeekStart, -7 * i);
    const span = fullWeek(start);
    const s = weekSummary(data, span);
    out.push({
      weekStart: dayKey(start),
      workouts: gymSessionCount(data, span),
      sets: s.totalSets,
      volumeKg: s.totalVolume,
      weightKg: logAverage(data.logs.weights, (r) => r.weight_kg, span),
      water: logAverage(data.logs.water, (r) => r.count, span),
      steps: logAverage(data.logs.steps, (r) => r.steps, span),
      sleepHours: logAverage(data.logs.sleep, (r) => r.hours, span, false),
      feel: ratingAverages(sessionsIn(data, span)).score,
    });
  }
  return out;
}

// ---- One body part ---------------------------------------------------------

export interface BodyPartWeek {
  weekStart: string;
  sets: number;
  volumeKg: number;
  /** The heaviest set of the week for this part, the most reps breaking a tie. */
  best: { exercise: string; weightKg: number; reps: number } | null;
}

export interface BodyPartExercise {
  normalizedName: string;
  displayName: string;
  /** The session this history comes from — see liftHistory. */
  dayName: string;
  history: LiftPoint[];
  /** Best-set change from the first session in the window to the last. */
  changePct: number | null;
  lastDate: string | null;
}

export interface BodyPartDetail {
  bodyPart: string;
  weeks: BodyPartWeek[];
  exercises: BodyPartExercise[];
}

/** Every body part the athlete has logged a set against, most sets first. */
export function bodyPartsTrained(data: CoachData): string[] {
  const counts = new Map<string, number>();
  for (const s of data.sets) {
    const part = s.bodyPart?.trim() || 'Other';
    counts.set(part, (counts.get(part) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([p]) => p);
}

export function bodyPartDetail(
  data: CoachData,
  bodyPart: string,
  lastWeekStart: Date,
  weeks = 12,
): BodyPartDetail {
  const matches = (s: CoachSet) => (s.bodyPart?.trim() || 'Other') === bodyPart;
  const partSets = data.sets.filter(matches);
  const from = addDays(lastWeekStart, -7 * (weeks - 1));
  const to = addDays(lastWeekStart, 7);

  const out: BodyPartWeek[] = [];
  for (let i = 0; i < weeks; i++) {
    const start = addDays(from, 7 * i);
    const end = addDays(start, 7);
    let sets = 0;
    let volumeKg = 0;
    let best: BodyPartWeek['best'] = null;
    for (const s of partSets) {
      if (!inRange(s.completedAt, start, end)) continue;
      sets += 1;
      if (s.weight == null || s.reps == null) continue;
      volumeKg += s.weight * s.reps;
      if (!best || s.weight > best.weightKg || (s.weight === best.weightKg && s.reps > best.reps)) {
        best = { exercise: s.displayName, weightKg: s.weight, reps: s.reps };
      }
    }
    out.push({ weekStart: dayKey(start), sets, volumeKg, best });
  }

  // One entry per lift per session it's done in, each its own history.
  const inWindow = { ...data, sets: partSets.filter((s) => inRange(s.completedAt, from, to)) };
  const sessionNames = new Map(data.sessions.map((s) => [s.id, s.dayName]));
  const pairs = new Map<string, { normalizedName: string; displayName: string; dayName: string }>();
  for (const s of [...inWindow.sets].sort((a, b) => (a.completedAt < b.completedAt ? -1 : 1))) {
    const dayName = sessionNames.get(s.sessionId);
    if (dayName == null) continue;
    pairs.set(`${s.normalizedName}|${dayName}`, { normalizedName: s.normalizedName, displayName: s.displayName, dayName });
  }
  const exercises: BodyPartExercise[] = [...pairs.values()].map(({ normalizedName, displayName, dayName }) => {
    const history = liftHistory(inWindow, normalizedName, dayName);
    return {
      normalizedName,
      displayName,
      dayName,
      history,
      changePct: historyChangePct(history),
      lastDate: history.length > 0 ? history[history.length - 1].date : null,
    };
  });
  // Most recently trained first: what's in the plan now, before what was.
  exercises.sort(
    (a, b) =>
      (b.lastDate ?? '').localeCompare(a.lastDate ?? '') ||
      a.displayName.localeCompare(b.displayName) ||
      a.dayName.localeCompare(b.dayName),
  );
  return { bodyPart, weeks: out, exercises };
}

// ---- One lift, one session -------------------------------------------------

export function exerciseDetail(
  data: CoachData,
  normalizedName: string,
  dayName?: string,
): {
  displayName: string;
  history: LiftPoint[];
  bodyPart: string | null;
} {
  const sets = data.sets.filter((s) => s.normalizedName === normalizedName);
  const latest = [...sets].sort((a, b) => (a.completedAt < b.completedAt ? 1 : -1))[0];
  return {
    displayName: latest?.displayName ?? normalizedName,
    history: liftHistory(data, normalizedName, dayName),
    bodyPart: latest?.bodyPart ?? null,
  };
}

export interface SessionDetail {
  session: CoachSession;
  exercises: { normalizedName: string; displayName: string; bodyPart: string | null; sets: CoachSet[] }[];
  setCount: number;
  volumeKg: number;
}

export function sessionDetail(data: CoachData, sessionId: string): SessionDetail | null {
  const session = data.sessions.find((s) => s.id === sessionId);
  if (!session) return null;
  const sets = data.sets
    .filter((s) => s.sessionId === sessionId)
    .sort((a, b) => (a.completedAt < b.completedAt ? -1 : 1));
  const byName = new Map<string, SessionDetail['exercises'][number]>();
  for (const s of sets) {
    let ex = byName.get(s.normalizedName);
    if (!ex) {
      ex = { normalizedName: s.normalizedName, displayName: s.displayName, bodyPart: s.bodyPart, sets: [] };
      byName.set(s.normalizedName, ex);
    }
    ex.sets.push(s);
  }
  return {
    session,
    exercises: [...byName.values()],
    setCount: sets.length,
    volumeKg: sets.reduce((sum, s) => sum + (s.weight != null && s.reps != null ? s.weight * s.reps : 0), 0),
  };
}

/** The latest completed session, for "last trained". */
export function lastSessionAt(data: CoachData): string | null {
  let latest: string | null = null;
  for (const s of data.sessions) if (!latest || s.completedAt > latest) latest = s.completedAt;
  return latest;
}
