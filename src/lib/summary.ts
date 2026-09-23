// One or two sentences about a workout, or about a week of them.
//
// Strava writes these with a model. Reps writes them from templates, because
// the facts are few and already worked out elsewhere — records, volume against
// last time, the week's count, the streak — and a sentence built from them can
// only ever say what's true. It also works in a basement gym with no signal,
// which is where the finish screen is usually read.
//
// The voice is the app's: plain, specific, a number wherever there is one. No
// exclamation marks and nothing that praises without saying what for — "you
// crushed it" is exactly the line this replaces. scripts/test-summary.mjs
// holds every template to that.
//
// Each fact has a few phrasings, chosen by a seed (the session or the week), so
// the same workout always reads the same way and different ones read
// differently. Everything is pure; the screens gather the facts.

import {
  compareWeeks,
  comparisonWeek,
  rotationWeekOf,
  weekStartISO,
  type PlanSession,
  type StrengthSet,
} from './dashboard';

/** Formats a weight in kg for a sentence in the user's unit: 32.5 → "32.5 kg". */
export type WeightFormat = (kg: number) => string;

// --- Session ---------------------------------------------------------------------

export interface SessionBest {
  exercise: string;
  kg: number;
  reps: number;
  /** Heaviest before today. Null: never done before. Undefined: not known (offline). */
  previousBestKg?: number | null;
}

export interface SessionFacts {
  /** The day as the user knows it, without a rotation suffix: "Push 1". */
  dayName: string;
  setsLogged: number;
  durationMinutes: number | null;
  totalKg: number;
  /** Volume last time this day was trained. Null: first time. Undefined: not known. */
  previousTotalKg?: number | null;
  /** Heaviest set per movement, heaviest first. */
  bests: SessionBest[];
}

/** Below this, a change in volume is logging noise rather than a heavier session. */
const VOLUME_NOISE_PCT = 3;

interface Candidate {
  priority: number;
  sentences: string[];
}

/**
 * The line under the headline on the finish screen. Null when there's nothing
 * logged to talk about.
 */
export function sessionLine(
  facts: SessionFacts,
  opts: { seed: string; weight: WeightFormat },
): string | null {
  if (facts.setsLogged === 0) return null;
  const { seed, weight } = opts;
  const day = facts.dayName;
  const candidates: Candidate[] = [];

  const newBests = facts.bests.filter(
    (b) => typeof b.previousBestKg === 'number' && b.kg > b.previousBestKg,
  );
  if (newBests.length === 1) {
    const [b] = newBests;
    candidates.push({
      priority: 100,
      sentences: [
        `New best on ${mid(b.exercise)}: ${weight(b.kg)} for ${reps(b.reps)}.`,
        `${weight(b.kg)} on ${mid(b.exercise)}, the most you’ve lifted on it.`,
        `Your heaviest ${mid(b.exercise)} yet, at ${weight(b.kg)}.`,
      ],
    });
  } else if (newBests.length === 2) {
    const [a, b] = newBests;
    candidates.push({
      priority: 100,
      sentences: [
        `Two new bests: ${weight(a.kg)} on ${mid(a.exercise)} and ${weight(b.kg)} on ${mid(b.exercise)}.`,
        `New bests on ${mid(a.exercise)} and ${mid(b.exercise)}, at ${weight(a.kg)} and ${weight(b.kg)}.`,
      ],
    });
  } else if (newBests.length > 2) {
    const [a] = newBests;
    candidates.push({
      priority: 100,
      sentences: [
        `${cap(count(newBests.length))} new bests, led by ${weight(a.kg)} on ${mid(a.exercise)}.`,
        `New bests on ${count(newBests.length)} lifts, the biggest ${weight(a.kg)} on ${mid(a.exercise)}.`,
      ],
    });
  }

  if (facts.previousTotalKg === null) {
    candidates.push({
      priority: 80,
      sentences: [
        `Your first ${day} session, so these are the numbers to beat next time.`,
        `First ${day} session done, so next time there’s something to beat.`,
      ],
    });
  } else if (typeof facts.previousTotalKg === 'number' && facts.previousTotalKg > 0) {
    const pct = Math.round(((facts.totalKg - facts.previousTotalKg) / facts.previousTotalKg) * 100);
    if (pct >= VOLUME_NOISE_PCT) {
      candidates.push({
        priority: 60,
        sentences: [
          `${pct}% more volume than your last ${day}.`,
          `Volume up ${pct}% on your last ${day}.`,
          `You moved ${pct}% more weight than last ${day}.`,
        ],
      });
    } else if (pct <= -VOLUME_NOISE_PCT) {
      candidates.push({
        priority: 20,
        sentences: [
          `A lighter ${day} than last time, with ${-pct}% less volume.`,
          `Volume came in ${-pct}% under your last ${day}.`,
        ],
      });
    } else {
      candidates.push({
        priority: 30,
        sentences: [
          `Volume level with your last ${day}.`,
          `About the same volume as your last ${day}.`,
        ],
      });
    }
  }

  candidates.push({
    priority: 10,
    sentences:
      facts.durationMinutes != null && facts.durationMinutes > 0
        ? [
            `${cap(count(facts.setsLogged))} sets in ${facts.durationMinutes} minutes.`,
            `${cap(count(facts.setsLogged))} sets logged in ${facts.durationMinutes} minutes.`,
          ]
        : [`${cap(count(facts.setsLogged))} sets logged.`],
  });

  return compose(candidates, seed);
}

