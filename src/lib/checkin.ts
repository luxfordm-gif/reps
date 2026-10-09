// The check-in at the end of a workout: six ratings, answered by tapping,
// that stand in for the daily sheet a coach hands out.
//
// The questions are the sheet's. Five points rather than the sheet's seven,
// because seven don't fit beside a label on a phone; the export says the
// scale so a coach can map it. Soreness runs the other way from the rest, as
// it does on most of those sheets (1 is good, 5 is bad); the end labels hide
// that from the person tapping.
//
// Everything is optional. A skipped question is simply not stored, and a
// session with nothing answered never appears in the export.

export const RATING_MIN = 1;
export const RATING_MAX = 5;

export type RatingKey = 'performance' | 'energy' | 'soreness' | 'sleep' | 'hunger' | 'stress';

export type CheckIn = Record<RatingKey, number | null>;

export const EMPTY_CHECK_IN: CheckIn = {
  performance: null,
  energy: null,
  soreness: null,
  sleep: null,
  hunger: null,
  stress: null,
};

export interface RatingQuestion {
  key: RatingKey;
  /** The row's label, and the word the export uses. */
  label: string;
  /** The question under the label. */
  hint: string;
  /** What 1 means, in the person's words. */
  low: string;
  /** What 7 means. */
  high: string;
}

/** In the order they're asked: how it went, then what you brought to it.
 *  Soreness and stress run low-is-good, like the sheet; the rest high-is-good. */
export const RATING_QUESTIONS: readonly RatingQuestion[] = [
  { key: 'performance', label: 'Workout', hint: 'How did it feel?', low: 'Rough', high: 'Great' },
  { key: 'energy', label: 'Energy', hint: 'How was it?', low: 'Low', high: 'High' },
  { key: 'soreness', label: 'Soreness', hint: 'How sore?', low: 'Fresh', high: 'Wrecked' },
  { key: 'sleep', label: 'Sleep', hint: 'Last night?', low: 'Terrible', high: 'Great' },
  { key: 'hunger', label: 'Hunger', hint: 'How hungry?', low: 'Not at all', high: 'Starving' },
  { key: 'stress', label: 'Stress', hint: 'How stressed?', low: 'Calm', high: 'Frazzled' },
];

/** A rating as stored: a whole number in range, or nothing. */
export function normaliseRating(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  return n >= RATING_MIN && n <= RATING_MAX ? n : null;
}

/** Whatever the server or the device cache holds, as a well-formed check-in. */
export function normaliseCheckIn(raw: Partial<Record<RatingKey, unknown>> | null | undefined): CheckIn {
  return {
    performance: normaliseRating(raw?.performance),
    energy: normaliseRating(raw?.energy),
    soreness: normaliseRating(raw?.soreness),
    sleep: normaliseRating(raw?.sleep),
    hunger: normaliseRating(raw?.hunger),
    stress: normaliseRating(raw?.stress),
  };
}

export function isCheckInEmpty(c: CheckIn): boolean {
  return RATING_QUESTIONS.every((q) => c[q.key] == null);
}

/** Every rating answered — the point at which the card says it's logged. */
export function isCheckInComplete(c: CheckIn): boolean {
  return RATING_QUESTIONS.every((q) => c[q.key] != null);
}

/** "Workout 4 · Energy 3 · Soreness 2 · Sleep 4 · Hunger 3 · Stress 2", skipping anything unanswered. */
export function ratingsLine(c: CheckIn): string | null {
  const parts = RATING_QUESTIONS.filter((q) => c[q.key] != null).map((q) => `${q.label} ${c[q.key]}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** Each rating's mean across the check-ins that answered it, one decimal. */
export function averagesLine(checkIns: CheckIn[]): string | null {
  const parts: string[] = [];
  for (const q of RATING_QUESTIONS) {
    const answered = checkIns.map((c) => c[q.key]).filter((v): v is number => v != null);
    if (answered.length === 0) continue;
    const mean = answered.reduce((sum, v) => sum + v, 0) / answered.length;
    parts.push(`${q.label} ${formatMean(mean)}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

function formatMean(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

export interface CheckInExportRow {
  completedAt: string;
  dayName: string;
  checkIn: CheckIn;
  /** A note typed on an older build, before the check-in replaced the text box. */
  note: string | null;
}

/**
 * The week's check-ins as plain text for the coach — one block per session,
 * then the week's averages when there are two or more. Read in a messaging
 * app, so no markdown. Sessions with nothing to say are left out; returns null
 * when that's all of them.
 */
export function buildCheckInExport(rows: CheckInExportRow[], now = new Date()): string | null {
  const kept = rows.filter((r) => !isCheckInEmpty(r.checkIn) || (r.note ?? '').trim().length > 0);
  if (kept.length === 0) return null;
  const out: string[] = [];
  out.push('Check-ins for coach');
  out.push(
    `Week ending ${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`
  );
  out.push(
    `Ratings are ${RATING_MIN} to ${RATING_MAX}. Soreness and stress: ${RATING_MIN} is best, ${RATING_MAX} worst.`
  );
  out.push('');
  for (const r of kept) {
    const date = new Date(r.completedAt).toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
    out.push(`${r.dayName}, ${date}`);
    const ratings = ratingsLine(r.checkIn);
    if (ratings) out.push(ratings);
    if (r.note?.trim()) out.push(r.note.trim());
    out.push('');
  }
  // The headline for a coach skimming it, after the days rather than instead
  // of them. One check-in has no average worth stating.
  const rated = kept.map((r) => r.checkIn).filter((c) => !isCheckInEmpty(c));
  const averages = rated.length >= 2 ? averagesLine(rated) : null;
  if (averages) {
    out.push(`Week average, ${rated.length} check-ins`);
    out.push(averages);
  }
  return out.join('\n').trimEnd() + '\n';
}

// Whether the card is shown at all. Someone without a coach may not want six
// questions at the end of every workout; the switch lives in Profile.
const ENABLED_KEY = 'reps.checkIn';

export function getCheckInEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(ENABLED_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setCheckInEnabled(on: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (on) window.localStorage.removeItem(ENABLED_KEY);
    else window.localStorage.setItem(ENABLED_KEY, 'off');
  } catch {
    // Storage blocked: the card simply stays on.
  }
}
