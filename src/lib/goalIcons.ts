import buildMuscle from '../assets/goals/build-muscle.png';
import gainStrength from '../assets/goals/gain-strength.png';
import fatLoss from '../assets/goals/fat-loss.png';
import type { TopGoal } from './profileApi';

/**
 * Drawn icons for the three training goals, supplied at 24pt @3x.
 *
 * They're flat black line art on transparency, which is all the app asks of
 * them — every surface they sit on is white or near-white. If they ever need
 * to take a colour from the text around them, these want to become inline SVG.
 *
 * `scale` is an optical correction, not a fix for badly cut files: all three
 * are drawn on the same grid, each filling 54 of 72 pixels on its longest
 * side. What differs is how much of the box the shape fills. The dumbbell is
 * flat and horizontal — its ink is 33 pixels tall against the other two's 53
 * and 54 — so at a glance it reads lighter than its neighbours. A few percent
 * gives it back the presence the measurements say it should have. Redrawing it
 * taller would fix that at the source and this could go back to 1.
 */
const GOAL_ICONS: Record<TopGoal, { src: string; scale: number }> = {
  build_muscle: { src: buildMuscle, scale: 1 },
  gain_strength: { src: gainStrength, scale: 1.1 },
  fat_loss: { src: fatLoss, scale: 1 },
};

/** The size these are drawn for, before the optical correction. */
export const GOAL_ICON_SIZE = 24;

export function iconForGoal(goal: TopGoal): { src: string; size: number } {
  const { src, scale } = GOAL_ICONS[goal];
  return { src, size: Math.round(GOAL_ICON_SIZE * scale) };
}