// --- Week ------------------------------------------------------------------------

export interface WeekMover {
  name: string;
  deltaKg: number;
  currentKg: number;
  currentReps: number;
  previousReps: number;
}

export interface WeekFacts {
  /** The week in progress, or the one before it when nothing's been done yet. */
  which: 'this' | 'last';
  /** Monday of the week described, yyyy-mm-dd. */
  weekStart: string;
  workouts: number;
  /** Workouts the plan asks for in a week; 0 when there's no plan. */
  target: number;
  /** Consecutive weeks on target, including this one if it's already there. */
  streak: number;
  /** Null when there's no earlier week to compare with. */
  comparison: null | {
    /** The rotation week both ran; null for a plan that doesn't rotate. */
    weekIndex: number | null;
    weeksBack: number;
    workouts: number;
    previousWorkouts: number;
    volumeKg: number;
    previousVolumeKg: number;
    /** The lift that gained most, if any did. */
    topMover: WeekMover | null;
    /** Lifts trained in both weeks, and how many of them went up or down. */
    lifts: number;
    heavier: number;
    lighter: number;
  };
  /** The rotation week this one ran, for the first-time line. */
  weekIndex: number | null;
}

/** A mover under this is logging noise, the same threshold the movers list uses. */
const MOVER_NOISE_PCT = 1;

/**
 * Gather the facts for the week card.
 *
 * The week described is this one once anything's been done in it, and last
 * week until then — a card that says "nothing yet" every Monday morning is
 * one nobody reads. Null when neither has a workout in it.
 *
 * `sessions` should be the gym sessions only: a home workout that's read
 * rather than logged doesn't count towards the target, so it doesn't count
 * here either.
 */
export function buildWeekFacts(input: {
  sets: StrengthSet[];
  sessions: PlanSession[];
  planId: string | null;
  target: number;
  /** Current run of weeks on target, as computeWeekStreak gives it. */
  streak: number;
  now?: Date;
}): WeekFacts | null {
  const now = input.now ?? new Date();
  const countIn = (d: Date) => {
    const key = weekStartISO(d);
    return input.sessions.filter((s) => weekStartISO(new Date(s.completed_at)) === key).length;
  };

  let which: 'this' | 'last' = 'this';
  let weekOf = now;
  if (countIn(now) === 0) {
    which = 'last';
    weekOf = new Date(now);
    weekOf.setDate(weekOf.getDate() - 7);
    if (countIn(weekOf) === 0) return null;
  }
  const workouts = countIn(weekOf);

  let comparison: WeekFacts['comparison'] = null;
  const against = comparisonWeek(input.sessions, input.planId, weekOf);
  if (against) {
    const cmp = compareWeeks(input.sets, input.sessions, against.weeksBack, weekOf);
    const top = cmp.movers[0];
    comparison = {
      weekIndex: against.weekIndex,
      weeksBack: against.weeksBack,
      workouts: cmp.current.workouts,
      previousWorkouts: cmp.previous.workouts,
      volumeKg: cmp.current.volumeKg,
      previousVolumeKg: cmp.previous.volumeKg,
      topMover:
        top && top.deltaPct > MOVER_NOISE_PCT
          ? {
              name: top.displayName,
              deltaKg: top.deltaKg,
              currentKg: top.currentKg,
              currentReps: top.currentReps,
              previousReps: top.previousReps,
            }
          : null,
      lifts: cmp.movers.length,
      heavier: cmp.heavier,
      lighter: cmp.lighter,
    };
  }

  // A week still short of its target isn't part of the run yet, so "that's
  // four weeks in a row" would be claiming it early.
  const onTarget = input.target > 0 && workouts >= input.target;
  return {
    which,
    weekStart: weekStartISO(weekOf),
    workouts,
    target: input.target,
    streak: which === 'this' && !onTarget ? 0 : input.streak,
    comparison,
    weekIndex: rotationWeekOf(input.sessions, input.planId, weekOf),
  };
}

/** What the week is being compared with, in words: the card's header uses this too. */
export function comparisonLabel(facts: WeekFacts): string | null {
  const c = facts.comparison;
  if (!c) return null;
  if (c.weekIndex != null) return `vs week ${c.weekIndex} last time`;
  if (c.weeksBack === 1) return facts.which === 'this' ? 'vs last week' : 'vs the week before';
  return `vs ${count(c.weeksBack)} weeks earlier`;
}

function comparisonRef(facts: WeekFacts): string {
  const c = facts.comparison!;
  if (c.weekIndex != null) return `the last time you ran week ${c.weekIndex}`;
  if (c.weeksBack === 1) return facts.which === 'this' ? 'last week' : 'the week before';
  return 'your last week of training';
}

