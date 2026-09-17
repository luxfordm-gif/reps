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
 * There is no fifth, lighter one. A vibration motor has to spin up, so below a
 * few milliseconds the hardware stops distinguishing — asking for 1ms and 5ms
 * feel the same. When `tick` is too much for a control, the answer is no haptic
 * at all, not a smaller number. The tab bar is the standing example.
 */
export const haptics = {
  /** The lightest one: a selection moving. A chip, a unit, a stepper, a set
   *  reopened. Barely there by design — these fire in runs of three or four as
   *  a machine gets set up, and anything heavier turns into noise. */
  tick: () => hapticBuzz(5),
  /** A control acknowledging a press: a menu opening, a sheet coming up. */
  tap: () => hapticBuzz(9),
  /** Something saved and counted — a set logged, a workout started. Two pulses,
   *  because it should feel unlike everything else on the screen. */
  commit: () => hapticBuzz([10, 30, 10]),
  /** Something was refused, and the screen is about to say why. */
  alert: () => hapticBuzz([30, 25, 30]),
};
