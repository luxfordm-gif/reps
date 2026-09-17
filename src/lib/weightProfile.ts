// Weighted profiles — machines that load at more than one point.
//
// Plate-loaded machines (PRIME's range, for one) carry two or three numbered
// loading pegs. They are always numbered 1, 2, 3, and each is a different
// leverage, so 20 kg on peg 3 is nothing like 20 kg on peg 1. A set on one of
// these is a list of weights — one per point, most of them empty.
//
// The set still logs a single `weight`: the total hung on the machine, which is
// what volume, PRs, records and history all read. `position_weights` carries the
// breakdown alongside it so next week's prefill can put each plate back on the
// peg it came off.

export const MAX_LOAD_POSITIONS = 3;

/** How many points a machine loads at. 1 means an ordinary machine. */
export type LoadPositions = 1 | 2 | 3;

/** Per-point weights for one set, in the same order as the pegs (index 0 = point 1).
 *  null is an unloaded point — distinct from 0, which is a point someone deliberately
 *  wrote a zero on. */
export type PositionWeights = (number | null)[];

export function isMultiPoint(positions: LoadPositions | number | null | undefined): boolean {
  return (positions ?? 1) > 1;
}

/** Anything that isn't a whole 1–3 is an ordinary single-point machine. */
export function parseLoadPositions(v: unknown): LoadPositions {
  const n = typeof v === 'string' ? parseInt(v, 10) : typeof v === 'number' ? v : NaN;
  if (n === 2) return 2;
  if (n === 3) return 3;
  return 1;
}

/** Reads a stored breakdown (jsonb from the DB, or a parsed cache entry) back into
 *  a fixed-length array. Returns null when there's nothing usable to read, which is
 *  every set logged before this machine had a profile. */
export function parsePositionWeights(
  v: unknown,
  positions?: number
): PositionWeights | null {
  let raw: unknown = v;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(raw)) return null;
  const length = Math.min(
    MAX_LOAD_POSITIONS,
    Math.max(positions ?? raw.length, raw.length)
  );
  const out: PositionWeights = [];
  for (let i = 0; i < length; i++) {
    const n = raw[i];
    out.push(typeof n === 'number' && Number.isFinite(n) ? n : null);
  }
  return out.some((n) => n != null) ? out : null;
}

/** The total on the machine — null when no point has been loaded at all. */
export function sumPoints(values: PositionWeights): number | null {
  let total = 0;
  let any = false;
  for (const n of values) {
    if (n == null) continue;
    total += n;
    any = true;
  }
  if (!any) return null;
  // Floating point: 2.5 + 2.5 + 20 shouldn't log as 25.000000000000004.
  return Math.round(total * 1000) / 1000;
}

export interface ReadInputs {
  /** One entry per point, in peg order. */
  values: PositionWeights;
  /** Sum of the loaded points, or null when nothing was typed. */
  total: number | null;
  /** True when a point holds something that isn't a number. */
  invalid: boolean;
}

/** Turns the logger's text inputs into numbers. Blank is an unloaded point. */
export function readPointInputs(inputs: string[]): ReadInputs {
  const values: PositionWeights = [];
  let invalid = false;
  for (const raw of inputs) {
    const s = raw.trim();
    if (s === '') {
      values.push(null);
      continue;
    }
    const n = parseFloat(s);
    if (Number.isNaN(n)) {
      invalid = true;
      values.push(null);
      continue;
    }
    values.push(n);
  }
  return { values, total: sumPoints(values), invalid };
}

/** The peg numbers actually carrying weight: [1, 3] for a 10/–/20 load. */
export function loadedPoints(values: PositionWeights): number[] {
  const out: number[] = [];
  values.forEach((n, i) => {
    if (n != null) out.push(i + 1);
  });
  return out;
}

/** "1 · 10 + 3 · 20" — how a load reads when it's spread over more than one peg.
 *  `format` renders a single weight (converting out of kg, adding a unit, …). */
export function describePoints(
  values: PositionWeights,
  format: (n: number) => string
): string {
  return values
    .map((n, i) => (n == null ? null : `${i + 1} · ${format(n)}`))
    .filter((s): s is string => s !== null)
    .join(' + ');
}

/** Grows or trims a per-point array when the machine's profile changes. Weights
 *  hung on points that no longer exist are dropped, not silently re-pegged. */
export function resizePoints<T>(values: T[], positions: number, empty: T): T[] {
  const out = values.slice(0, positions);
  while (out.length < positions) out.push(empty);
  return out;
}
