// The check-in at the end of a workout: four ratings and a row of flags,
// answered by tapping, that stand in for the daily sheet a coach hands out.
//
// The questions are the sheet's, and the numbers are stored the way the sheet
// scores them, so a coach pastes them in unchanged. Soreness runs the other way
// from the rest on most of those sheets (1 is good, 7 is bad); the end labels
// hide that from the person tapping, and the number lands right either way.
//
// Everything is optional. A skipped question is simply not stored, and a
// session with nothing answered never appears in the export.

export const RATING_MIN = 1;
export const RATING_MAX = 7;

export type RatingKey = 'performance' | 'energy' | 'soreness' | 'sleep';
export type FlagKey = 'stressed' | 'hungry' | 'stomach' | 'ill';

export interface CheckIn {
  performance: number | null;
  energy: number | null;
  soreness: number | null;
  sleep: number | null;
  flags: FlagKey[];
}

export const EMPTY_CHECK_IN: CheckIn = {
  performance: null,
  energy: null,
  soreness: null,
  sleep: null,
  flags: [],
};

export interface RatingQuestion {
  key: RatingKey;
  /** The row's label, and the word the export uses. */
  label: string;
  /** What 1 means, in the person's words. */
  low: string;
  /** What 7 means. */
  high: string;
}

/** In the order they're asked: how it went, then what you brought to it. */
export const RATING_QUESTIONS: readonly RatingQuestion[] = [
  { key: 'performance', label: 'Session', low: 'Rough', high: 'On fire' },
  { key: 'energy', label: 'Energy', low: 'Flat', high: 'Full tank' },
  { key: 'soreness', label: 'Soreness', low: 'Fresh', high: 'Wrecked' },
  { key: 'sleep', label: 'Sleep last night', low: 'Terrible', high: 'Great' },
];

export const FLAGS: readonly { key: FlagKey; label: string }[] = [
  { key: 'stressed', label: 'Stressed' },
  { key: 'hungry', label: 'Hungry' },
  { key: 'stomach', label: 'Upset stomach' },
  { key: 'ill', label: 'Ill' },
];

export function isFlagKey(v: unknown): v is FlagKey {
  return FLAGS.some((f) => f.key === v);
}

/** A rating as stored: a whole number in range, or nothing. */
export function normaliseRating(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  return n >= RATING_MIN && n <= RATING_MAX ? n : null;
}

/** Whatever the server or the device cache holds, as a well-formed check-in. */
export function normaliseCheckIn(raw: Partial<Record<keyof CheckIn, unknown>> | null | undefined): CheckIn {
  const flags = Array.isArray(raw?.flags) ? raw.flags.filter(isFlagKey) : [];
  return {
    performance: normaliseRating(raw?.performance),
    energy: normaliseRating(raw?.energy),
    soreness: normaliseRating(raw?.soreness),
    sleep: normaliseRating(raw?.sleep),
    flags: Array.from(new Set(flags)),
  };
}

export function isCheckInEmpty(c: CheckIn): boolean {
  return RATING_QUESTIONS.every((q) => c[q.key] == null) && c.flags.length === 0;
}

/** Every rating answered — the point at which the card says it's logged. */
export function isCheckInComplete(c: CheckIn): boolean {
  return RATING_QUESTIONS.every((q) => c[q.key] != null);
}

/** "Session 6 · Energy 5 · Soreness 3 · Sleep 4", skipping anything unanswered. */
export function ratingsLine(c: CheckIn): string | null {
  const parts = RATING_QUESTIONS.filter((q) => c[q.key] != null).map((q) => `${q.label.split(' ')[0]} ${c[q.key]}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** "Stressed, upset stomach", in the order the chips are shown. */
export function flagsLine(c: CheckIn): string | null {
  const labels = FLAGS.filter((f) => c.flags.includes(f.key)).map((f) => f.label);
  if (labels.length === 0) return null;
  const [first, ...rest] = labels;
  return [first, ...rest.map((l) => l.toLowerCase())].join(', ');
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
 * read in a messaging app, so no markdown. Sessions with nothing to say are
 * left out; returns null when that's all of them.
 */
export function buildCheckInExport(rows: CheckInExportRow[], now = new Date()): string | null {
  const kept = rows.filter((r) => !isCheckInEmpty(r.checkIn) || (r.note ?? '').trim().length > 0);
  if (kept.length === 0) return null;
  const out: string[] = [];
  out.push('Check-ins for coach');
  out.push(
    `Week ending ${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`
  );
  out.push('Ratings are 1 to 7. Soreness: 1 fresh, 7 wrecked.');
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
    const flags = flagsLine(r.checkIn);
    if (flags) out.push(flags);
    if (r.note?.trim()) out.push(r.note.trim());
    out.push('');
  }
  return out.join('\n').trimEnd() + '\n';
}

// Whether the card is shown at all. Someone without a coach may not want four
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
