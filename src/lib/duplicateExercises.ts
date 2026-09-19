import { levenshtein } from './stringSimilarity';

// Finding the same movement recorded twice.
//
// Duplicates arrive by three routes: a plan names a machine slightly
// differently from the last one ("Deadlift" / "Deadlift from floor"), a name
// is typed with a typo and becomes permanent ("Hammer strngth high row"), or a
// plural creeps in ("Assisted pullup" / "Assisted pullups"). All three split a
// movement's history in two, which fragments its records, its charts and what
// the logger pre-fills.
//
// The bar for suggesting a pair is high, because the cost of a wrong
// suggestion is not symmetric. Dismissing a bad one costs a tap; accepting one
// merges two histories that were never the same movement, and there is no
// undo. "Abductor" and "Adductor" are one character apart, share a body part,
// and are opposite muscles — so plain edit distance, which is what the app's
// existing findCloseMatch uses, is not enough on its own here.

/** A machine as this file needs it. Structural, so MachineRow fits. */
export interface DuplicateCandidate {
  normalizedName: string;
  displayName: string;
  bodyPart: string | null;
  unit: string;
  setCount: number;
  planRefCount: number;
}

/**
 * Generic in the row type so callers get their own rows back, not a narrowed
 * copy: the Machines screen hands this MachineRows and needs MachineRows out
 * again to open the merge modal with.
 */
export interface DuplicatePair<T extends DuplicateCandidate = DuplicateCandidate> {
  /** Stable across sessions and independent of order, so a dismissal sticks. */
  key: string;
  /** The one with more history behind it — the sensible name to keep. */
  survivor: T;
  loser: T;
  /** Why these two were put together, for the row to say. */
  reason: 'plural' | 'extension' | 'typo';
  /** True when merging would reinterpret the loser's numbers. */
  unitDiffers: boolean;
}

/**
 * How different two names are allowed to be, relative to their length.
 *
 * A single substitution in a short word is usually a different word;
 * the same substitution inside a long phrase is usually a slip. "abductor"
 * and "adductor" differ by one character in eight (0.125); "hammer strngth
 * high row" and "hammer strength high row" by one in twenty-three (0.043).
 * The threshold sits between them, which is the whole reason it isn't a flat
 * edit distance.
 */
const MAX_RELATIVE_DISTANCE = 0.09;

/** Below this many characters, no amount of similarity is evidence. */
const MIN_LENGTH = 6;

/** A suffix this long or longer is a different movement, not a plural. */
const MAX_PLURAL_SUFFIX = 2;

function isPluralOf(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (!long.startsWith(short)) return false;
  const suffix = long.slice(short.length);
  return suffix.length <= MAX_PLURAL_SUFFIX && /^e?s$/.test(suffix);
}

/**
 * One name is the other plus words — "deadlift" inside "deadlift from floor".
 *
 * Whole words only. Without that, "row" matches "arrow" and "press" matches
 * "compressed", which are not the same movement by any reading.
 */
function isExtensionOf(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length < MIN_LENGTH) return false;
  return long.startsWith(`${short} `) || long.endsWith(` ${short}`);
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

/** The one worth keeping: more logged history, then more plan references. */
function rank(a: DuplicateCandidate, b: DuplicateCandidate): number {
  return b.setCount - a.setCount || b.planRefCount - a.planRefCount;
}

/**
 * Pairs that look like the same movement recorded twice.
 *
 * Every pair is a suggestion to be confirmed, never applied on its own — see
 * the note at the top about why the bar is set where it is. Ordered so the
 * most convincing pairs come first, and so the survivor is the name with more
 * behind it.
 */
export function findDuplicatePairs<T extends DuplicateCandidate>(
  machines: T[],
  dismissed: ReadonlySet<string> = new Set(),
): DuplicatePair<T>[] {
  const pairs: DuplicatePair<T>[] = [];
  for (let i = 0; i < machines.length; i++) {
    for (let j = i + 1; j < machines.length; j++) {
      const a = machines[i];
      const b = machines[j];
      const an = a.normalizedName;
      const bn = b.normalizedName;
      if (!an || !bn || an === bn) continue;
      if (Math.min(an.length, bn.length) < MIN_LENGTH) continue;

      const key = pairKey(an, bn);
      if (dismissed.has(key)) continue;

      let reason: DuplicatePair['reason'] | null = null;
      if (isPluralOf(an, bn)) reason = 'plural';
      else if (isExtensionOf(an, bn)) reason = 'extension';
      else {
        const distance = levenshtein(an, bn);
        const relative = distance / Math.max(an.length, bn.length);
        if (distance > 0 && relative <= MAX_RELATIVE_DISTANCE) reason = 'typo';
      }
      if (!reason) continue;

      // A body part each, and they disagree: two different movements that
      // happen to read alike. Where either is unknown this says nothing, so
      // it only rules a pair out when both are known.
      if (a.bodyPart && b.bodyPart && a.bodyPart !== b.bodyPart) continue;

      const [survivor, loser] = rank(a, b) <= 0 ? [a, b] : [b, a];
      pairs.push({
        key,
        survivor,
        loser,
        reason,
        unitDiffers: a.unit !== b.unit,
      });
    }
  }

  // Most convincing first: a plural or an added phrase is a surer thing than a
  // near-miss spelling, and within a reason the pair with the most history at
  // stake is the one worth looking at.
  const order: Record<DuplicatePair['reason'], number> = { plural: 0, extension: 1, typo: 2 };
  return pairs.sort(
    (x, y) =>
      order[x.reason] - order[y.reason] ||
      y.survivor.setCount + y.loser.setCount - (x.survivor.setCount + x.loser.setCount) ||
      x.key.localeCompare(y.key),
  );
}

// --- Dismissals -----------------------------------------------------------

const DISMISS_KEY = 'reps.duplicatesDismissed';

/**
 * Pairs the reader has said are not the same movement.
 *
 * Device-local, which is the trade-off for needing no migration: dismiss a
 * pair on your phone and your laptop will ask once more. The alternative is a
 * table, and the answer to "are these two the same exercise" is stable enough
 * that asking twice is a smaller cost than a schema change.
 */
export function loadDismissedPairs(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return new Set(Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : []);
  } catch {
    return new Set();
  }
}

export function dismissPair(key: string): Set<string> {
  const next = loadDismissedPairs();
  next.add(key);
  try {
    window.localStorage.setItem(DISMISS_KEY, JSON.stringify([...next]));
  } catch {
    // A full or blocked store just means it asks again next time.
  }
  return next;
}
