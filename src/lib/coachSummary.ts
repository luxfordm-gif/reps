// The weekly summary a user copies from Profile and pastes to their coach.
//
// It's read on a phone, in a messaging app, by someone with several clients:
// so it's plain text rather than markdown (asterisks show up as asterisks in
// most of the places it's pasted), and it answers four questions in order —
// did they train, are they getting stronger, how did it feel, and what moved
// most. Anything the coach wants beyond that, they'll ask.

import type { ExerciseWeekBest, WeeklyWorkoutSummary } from './sessionsApi';
import { formatStoneLb, kgToLb, type BodyWeightUnit } from './units';
import {
  RATING_MAX,
  RATING_MIN,
  averagesLine,
  isCheckInEmpty,
  ratingsLine,
  type CheckInExportRow,
} from './checkin';

export interface CoachSummaryInput {
  /** The user's display name, if they gave one. Only the first word is used. */
  name: string | null;
  current: WeeklyWorkoutSummary;
  /** The week before. Null when nothing was ever logged before `current`. */
  lastWeek: WeeklyWorkoutSummary | null;
  /** On a plan that rotates over several weeks, the week the same sessions
   *  were last done — two weeks back on a two-week plan. Last week's sessions
   *  were different ones there, so this is the like-for-like comparison. */
  rotation?: { weeksBack: number; week: WeeklyWorkoutSummary } | null;
  /** The week's end-of-workout check-ins, in date order. */
  checkIns?: CheckInExportRow[];
  /** Body weight, water and steps as daily averages, this week and last. */
  body?: {
    current: DailyAverages;
    lastWeek: DailyAverages | null;
    bodyWeightUnit: BodyWeightUnit;
    /** What a unit of water is called: bottles, glasses, cups or L. */
    waterUnit: string;
  };
  /** Formats a weight in kg in the user's lift unit, e.g. "82.5 kg". */
  weight: (kg: number) => string;
}

/** A week's daily logs averaged over the days that have one; null where none do. */
export interface DailyAverages {
  weightKg: number | null;
  waterPerDay: number | null;
  stepsPerDay: number | null;
}

export interface DailyLogs {
  weights: { recorded_on: string; weight_kg: number }[];
  water: { recorded_on: string; count: number }[];
  steps: { recorded_on: string; steps: number }[];
}

/** yyyy-mm-dd in local time, the way the daily logs are keyed. */
export function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Averages over the seven days from `weekStart`, each over the days logged. */
export function dailyAverages(logs: DailyLogs, weekStart: Date): DailyAverages {
  const days = new Set<string>();
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    days.add(dayKey(d));
  }
  const mean = (values: number[]) =>
    values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;
  return {
    weightKg: mean(logs.weights.filter((r) => days.has(r.recorded_on)).map((r) => r.weight_kg)),
    waterPerDay: mean(logs.water.filter((r) => days.has(r.recorded_on)).map((r) => r.count)),
    stepsPerDay: mean(logs.steps.filter((r) => days.has(r.recorded_on)).map((r) => r.steps)),
  };
}

/** How many lifts each "Top lifts" list names. */
export const TOP_LIFTS = 6;
/** How many drops a list names after the gains. */
export const DOWN_LIFTS = 3;
/** A lift down by at least this much is worth telling the coach. */
export const DOWN_PCT = 5;
/** A change this large in a week or two isn't training: it's a different
 *  machine (pin stack one week, plates the next) or a logging slip. Either
 *  way the two sets aren't comparable, so the lift is kept out of the average
 *  and named instead. */
export const SUSPECT_PCT = 50;

export interface LiftChange {
  cur: ExerciseWeekBest;
  prev: ExerciseWeekBest;
  /** Change in estimated 1RM, as a percentage of the earlier week's. */
  pct: number;
}

/** Every lift done in both weeks, with its change in estimated 1RM. */
export function liftChanges(current: WeeklyWorkoutSummary, earlier: WeeklyWorkoutSummary): LiftChange[] {
  const before = new Map(earlier.exerciseBests.map((e) => [e.normalizedName, e]));
  const out: LiftChange[] = [];
  for (const cur of current.exerciseBests) {
    const prev = before.get(cur.normalizedName);
    if (!prev || prev.bestE1RMkg <= 0 || cur.bestE1RMkg <= 0) continue;
    out.push({ cur, prev, pct: ((cur.bestE1RMkg - prev.bestE1RMkg) / prev.bestE1RMkg) * 100 });
  }
  return out;
}

