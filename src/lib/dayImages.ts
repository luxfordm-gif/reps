import abs from '../assets/days/abs.webp';
import arms from '../assets/days/arms.webp';
import legs from '../assets/days/legs.webp';
import pull from '../assets/days/pull.webp';
import push from '../assets/days/push.webp';
import upper from '../assets/days/upper.webp';

// Square (1:1) photos for the workout tiles on Home. Keyed by the base day
// name — a rotating day like "Legs 2" reads as Legs. Days without a photo yet
// fall back to the accent square and the day's first letter.
const DAY_IMAGES: Record<string, string> = {
  Abs: abs,
  Arms: arms,
  Legs: legs,
  Pull: pull,
  Push: push,
  Upper: upper,
};

export function imageForDay(dayName: string): string | null {
  return (
    DAY_IMAGES[dayName] ?? DAY_IMAGES[dayName.replace(/\s+\d+$/, '')] ?? null
  );
}
