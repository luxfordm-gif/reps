export function hapticBuzz(pattern: number | number[]) {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(pattern);
    } catch {
      // ignore — iOS Safari and some platforms don't support vibration
    }
  }
}

/**
 * What the phone says back, by what just happened. Four of them, because a
 * vocabulary you can hold in your head is what keeps every screen feeling like
 * the same app — the same reason the colours and curves are named.
 *
 * Android fires these through the Vibration API. iOS Safari has no equivalent,
 * so there the visual press feedback is doing the whole job.
 */
export const haptics = {
  /** A control acknowledging a press: a menu opening, a sheet coming up. */
  tap: () => hapticBuzz(8),
  /** A choice landing: a chip, a unit, a position on the machine. */
  select: () => hapticBuzz(12),
  /** Something is saved and counted — a set logged, a weight recorded. */
  commit: () => hapticBuzz([12, 40, 12]),
  /** Something was refused, and the screen is about to say why. */
  alert: () => hapticBuzz([40, 30, 40]),
};
