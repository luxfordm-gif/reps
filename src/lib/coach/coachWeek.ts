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

import {
  averageChange,
  dayKey,
  DOWN_PCT,
  isSuspect,
  liftChanges,
  type LiftChange,
} from '../coachSummary';
import { RATING_QUESTIONS, type CheckIn, type RatingKey } from '../checkin';
import { estimate1RM } from '../oneRepMax';
import { buildExerciseHistory, type ExerciseHistoryPoint, type PerfSet } from '../performanceApi';
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
  /** Mean estimated-1RM change across this part's lifts done in both weeks. */
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
  /** Lifts done in both weeks, biggest gain first, with slips kept apart. */
  lifts: LiftChange[];
  suspectLifts: LiftChange[];
  /** Lifts done this week that weren't done in the comparison week. */
  newLifts: WeeklyWorkoutSummary['exerciseBests'];
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

  const allChanges = liftChanges(current, previous);
  const lifts = allChanges.filter((c) => !isSuspect(c)).sort((a, b) => b.pct - a.pct);
  const suspectLifts = allChanges.filter(isSuspect);
  const before = new Set(previous.exerciseBests.map((e) => e.normalizedName));
  const newLifts = current.exerciseBests.filter((e) => !before.has(e.normalizedName));

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
    const partLifts = lifts.filter((c) => (c.cur.bodyPart ?? 'Other') === name);
    return {
      bodyPart: name,
      sets: { current: cur?.setCount ?? 0, previous: prev?.setCount ?? 0 },
      volumeKg: { current: cur?.volume ?? 0, previous: prev?.volume ?? 0 },
      strengthPct: averageChange(partLifts),
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
    lifts,
    suspectLifts,
    newLifts,
    strengthPct: averageChange(allChanges),
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
  const down = w.lifts.filter((c) => c.pct <= -DOWN_PCT);
  if (down.length > 0) {
    flags.push({
      key: 'down',
      tone: 'warn',
      text:
        down.length === 1
          ? `${down[0].cur.displayName} down ${Math.abs(Math.round(down[0].pct))}%`
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
  if (w.suspectLifts.length > 0) {
    flags.push({
      key: 'suspect',
      tone: 'note',
      text:
        w.suspectLifts.length === 1
          ? `${w.suspectLifts[0].cur.displayName} jumped too far to compare`
          : `${w.suspectLifts.length} lifts jumped too far to compare`,
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
  /** The heaviest set of the week for this part, by estimated 1RM. */
  best: { exercise: string; weightKg: number; reps: number } | null;
}

export interface BodyPartExercise {
  normalizedName: string;
  displayName: string;
  history: ExerciseHistoryPoint[];
  /** Estimated-1RM change from the first session in the window to the last. */
  changePct: number | null;
  lastDate: string | null;
}

export interface BodyPartDetail {
  bodyPart: string;
  weeks: BodyPartWeek[];
  exercises: BodyPartExercise[];
}

export function toPerfSets(sets: CoachSet[]): PerfSet[] {
  return [...sets]
    .sort((a, b) => (a.completedAt < b.completedAt ? -1 : 1))
    .map((s) => ({
      displayName: s.displayName,
      normalizedName: s.normalizedName,
      weight: s.weight,
      reps: s.reps,
      completedAt: s.completedAt,
      bodyPart: s.bodyPart,
    }));
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
    let bestE = 0;
    for (const s of partSets) {
      if (!inRange(s.completedAt, start, end)) continue;
      sets += 1;
      if (s.weight == null || s.reps == null) continue;
      volumeKg += s.weight * s.reps;
      const e = estimate1RM(s.weight, s.reps);
      if (e > bestE) {
        bestE = e;
        best = { exercise: s.displayName, weightKg: s.weight, reps: s.reps };
      }
    }
    out.push({ weekStart: dayKey(start), sets, volumeKg, best });
  }

  const inWindow = toPerfSets(partSets.filter((s) => inRange(s.completedAt, from, to)));
  const names = new Map<string, string>();
  for (const s of inWindow) names.set(s.normalizedName, s.displayName);
  const exercises: BodyPartExercise[] = [...names.entries()].map(([normalizedName, displayName]) => {
    const history = buildExerciseHistory(inWindow, normalizedName);
    return {
      normalizedName,
      displayName,
      history,
      changePct: e1rmChange(history),
      lastDate: history.length > 0 ? history[history.length - 1].date : null,
    };
  });
  // Most recently trained first: what's in the plan now, before what was.
  exercises.sort(
    (a, b) =>
      (b.lastDate ?? '').localeCompare(a.lastDate ?? '') || a.displayName.localeCompare(b.displayName),
  );
  return { bodyPart, weeks: out, exercises };
}

function e1rmChange(history: ExerciseHistoryPoint[]): number | null {
  const scored = history.filter((p) => p.bestEst1RMkg != null && p.bestEst1RMkg > 0);
  if (scored.length < 2) return null;
  const first = scored[0].bestEst1RMkg!;
  const last = scored[scored.length - 1].bestEst1RMkg!;
  return ((last - first) / first) * 100;
}

// ---- One lift, one session -------------------------------------------------

export function exerciseDetail(data: CoachData, normalizedName: string): {
  displayName: string;
  history: ExerciseHistoryPoint[];
  bodyPart: string | null;
} {
  const sets = data.sets.filter((s) => s.normalizedName === normalizedName);
  const latest = [...sets].sort((a, b) => (a.completedAt < b.completedAt ? 1 : -1))[0];
  return {
    displayName: latest?.displayName ?? normalizedName,
    history: buildExerciseHistory(toPerfSets(sets), normalizedName),
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
