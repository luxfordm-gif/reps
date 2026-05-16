import type { LoggedSet } from './sessionsApi';

export interface KudosInput {
  thisSets: { setIndex: number; dropIndex: number; weight: string; reps: string; completed: boolean }[];
  lastSets: LoggedSet[];
  repRange: string;
  seed: string;
}

export interface Kudos {
  label: string;
  headline: string;
  detail: string | null;
}

const LABEL_POOL = ['Great work', 'Solid', 'Locked in', 'On the up', 'Strong session', 'Nice'];

const WEIGHT_UP_POOL = [
  '+{kg} kg on your top set. Strong work!',
  'Top set climbed {kg} kg. Heaviest you’ve moved it.',
  '+{kg} kg — the bar keeps going up.',
  'Heaviest top set yet. {kg} kg more than last time.',
];

const REPS_UP_POOL = [
  '+{n} rep{s} vs last time. Keep it up!',
  '{n} extra rep{s} in the bank.',
  'Pushed past last time by {n} rep{s}.',
  '+{n} more rep{s} than last session.',
];

const MATCHED_POOL = [
  'Matched your top set — momentum building.',
  'Same top set as last time — keep the streak going.',
  'Held your top set. Consistency is progress.',
];

const VOLUME_UP_POOL = [
  'Volume up {pct}% — solid session.',
  'Total work up {pct}% on last time.',
  '{pct}% more volume — banking the reps.',
];

const HELD_POOL = [
  'Held the line — same as last time.',
  'Steady session. Same as last time.',
  'On par with last time. Pick a target for next.',
];

const BASELINE_POOL = [
  'Baseline set — beat it next time.',
  'Logged. Now you’ve got a number to chase.',
  'First time on this one. Baseline locked in.',
];

const DEFAULT_POOL = [
  'Logged. Next time, aim for one more rep.',
  'In the books. Push a touch harder next time.',
  'Logged — hunt a rep or a kg next session.',
];

const WEIGHT_UP_REPS_DOWN_POOL = [
  'Reps dipped a touch — the heavier weight more than made up for it.',
  'Good push on the weight. Reps will come back.',
  'Trading reps for weight — fair trade today.',
];

const UNDER_TARGET_POOL = [
  'Good try on the reps, though.',
  'Short of target reps — chase the bottom of the range next time.',
  'Reps came up shy of target. Still in the bank.',
];

export function parseRepRange(repRange: string): { min: number; max: number } | null {
  const m = repRange.match(/^(\d+)\s*-\s*(\d+)$/);
  if (m) return { min: parseInt(m[1], 10), max: parseInt(m[2], 10) };
  const s = repRange.match(/^(\d+)$/);
  if (s) {
    const n = parseInt(s[1], 10);
    return { min: n, max: n };
  }
  return null;
}

export function buildKudos(input: KudosInput): Kudos {
  const { thisSets, lastSets, repRange, seed } = input;
  const label = pick(LABEL_POOL, seed + ':label');

  if (lastSets.length === 0) {
    return { label, headline: pick(BASELINE_POOL, seed + ':baseline'), detail: null };
  }

  const completed = thisSets.filter((s) => s.completed);
  const repPRs: { setIndex: number; delta: number }[] = [];
  let totalLostReps = 0;
  for (const s of completed) {
    const last = lastSets.find(
      (l) => l.set_index === s.setIndex && l.drop_index === s.dropIndex
    );
    const reps = parseInt(s.reps, 10) || 0;
    if (last && last.reps != null) {
      if (reps > last.reps) {
        repPRs.push({ setIndex: s.setIndex, delta: reps - last.reps });
      } else if (reps < last.reps) {
        totalLostReps += last.reps - reps;
      }
    }
  }
  const totalExtraReps = repPRs.reduce((sum, r) => sum + r.delta, 0);

  const lastTop = Math.max(...lastSets.map((l) => l.weight ?? 0), 0);
  const thisTop = Math.max(...completed.map((s) => parseFloat(s.weight) || 0), 0);
  const topDelta = thisTop - lastTop;

  let totalVolume = 0;
  for (const s of completed) {
    totalVolume += (parseFloat(s.weight) || 0) * (parseInt(s.reps, 10) || 0);
  }
  let lastVolume = 0;
  for (const l of lastSets) {
    if (l.weight != null && l.reps != null) lastVolume += l.weight * l.reps;
  }
  const volumePct = lastVolume > 0 ? Math.round(((totalVolume - lastVolume) / lastVolume) * 100) : null;

  // Pick primary positive signal — heaviest weight wins, then reps, then match, then volume.
  let headline: string;
  let primary: 'weightUp' | 'repsUp' | 'matched' | 'volumeUp' | 'held' | 'default';
  if (topDelta > 0) {
    primary = 'weightUp';
    headline = pick(WEIGHT_UP_POOL, seed + ':weightUp').replace('{kg}', fmt(topDelta));
  } else if (totalExtraReps > 0) {
    primary = 'repsUp';
    const s = totalExtraReps === 1 ? '' : 's';
    headline = pick(REPS_UP_POOL, seed + ':repsUp')
      .replace('{n}', String(totalExtraReps))
      .replaceAll('{s}', s);
  } else if (lastTop > 0 && thisTop === lastTop) {
    primary = 'matched';
    headline = pick(MATCHED_POOL, seed + ':matched');
  } else if (volumePct != null && volumePct > 0) {
    primary = 'volumeUp';
    headline = pick(VOLUME_UP_POOL, seed + ':volumeUp').replace('{pct}', String(volumePct));
  } else if (volumePct != null && volumePct === 0) {
    primary = 'held';
    headline = pick(HELD_POOL, seed + ':held');
  } else {
    primary = 'default';
    headline = pick(DEFAULT_POOL, seed + ':default');
  }

  // Pick a complementary secondary line. Acknowledge a second positive, soften a
  // regression, or nudge if reps fell below the coach's target range.
  let detail: string | null = null;
  if (primary === 'weightUp' && totalLostReps > 0) {
    detail = pick(WEIGHT_UP_REPS_DOWN_POOL, seed + ':wuRd');
  } else if (primary === 'weightUp' && totalExtraReps > 0) {
    const s = totalExtraReps === 1 ? '' : 's';
    detail = `Also +${totalExtraReps} rep${s} vs last time.`;
  } else if (primary === 'repsUp' && topDelta > 0) {
    detail = `Also +${fmt(topDelta)} kg on your top set.`;
  } else if (primary === 'repsUp') {
    const setsWord = repPRs.length === 1 ? `set ${repPRs[0].setIndex}` : `${repPRs.length} sets`;
    detail = `Extra reps on ${setsWord}.`;
  }

  if (!detail) {
    const range = parseRepRange(repRange);
    if (range) {
      const topReps = Math.max(...completed.map((s) => parseInt(s.reps, 10) || 0), 0);
      if (topReps > 0 && topReps < range.min) {
        detail = pick(UNDER_TARGET_POOL, seed + ':underTarget');
      }
    }
  }

  return { label, headline, detail };
}

function pick<T>(pool: T[], seed: string): T {
  return pool[hashString(seed) % pool.length];
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '');
}