export function isSuspect(c: LiftChange): boolean {
  return Math.abs(c.pct) > SUSPECT_PCT;
}

/** The average change across the lifts done in both weeks, suspect entries
 *  left out, or null if none were. */
export function averageChange(changes: LiftChange[]): number | null {
  const sound = changes.filter((c) => !isSuspect(c));
  if (sound.length === 0) return null;
  return sound.reduce((sum, c) => sum + c.pct, 0) / sound.length;
}

export function buildCoachSummary(input: CoachSummaryInput): string {
  const { current, lastWeek, weight } = input;
  const rotation = input.rotation ?? null;
  const rotationWhen = rotation ? `${rotation.weeksBack} weeks ago` : '';
  const first = input.name?.trim().split(/\s+/)[0] || null;
  const set = (e: ExerciseWeekBest) => `${weight(e.topWeightKg)} × ${e.topReps}`;

  const out: string[] = [];
  out.push(`${first ? `${first}'s week` : 'Training week'}, ${weekRange(current.weekStart)}`);
  out.push('');

  // Did they train.
  const n = current.workoutsDone;
  const days = current.sessions.map((s) => `${s.trainingDayName} (${weekday(s.completedAt)})`);
  let trained = `${first ? `${first} trained` : 'Trained'} ${times(n)}`;
  if (days.length > 0) trained += `: ${days.join(', ')}`;
  out.push(`${trained}.`);
  if (lastWeek) out.push(countVersus(n, lastWeek.workoutsDone));
  else out.push('First week logged, so nothing to compare against yet.');

  // Are they getting stronger.
  const vsLast = lastWeek ? liftChanges(current, lastWeek) : [];
  const vsRotation = rotation ? liftChanges(current, rotation.week) : [];
  const strength = strengthLine([
    { pct: averageChange(vsLast), when: 'last week' },
    { pct: averageChange(vsRotation), when: rotationWhen },
  ]);
  if (strength) out.push(strength);

  // How it felt.
  const felt = (input.checkIns ?? []).filter((c) => !isCheckInEmpty(c.checkIn));
  if (felt.length > 0) {
    out.push('');
    out.push(`How it felt (${RATING_MIN} to ${RATING_MAX}, soreness and stress ${RATING_MIN} best)`);
    for (const c of felt) {
      out.push(`${c.dayName}, ${weekday(c.completedAt)}: ${ratingsLine(c.checkIn)}`);
      if (c.note?.trim()) out.push(`  ${c.note.trim()}`);
    }
    const avg = felt.length >= 2 ? averagesLine(felt.map((c) => c.checkIn)) : null;
    if (avg) out.push(`Average: ${avg}`);
  }

  // Weight, water, steps.
  const body = input.body ? bodyLines(input.body) : [];
  if (body.length > 0) {
    out.push('');
    out.push('Body');
    out.push(...body);
  }

  // What moved most.
  if (!lastWeek) {
    const best = current.exerciseBests.slice(0, TOP_LIFTS);
    if (best.length > 0) {
      out.push('');
      out.push('Best sets');
      for (const e of best) out.push(`• ${e.displayName}: ${set(e)}`);
    }
  } else {
    pushTopLifts(out, 'Top lifts vs last week', vsLast, set);
    if (rotation) pushTopLifts(out, `Top lifts vs ${rotationWhen}`, vsRotation, set);
  }

  // Named rather than silently dropped, so a machine change is understood
  // and a slip gets fixed in history instead of skewing next week too.
  const suspects = [...vsLast, ...vsRotation].filter(isSuspect);
  if (suspects.length > 0) {
    out.push('');
    out.push('Not compared, too big a jump to be the same machine');
    const seen = new Set<string>();
    for (const c of suspects) {
      if (seen.has(c.cur.normalizedName)) continue;
      seen.add(c.cur.normalizedName);
      out.push(`• ${c.cur.displayName}: ${set(c.prev)} → ${set(c.cur)}`);
    }
  }

  return out.join('\n').trimEnd() + '\n';
}

function pushTopLifts(
  out: string[],
  heading: string,
  changes: LiftChange[],
  set: (e: ExerciseWeekBest) => string
) {
  const sound = changes.filter((c) => !isSuspect(c));
  if (sound.length === 0) return;
  const up = sound.filter((c) => c.pct >= 0.5).sort((a, b) => b.pct - a.pct);
  const down = sound.filter((c) => c.pct <= -DOWN_PCT).sort((a, b) => a.pct - b.pct);
  out.push('');
  out.push(heading);
  if (up.length === 0 && down.length === 0) {
    out.push('• Nothing up on the same lifts — held steady.');
    return;
  }
  for (const c of up.slice(0, TOP_LIFTS)) {
    out.push(`• ${c.cur.displayName}: ${set(c.prev)} → ${set(c.cur)} (+${Math.round(c.pct)}%)`);
  }
  // The bad news too: a coach reading only gains can't see a lift slipping.
  for (const c of down.slice(0, DOWN_LIFTS)) {
    out.push(`• ${c.cur.displayName} down: ${set(c.prev)} → ${set(c.cur)} (${Math.round(c.pct)}%)`);
  }
}

/** "Weight 84.2 kg average, down 0.4 kg on last week", one line per log kept. */
function bodyLines(body: NonNullable<CoachSummaryInput['body']>): string[] {
  const { current, lastWeek, bodyWeightUnit, waterUnit } = body;
  const out: string[] = [];
  const oneDp = (n: number) => {
    const r = Math.round(n * 10) / 10;
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
  };
  const versus = (now: number, before: number | null | undefined, fmt: (n: number) => string, what: string) => {
    if (before == null) return '';
    const diff = now - before;
    if (Math.abs(diff) < 0.05) return ', same as last week';
    return `, ${diff > 0 ? 'up' : 'down'} ${fmt(Math.abs(diff))}${what} on last week`;
  };

  if (current.weightKg != null) {
    const kg = current.weightKg;
    const shown = bodyWeightUnit === 'st' ? formatStoneLb(kg) : `${oneDp(kg)} kg`;
    const delta = (d: number) => (bodyWeightUnit === 'st' ? `${oneDp(kgToLb(d))} lb` : `${oneDp(d)} kg`);
    out.push(`Weight ${shown} average${versus(kg, lastWeek?.weightKg, delta, '')}`);
  }
  if (current.waterPerDay != null) {
    const n = current.waterPerDay;
    out.push(`Water ${oneDp(n)} ${waterUnit} a day${versus(n, lastWeek?.waterPerDay, oneDp, '')}`);
  }
  if (current.stepsPerDay != null) {
    const n = Math.round(current.stepsPerDay / 100) * 100;
    const steps = (v: number) => (Math.round(v / 100) * 100).toLocaleString('en-GB');
    out.push(`Steps ${steps(n)} a day${versus(n, lastWeek?.stepsPerDay, steps, '')}`);
  }
  return out;
}

function countVersus(now: number, before: number): string {
  if (before === 0) return 'Nothing logged the week before.';
  if (now === before) return `Same as last week.`;
  return `${now > before ? 'Up' : 'Down'} from ${before} last week.`;
}

/** "Strength up 4% on last week" — and on two weeks ago, for a rotating plan. */
function strengthLine(against: { pct: number | null; when: string }[]): string | null {
  const items = against.filter((a): a is { pct: number; when: string } => a.pct != null);
  if (items.length === 0) return null;

  const phrase = ({ pct, when }: { pct: number; when: string }) => {
    const r = Math.round(pct);
    if (r === 0) return `steady on ${when}`;
    return `${r > 0 ? 'up' : 'down'} ${Math.abs(r)}% on ${when}`;
  };
  return `Strength ${items.map(phrase).join(' and ')} (estimated 1RM, same lifts).`;
}

function times(n: number): string {
  if (n === 1) return 'once';
  if (n === 2) return 'twice';
  return `${n} times`;
}

function weekday(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short' });
}

/** "22–28 September", or "29 September – 5 October" across a month end. */
export function weekRange(weekStart: Date): string {
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 6);
  const month = (d: Date) => d.toLocaleDateString('en-GB', { month: 'long' });
  if (month(weekStart) === month(end)) {
    return `${weekStart.getDate()}–${end.getDate()} ${month(end)}`;
  }
  return `${weekStart.getDate()} ${month(weekStart)} – ${end.getDate()} ${month(end)}`;
}