/** The body of the week card. Null when the week has nothing in it. */
export function weekLine(facts: WeekFacts, opts: { seed: string; weight: WeightFormat }): string | null {
  if (facts.workouts === 0) return null;
  const { seed, weight } = opts;
  const c = facts.comparison;

  // Sentence one: how much of the week was done, and how heavy it was.
  const done =
    facts.target > 0 && facts.workouts >= facts.target
      ? pick([`All ${count(facts.target)} workouts done`, `Every workout done, ${facts.target} of ${facts.target}`], seed + ':done')
      : facts.target > 0
        ? pick(
            facts.which === 'this'
              ? [`${cap(count(facts.workouts))} of ${count(facts.target)} workouts so far`, `${cap(count(facts.workouts))} ${plural(facts.workouts, 'workout')} of ${count(facts.target)} done`]
              : [`${cap(count(facts.workouts))} of ${count(facts.target)} workouts`, `${cap(count(facts.workouts))} ${plural(facts.workouts, 'workout')} of ${count(facts.target)}`],
            seed + ':done',
          )
        : `${cap(count(facts.workouts))} ${plural(facts.workouts, 'workout')}`;

  // A week still in progress has done less than a finished one by definition,
  // so its volume is only compared once it has caught up on workouts.
  let volume: string | null = null;
  const comparable = c && c.previousVolumeKg > 0 && (facts.which === 'last' || c.workouts >= c.previousWorkouts);
  if (c && comparable) {
    const pct = Math.round(((c.volumeKg - c.previousVolumeKg) / c.previousVolumeKg) * 100);
    const ref = comparisonRef(facts);
    volume =
      pct >= VOLUME_NOISE_PCT
        ? pick([`${pct}% more volume than ${ref}`, `volume up ${pct}% on ${ref}`], seed + ':vol')
        : pct <= -VOLUME_NOISE_PCT
          ? pick([`${-pct}% less volume than ${ref}`, `volume ${-pct}% down on ${ref}`], seed + ':vol')
          : `about the same volume as ${ref}`;
  }
  const lead = facts.which === 'last' ? 'Last week: ' : '';
  const first = `${lead}${facts.which === 'last' ? lower(done) : done}${volume ? `, and ${volume}` : ''}.`;

  // Sentence two: the most interesting thing left.
  let second: string | null = null;
  const m = c?.topMover;
  if (!c) {
    second =
      facts.weekIndex != null
        ? `Your first time through week ${facts.weekIndex} on this plan, so these are the numbers to beat.`
        : 'Your first week on this plan, so these are the numbers to beat.';
  } else if (m && m.deltaKg > 0) {
    second = pick(
      [
        `${capName(m.name)} moved most, with your top set up ${weight(m.deltaKg)}.`,
        `Biggest gain: ${mid(m.name)}, ${weight(m.deltaKg)} heavier on your top set.`,
        `${capName(m.name)} led the way, up ${weight(m.deltaKg)} on your top set.`,
      ],
      seed + ':mover',
    );
  } else if (m && m.deltaKg === 0 && m.currentReps > m.previousReps) {
    const extra = m.currentReps - m.previousReps;
    second = `${capName(m.name)} moved most: ${count(extra)} more ${plural(extra, 'rep')} at ${weight(m.currentKg)}.`;
  } else if (facts.streak >= 2) {
    second = pick(
      [`That’s ${count(facts.streak)} weeks in a row on target.`, `${cap(count(facts.streak))} weeks running at your full target.`],
      seed + ':streak',
    );
  } else if (comparable && c.lifts > 0 && c.heavier === 0 && c.lighter === 0) {
    // Only once the week has caught up: mid-week, most lifts haven't been
    // done yet, and "held" would be describing the ones that happened to be.
    second = 'Your lifts held where they were.';
  }

  return second ? `${first} ${second}` : first;
}

// --- Composition and wording -----------------------------------------------------

/** The two most important facts, one sentence each. */
function compose(candidates: Candidate[], seed: string): string {
  const ranked = [...candidates].sort((a, b) => b.priority - a.priority).slice(0, 2);
  return ranked.map((c, i) => pick(c.sentences, `${seed}:${i}:${c.priority}`)).join(' ');
}

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

/** Small counts read better as words; larger ones as figures. */
export function count(n: number): string {
  return Number.isInteger(n) && n >= 0 && n < WORDS.length ? WORDS[n] : String(n);
}

function reps(n: number): string {
  return `${n} ${plural(n, 'rep')}`;
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function lower(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/**
 * An exercise name in the middle of a sentence. Names are stored in sentence
 * case — "Incline DB press" — so the first letter comes down, unless the first
 * word is an abbreviation ("DB row", "EZ bar curl") that has to stay up.
 */
export function mid(name: string): string {
  const first = name.split(/\s+/)[0] ?? '';
  if (first.length > 1 && first === first.toUpperCase() && /[A-Z]/.test(first)) return name;
  return lower(name);
}

/** An exercise name starting a sentence. */
function capName(name: string): string {
  return cap(name);
}

function pick<T>(pool: T[], seed: string): T {
  return pool[hash(seed) % pool.length];
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h;
}
