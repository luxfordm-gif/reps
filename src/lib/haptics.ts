function hapticBuzz(pattern: number | number[]) {
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
 *
 * There is no fifth, lighter one. When `tick` is too much for a control, the
 * answer is no haptic at all, not a smaller number. The tab bar is the
 * standing example.
 *
 * The durations are longer than they read. The first pass at these argued
 * from motor spin-up that anything under a few milliseconds is
 * indistinguishable, and then set the whole vocabulary at 5–10ms anyway —
 * which put every one of them at or under the floor it had just described.
 * The result was an app that asked the phone to vibrate twenty-eight times a
 * session and was never felt once. A linear actuator needs something like
 * 10ms before it has moved at all, and Android's own touch feedback sits
 * around 20–50ms; these are scaled to that, keeping the four apart in weight
 * rather than keeping them all short.
 */
export const haptics = {
  /** The lightest one: a selection moving. A chip, a unit, a stepper, a set
   *  reopened. Restrained by design — these fire in runs of three or four as
   *  a machine gets set up, and anything heavier turns into noise. */
  tick: () => hapticBuzz(12),
  /** A control acknowledging a press: a menu opening, a sheet coming up. */
  tap: () => hapticBuzz(20),
  /** Something saved and counted — a set logged, a workout started. Two pulses
   *  with a gap you can hear as well as feel, the second longer than the
   *  first, because it should feel unlike everything else on the screen. */
  commit: () => hapticBuzz([22, 40, 32]),
  /** Something was refused, and the screen is about to say why. The heaviest
   *  of the four: it's the only one that means stop. */
  alert: () => hapticBuzz([40, 30, 40]),
};
