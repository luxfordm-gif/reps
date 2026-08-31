// Default rest period for a freshly-uploaded exercise.
//
// Until now `rest_seconds` was left null on upload, so every exercise in a new
// plan fell back to whatever rest the user last picked anywhere in the app (or
// 60s). That ignored what the plan itself says: a drop set is meant to run
// straight through, and a heavy compound needs longer on its feet than a
// machine isolation does.
//
// Precedence, most specific first:
//   1. An explicit rest the coach wrote in the notes, in numbers ("45 seconds
//      max rest") or in words ("no rest", "minimal rest", "full recovery").
//   2. Drop sets — no rest.
//   3. Heavy compounds (deadlift / squat / leg press family) — 2 minutes.
//   4. Everything else — 1 minute.
//
// Whatever we pick is only a starting point: the rest pill on the logger still
// overrides it per exercise and that choice sticks.

/** Stored rest of 0 means "run straight through, no timer". */
export const NO_REST = 0;
export const DEFAULT_REST_SECONDS = 60;
export const COMPOUND_REST_SECONDS = 120;
/** "Minimal rest" — enough to reset, not to recover. */
export const SHORT_REST_SECONDS = 30;
/** "Rest until fully recovered". */
export const FULL_RECOVERY_SECONDS = 180;

// Anything longer than this in a coach note is almost certainly not a rest
// period (it's a hold, a finisher, or a stray number), so we ignore it.
const MAX_NOTE_REST_SECONDS = 600;

// The taxing multi-joint lifts that earn the longer default. Deliberately kept
// to the deadlift / squat / leg press family rather than every pressing or
// rowing movement — this plan is machine-heavy, and sweeping those in would
// make 2 minutes the default for most of the day instead of the exception.
const COMPOUND_PATTERNS: RegExp[] = [
  /\bdead\s?lift/,
  /\brack\s?pull\b/,
  /\bsquat/,
  /\bleg\s?press\b/,
  /\bhip\s?thrust\b/,
  /\blunge/,
  /\bsplit\s?squat\b/,
  /\bgood\s?morning\b/,
  // Abbreviations trainers write instead of the full name.
  /\brdls?\b/,
  /\bsldls?\b/,
];

/**
 * A rest period the coach spelled out in the notes, in seconds.
 *
 * Matches both orders ("45 seconds max rest" and "rest 45 seconds") in seconds
 * or minutes, so an explicit instruction always beats our defaults.
 */
export function restSecondsFromNotes(notes: string | null | undefined): number | null {
  const text = (notes ?? '').toLowerCase();
  // Coaches write rest in words as often as numbers. These are checked first so
  // "no rest" isn't read as whatever number happens to sit near it.
  if (/\bno\s+rest\b|\bwithout\s+rest\b|\bstraight\s+(?:into|through)\b/.test(text)) {
    return NO_REST;
  }
  if (/\bminimal\s+rest\b|\bshort\s+rest\b|\blittle\s+rest\b/.test(text)) {
    return SHORT_REST_SECONDS;
  }
  if (/\bfull\s+(?:recovery|rest)\b|\bfully\s+recovered?\b/.test(text)) {
    return FULL_RECOVERY_SECONDS;
  }
  if (!text.includes('rest')) return null;
  const patterns: { re: RegExp; unit: number }[] = [
    // "45 seconds max rest", "10 second rest"
    { re: /(\d+)\s*(?:seconds?|secs?|s)\b[^.]{0,16}?\brest\b/, unit: 1 },
    // "rest 45 seconds", "rest for 90 secs"
    { re: /\brest\b[^.]{0,16}?(\d+)\s*(?:seconds?|secs?|s)\b/, unit: 1 },
    // "2 minutes rest" / "rest 2 minutes"
    { re: /(\d+)\s*(?:minutes?|mins?|m)\b[^.]{0,16}?\brest\b/, unit: 60 },
    { re: /\brest\b[^.]{0,16}?(\d+)\s*(?:minutes?|mins?|m)\b/, unit: 60 },
  ];
  for (const { re, unit } of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const value = parseInt(m[1], 10) * unit;
    if (Number.isNaN(value) || value < 0 || value > MAX_NOTE_REST_SECONDS) continue;
    return value;
  }
  return null;
}

/** True for the heavy compounds that get the longer default. */
export function isCompoundLift(name: string): boolean {
  const n = name.toLowerCase();
  return COMPOUND_PATTERNS.some((re) => re.test(n));
}

/**
 * The rest period to store for an exercise at upload time. `setScheme` is the
 * scheme the parser detected; `notes` is the coach's own text for the row.
 */
export function defaultRestSeconds(input: {
  name: string;
  notes?: string | null;
  setScheme?: string | null;
}): number {
  const explicit = restSecondsFromNotes(input.notes);
  if (explicit != null) return explicit;
  if (input.setScheme === 'dropset') return NO_REST;
  if (isCompoundLift(input.name)) return COMPOUND_REST_SECONDS;
  return DEFAULT_REST_SECONDS;
}

/**
 * Rest for a whole day's exercises, in the same order they came in.
 *
 * Same as `defaultRestSeconds` per row, except that both halves of a superset
 * get the longer of the pair's two values. You only rest once the pair is done,
 * so pairing (say) a drop set with a normal movement should still leave you the
 * normal movement's rest rather than the drop set's none.
 */
export function restSecondsForExercises(
  exercises: {
    name: string;
    notes?: string | null;
    setScheme?: string | null;
    supersetGroup?: number | null;
  }[]
): number[] {
  const rests = exercises.map((e) => defaultRestSeconds(e));
  const longestByGroup = new Map<number, number>();
  exercises.forEach((e, i) => {
    if (e.supersetGroup == null) return;
    const current = longestByGroup.get(e.supersetGroup) ?? 0;
    longestByGroup.set(e.supersetGroup, Math.max(current, rests[i]));
  });
  return exercises.map((e, i) =>
    e.supersetGroup != null ? longestByGroup.get(e.supersetGroup) ?? rests[i] : rests[i]
  );
}

/** How a rest period reads on screen: "None" for 0, "2m" for whole minutes. */
export function restLabel(seconds: number): string {
  if (seconds <= 0) return 'None';
  if (seconds >= 120 && seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}
