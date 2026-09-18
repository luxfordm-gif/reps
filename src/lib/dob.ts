// Date of birth as three typed boxes: turning day/month/year into an ISO date,
// deciding when what's typed can't be a birthday, and spotting the stretch of
// year around someone's birthday.

/** Youngest we accept, matching the typical app-store minimum age. */
export const MIN_AGE = 13;
/** Oldest we accept — past this it's a typo, not a birthday. */
export const MAX_AGE = 100;

const DAY_MS = 86_400_000;
/** The birthday itself and the six days running up to it. */
export const BIRTHDAY_WEEK_DAYS = 6;
/** How long after the day it still makes sense to look back. */
export const JUST_PASSED_DAYS = 7;
/** How far ahead is worth mentioning at all. */
export const UPCOMING_DAYS = 31;

/** The three boxes' contents for an ISO date, or empties if there isn't one. */
export function splitISODate(iso: string | null): { d: string; m: string; y: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  if (!match) return { d: '', m: '', y: '' };
  return { d: match[3], m: match[2], y: match[1] };
}

/**
 * The three boxes as one ISO date, or null when they don't spell a real one.
 *
 * Reading the parts back out of the Date is what catches 31 February: the
 * constructor happily rolls it over to 3 March rather than refusing it.
 */
export function toISODate(d: string, m: string, y: string): string | null {
  if (y.length !== 4 || m.length === 0 || d.length === 0) return null;
  const day = Number(d);
  const month = Number(m);
  const year = Number(y);
  if (!day || !month || !year) return null;
  if (month > 12 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Age in whole years on `now`, counting the birthday itself as the new age. */
export function ageOn(iso: string, now = new Date()): number {
  const [y, m, d] = iso.split('-').map(Number);
  let age = now.getFullYear() - y;
  const hadBirthday =
    now.getMonth() + 1 > m || (now.getMonth() + 1 === m && now.getDate() >= d);
  if (!hadBirthday) age -= 1;
  return age;
}

/**
 * What's wrong with the date typed so far, or null while it's still fine.
 *
 * Silent until all three boxes are full: complaining at someone mid-way
 * through typing their year is just noise.
 */
export function dobProblem(d: string, m: string, y: string, now = new Date()): string | null {
  if (!d || !m || y.length < 4) return null;
  const iso = toISODate(d, m, y);
  if (!iso) return 'That date doesn’t exist.';
  const age = ageOn(iso, now);
  if (age < 0) return 'That’s in the future.';
  if (age < MIN_AGE) return `You need to be at least ${MIN_AGE}.`;
  if (age > MAX_AGE) return 'Check the year.';
  return null;
}

/**
 * A warm line for someone whose birthday is nearby, in the right tense.
 *
 * Three windows, because we know which side of the date they're on and the
 * reader does too: the week running up to it, the days just after, and the
 * stretch of a month before that. Outside those, silence — a birthday five
 * months off isn't news.
 */
export function birthdayNote(iso: string, now = new Date()): string | null {
  const [, month, day] = iso.split('-').map(Number);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // Days to the closest occurrence, negative once it's been and gone. Last
  // year's and next year's count too, so a December birthday still reads
  // correctly in January. Rounding absorbs the clocks going back.
  let nearest = Infinity;
  for (const offset of [-1, 0, 1]) {
    const occurrence = new Date(today.getFullYear() + offset, month - 1, day);
    const days = Math.round((occurrence.getTime() - today.getTime()) / DAY_MS);
    if (Math.abs(days) < Math.abs(nearest)) nearest = days;
  }

  if (nearest < 0) {
    return nearest >= -JUST_PASSED_DAYS ? 'Hope you had a great one.' : null;
  }
  if (nearest <= BIRTHDAY_WEEK_DAYS) return 'Have a great birthday week.';
  if (nearest <= UPCOMING_DAYS) return 'Birthday coming up \u2014 hope it\u2019s a good one.';
  return null;
}
