// Weight profiles — machines whose load is more than a single number.
//
// Two kinds, and they behave differently:
//
//   pegs  — plate-loaded machines (PRIME's range, for one) with two or more
//           numbered loading pegs. Plates go on several at once and each peg is
//           a different leverage, so the set's load is the sum of what's hung
//           where. 20 kg on peg 3 is nothing like 20 kg on peg 1.
//   curve — cable machines, where the cam the cable runs over can be set to one
//           of several numbered positions. That changes how the weight arcs
//           through the lift, not how much of it there is: one weight, on one
//           position. Nothing is added up.
//
// Both log a single `weight` — the total on the machine, which is what volume,
// PRs, records and history read. The breakdown rides alongside in
// `position_weights`, an array in kg with null for a position carrying nothing.
// A curve is simply a breakdown with one entry filled in, so the two kinds
// share their storage and differ only in how a set is typed in.

/** The most pegs or curve positions a machine may be set to. A guard against a
 *  mistyped stepper rather than a claim about gym equipment — raise it here and
 *  in migration 0018's check constraint if something bigger turns up. */
export const MAX_PROFILE_POSITIONS = 8;
/** A profile with one position isn't a profile, so this is where they start. */
export const MIN_PROFILE_POSITIONS = 2;
/** What a machine gets when a profile is switched on without saying how many. */
export const DEFAULT_PROFILE_POSITIONS = 3;

export type LoadProfileKind = 'pegs' | 'curve';

export interface MachineProfile {
  /** null on an ordinary machine — one weight, no positions. */
  kind: LoadProfileKind | null;
  /** How many pegs or curve positions. 1 whenever there's no profile. */
  positions: number;
}

export const NO_PROFILE: MachineProfile = { kind: null, positions: 1 };

/** Per-position weights for one set, in peg (or curve) order — index 0 is
 *  position 1. null is a position carrying nothing, which is not the same as a
 *  deliberate 0. */
export type PositionWeights = (number | null)[];

export function hasPegs(profile: MachineProfile): boolean {
  return profile.kind === 'pegs' && profile.positions > 1;
}

export function hasCurve(profile: MachineProfile): boolean {
  return profile.kind === 'curve' && profile.positions > 1;
}

export function parseProfileKind(v: unknown): LoadProfileKind | null {
  return v === 'pegs' || v === 'curve' ? v : null;
}

/** Clamps a stored or typed position count into what a machine may have. */
export function clampPositions(v: unknown, fallback = DEFAULT_PROFILE_POSITIONS): number {
  const n = typeof v === 'string' ? parseInt(v, 10) : typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n)) return fallback;
  const whole = Math.round(n);
  if (whole < MIN_PROFILE_POSITIONS) return MIN_PROFILE_POSITIONS;
  if (whole > MAX_PROFILE_POSITIONS) return MAX_PROFILE_POSITIONS;
  return whole;
}

/** Reads a machine's stored profile. A count with no kind is a machine tagged
 *  before curves existed, when pegs were the only thing a profile could mean. */
export function parseProfile(kind: unknown, positions: unknown): MachineProfile {
  const parsedKind = parseProfileKind(kind);
  const raw =
    typeof positions === 'string'
      ? parseInt(positions, 10)
      : typeof positions === 'number'
        ? positions
        : NaN;
  // Whole numbers only, and a count of one means "no positions" rather than the
  // smallest a profile may have — so it can't clamp its way into being one.
  const count = Number.isFinite(raw) ? Math.round(raw) : null;
  const usable = count != null && count > 1 ? clampPositions(count) : null;
  if (!parsedKind) {
    return usable == null ? NO_PROFILE : { kind: 'pegs', positions: usable };
  }
  return { kind: parsedKind, positions: usable ?? DEFAULT_PROFILE_POSITIONS };
}

/** The total on the machine — null when no position has been loaded at all. */
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
  /** One entry per position, in order. */
  values: PositionWeights;
  /** Sum of the loaded positions, or null when nothing was typed. */
  total: number | null;
  /** True when a position holds something that isn't a number. */
  invalid: boolean;
}

/** Turns the logger's text inputs into numbers. Blank is an unloaded position. */
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

/** Reads a logged breakdown back out of the database (jsonb, or the same array
 *  already parsed). Null when there's nothing usable — which is every set logged
 *  before the machine had a profile. */
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
    MAX_PROFILE_POSITIONS,
    Math.max(positions ?? raw.length, raw.length)
  );
  const out: PositionWeights = [];
  for (let i = 0; i < length; i++) {
    const n = raw[i];
    out.push(typeof n === 'number' && Number.isFinite(n) ? n : null);
  }
  return out.some((n) => n != null) ? out : null;
}

/** The position numbers carrying weight: [1, 3] for a 10/–/20 load. */
export function loadedPoints(values: PositionWeights): number[] {
  const out: number[] = [];
  values.forEach((n, i) => {
    if (n != null) out.push(i + 1);
  });
  return out;
}

/** "1 · 10 kg + 3 · 20 kg" — how a load reads when it's spread over pegs.
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

/** Which curve position a logged set was on — the one loaded entry, as a
 *  0-based index. Null when the set has no breakdown, or carries more than one
 *  position and so can't be a curve. */
export function curvePointOf(values: PositionWeights | null): number | null {
  if (!values) return null;
  const loaded = loadedPoints(values);
  return loaded.length === 1 ? loaded[0] - 1 : null;
}

/** The breakdown a curve set logs: the whole weight on the chosen position. */
export function curveBreakdown(
  positions: number,
  point: number,
  kg: number
): PositionWeights {
  const out: PositionWeights = new Array(Math.max(positions, point + 1)).fill(null);
  out[point] = kg;
  return out;
}

/** Grows or trims a per-position array when a machine's profile changes.
 *  Weights on positions that no longer exist are dropped, not re-pegged. */
export function resizePoints<T>(values: T[], positions: number, empty: T): T[] {
  const out = values.slice(0, positions);
  while (out.length < positions) out.push(empty);
  return out;
}
