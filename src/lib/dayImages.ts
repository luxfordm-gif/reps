import abs from '../assets/days/abs.webp';
import arms from '../assets/days/arms.webp';
import back from '../assets/days/back.webp';
import chest from '../assets/days/chest.webp';
import fullBody from '../assets/days/full-body.webp';
import legs from '../assets/days/legs.webp';
import lower from '../assets/days/lower.webp';
import mobility from '../assets/days/mobility.webp';
import pull from '../assets/days/pull.webp';
import push from '../assets/days/push.webp';
import shoulders from '../assets/days/shoulders.webp';
import upper from '../assets/days/upper.webp';

// Square (1:1) photos for the workout tiles on Home, keyed by day name. Days
// without a photo fall back to the accent square and the day's first letter.
const DAY_IMAGES: Record<string, string> = {
  abs,
  arms,
  back,
  chest,
  legs,
  lower,
  mobility,
  pull,
  push,
  shoulders,
  upper,
  'full body': fullBody,
};

/**
 * Other names for the same photo.
 *
 * Day names come from whatever a trainer typed in a PDF, so the same day
 * arrives spelled a dozen ways. Anything not listed here still works — it just
 * falls back to a letter tile — so this is worth extending whenever a real plan
 * turns up a name we don't know.
 */
const ALIASES: Record<string, string> = {
  core: 'abs',
  'abs/core': 'abs',
  'abs and core': 'abs',
  biceps: 'arms',
  triceps: 'arms',
  'arms/shoulders': 'arms',
  delts: 'shoulders',
  'chest/back': 'chest',
  'upper body': 'upper',
  'lower body': 'lower',
  'full-body': 'full body',
  fullbody: 'full body',
  'whole body': 'full body',
  quads: 'legs',
  hamstrings: 'legs',
  glutes: 'legs',
  'leg day': 'legs',
  stretch: 'mobility',
  stretching: 'mobility',
  stretches: 'mobility',
  flexibility: 'mobility',
  'mobility/stretching': 'mobility',
  'mobility and stretching': 'mobility',
  recovery: 'mobility',
  'active recovery': 'mobility',
  yoga: 'mobility',
  lats: 'back',
  traps: 'back',
  'rear delt': 'shoulders',
  'rear delts': 'shoulders',
  'side delts': 'shoulders',
  calves: 'legs',
};

/**
 * One lookup key for every way a day might be written.
 *
 * Imported plans get title-cased, but days added by hand in the editor keep
 * whatever was typed, so matching on the exact string missed "legs" and "LEGS".
 * A rotating plan's "Legs 2" reads as Legs, and spacing around a slash is
 * levelled so "Abs / Core" and "Abs/Core" land together.
 */
function normalise(dayName: string): string {
  return dayName
    .trim()
    .toLowerCase()
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .replace(/\s*\d+$/, '');
}

export function imageForDay(dayName: string): string | null {
  const key = photoKey(dayName);
  return key ? DAY_IMAGES[key] : null;
}

/**
 * How far to slide a photo sideways in the workout day's hero, as a fraction
 * of its width. Positive moves it right.
 *
 * The photos are square and were framed for the Home tiles, where all of each
 * one shows. The hero crops them and fades their lower half to ink, so a
 * subject that sat fine in the square can land off-centre: in the legs shot the
 * empty barbell side ends up on the right. The hero zooms the photo in far
 * enough to cover any shift listed here (up to 0.05).
 */
const HERO_SHIFT: Record<string, number> = {
  legs: 0.05,
};

export function heroShiftForDay(dayName: string): number {
  const key = photoKey(dayName);
  return key ? (HERO_SHIFT[key] ?? 0) : 0;
}

/** The DAY_IMAGES key a day's photo is filed under, or null if it has none. */
function photoKey(dayName: string): string | null {
  const key = normalise(dayName);
  const exact = lookup(key);
  if (exact) return exact;
  // A trainer's day is often two muscle groups in one heading — "Back / Rear
  // Delt", "Chest + Triceps", "Legs and Abs". There's no photo named for a
  // pair, and there shouldn't be one per combination either, so the first part
  // we do recognise is the one the day gets its picture from. Reading left to
  // right means the heading's own emphasis decides.
  for (const part of key.split(/[/+&,]| and /)) {
    const hit = lookup(normalise(part));
    if (hit) return hit;
  }
  return null;
}

function lookup(key: string): string | null {
  if (DAY_IMAGES[key]) return key;
  const alias = ALIASES[key];
  return alias && DAY_IMAGES[alias] ? alias : null;
}
