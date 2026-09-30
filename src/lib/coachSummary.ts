// The weekly summary a user copies from Profile and pastes to their coach.
//
// It's read on a phone, in a messaging app, by someone with several clients:
// so it's plain text rather than markdown (asterisks show up as asterisks in
// most of the places it's pasted), and it answers three questions in order —
// did they train, are they getting stronger, and what moved most. Anything the
// coach wants beyond that, they'll ask.

import type { ExerciseWeekBest, WeeklyWorkoutSummary } from './sessionsApi';

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
  /** Formats a weight in kg in the user's lift unit, e.g. "82.5 kg". */
  weight: (kg: number) => string;
}

/** How many lifts each "Top lifts" list names. */
export const TOP_LIFTS = 3;

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

/** The average change across the lifts done in both weeks, or null if none were. */
export function averageChange(changes: LiftChange[]): number | null {
  if (changes.length === 0) return null;
  return changes.reduce((sum, c) => sum + c.pct, 0) / changes.length;
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

  return out.join('\n').trimEnd() + '\n';
}

function pushTopLifts(
  out: string[],
  heading: string,
  changes: LiftChange[],
  set: (e: ExerciseWeekBest) => string
) {
  if (changes.length === 0) return;
  const up = changes.filter((c) => c.pct >= 0.5).sort((a, b) => b.pct - a.pct);
  out.push('');
  out.push(heading);
  if (up.length === 0) {
    out.push('• Nothing up on the same lifts — held steady.');
    return;
  }
  for (const c of up.slice(0, TOP_LIFTS)) {
    out.push(`• ${c.cur.displayName}: ${set(c.prev)} → ${set(c.cur)} (+${Math.round(c.pct)}%)`);
  }
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
