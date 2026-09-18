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
  const key = normalise(dayName);
  return DAY_IMAGES[key] ?? DAY_IMAGES[ALIASES[key] ?? ''] ?? null;
}
