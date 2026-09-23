import { levenshtein } from './stringSimilarity';
import { splitBrand } from './exerciseBrand';

// Finding the same movement recorded twice.
//
// Duplicates arrive by four routes: a plan names a machine slightly
// differently from the last one ("Deadlift" / "Deadlift from floor"), a name
// is typed with a typo and becomes permanent ("Hammer strngth high row"), a
// plural creeps in ("Assisted pullup" / "Assisted pullups"), or the brand sits
// at the other end ("Reverse pec deck prime" / "Prime reverse pec deck"). All
// four split a
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
  reason: 'brand' | 'plural' | 'extension' | 'typo';
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

/**
 * The same brand and movement with the brand in a different place — "Prime
 * reverse pec deck" and "Reverse pec deck prime". Coaches put it at either end,
 * and a brand typed into its own field goes on the front.
 */
function isBrandMovedOf(a: string, b: string): boolean {
  const x = splitBrand(a);
  const y = splitBrand(b);
  if (!x.brand || !y.brand) return false;
  return (
    x.brand.toLowerCase() === y.brand.toLowerCase() &&
    x.movement.toLowerCase() === y.movement.toLowerCase()
  );
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
      if (isBrandMovedOf(an, bn)) reason = 'brand';
      else if (isPluralOf(an, bn)) reason = 'plural';
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

      // Two different brands are two machines, however alike the rest reads:
      // a Cybex adductor and a Flex adductor load nothing alike.
      const brandA = splitBrand(an).brand;
      const brandB = splitBrand(bn).brand;
      if (brandA && brandB && brandA !== brandB) continue;

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
  const order: Record<DuplicatePair['reason'], number> = {
    brand: 0,
    plural: 1,
    extension: 2,
    typo: 3,
  };
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

export function dismissPairs(keys: readonly string[]): Set<string> {
  const next = loadDismissedPairs();
  for (const key of keys) next.add(key);
  try {
    window.localStorage.setItem(DISMISS_KEY, JSON.stringify([...next]));
  } catch {
    // A full or blocked store just means it asks again next time.
  }
  return next;
}

// --- Groups ---------------------------------------------------------------

export interface DuplicateGroup<T extends DuplicateCandidate = DuplicateCandidate> {
  /** Stable and order-independent, built from every name in the group. */
  key: string;
  /** The name worth keeping: most logged history, then most plan references. */
  survivor: T;
  /** Everything that would fold into it, most history first. */
  losers: T[];
  /** The pair keys this group was built from, so dismissing it dismisses all. */
  pairKeys: string[];
  /** True when at least one name would have its numbers reinterpreted. */
  unitDiffers: boolean;
}

/**
 * The same movement under three or more names, as one decision.
 *
 * Pairs alone are not enough once a third name joins: "Pec deck", "Pec deck
 * fly" and "Prime pec deck fly" produce two pairs that share a name, so the
 * list offers two choices that each invalidate the other, and merging either
 * one leaves the other pointing at a machine that no longer exists.
 *
 * Joining pairs that share a name turns that into a single question with a
 * single answer. Similarity is not transitive in general, which is why the
 * pair rules stay as strict as they are — a chain is only ever as trustworthy
 * as the links it is built from.
 */
export function findDuplicateGroups<T extends DuplicateCandidate>(
  machines: T[],
  dismissed: ReadonlySet<string> = new Set(),
): DuplicateGroup<T>[] {
  const pairs = findDuplicatePairs(machines, dismissed);

  // Union-find over normalized names.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = parent.get(x) ?? x;
    if (root !== x) {
      root = find(root);
      parent.set(x, root);
    }
    return root;
  };
  // The one brand each group holds, if any. A pair that would put two brands
  // in one group is left out: "Cybex adductor" and "Flex adductor" each pair
  // with plain "Adductor", but joining both would merge two different
  // machines. Pairs come most convincing first, so the stronger link wins.
  const brandOf = new Map<string, string | null>();
  const brandOfRoot = (x: string) => brandOf.get(find(x)) ?? splitBrand(x).brand;
  const used: DuplicatePair<T>[] = [];
  for (const p of pairs) {
    const a = p.survivor.normalizedName;
    const b = p.loser.normalizedName;
    const ba = brandOfRoot(a);
    const bb = brandOfRoot(b);
    if (ba && bb && ba !== bb) continue;
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
    brandOf.set(rb, ba ?? bb);
    used.push(p);
  }

  const members = new Map<string, Map<string, T>>();
  const pairKeys = new Map<string, string[]>();
  for (const p of used) {
    const root = find(p.survivor.normalizedName);
    let bucket = members.get(root);
    if (!bucket) {
      bucket = new Map();
      members.set(root, bucket);
    }
    bucket.set(p.survivor.normalizedName, p.survivor);
    bucket.set(p.loser.normalizedName, p.loser);
    pairKeys.set(root, [...(pairKeys.get(root) ?? []), p.key]);
  }

  const groups: DuplicateGroup<T>[] = [];
  for (const [root, bucket] of members) {
    const all = [...bucket.values()].sort(rank);
    const [survivor, ...losers] = all;
    const units = new Set(all.map((m) => m.unit));
    groups.push({
      key: all
        .map((m) => m.normalizedName)
        .sort()
        .join('\u0000'),
      survivor,
      losers,
      pairKeys: pairKeys.get(root) ?? [],
      unitDiffers: units.size > 1,
    });
  }

  // Most history at stake first: the groups worth clearing lead.
  return groups.sort(
    (a, b) =>
      totalSets(b) - totalSets(a) ||
      b.losers.length - a.losers.length ||
      a.key.localeCompare(b.key),
  );
}

function totalSets(g: DuplicateGroup<DuplicateCandidate>): number {
  return g.survivor.setCount + g.losers.reduce((n, m) => n + m.setCount, 0);
}
