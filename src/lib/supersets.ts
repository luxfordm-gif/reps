// Helpers for exercises the plan says to perform back to back.
//
// Trainers use a few names for the same idea — a superset is two movements, a
// tri-set three, a giant set four or more — and the parser folds them all into
// one shared `superset_group` on the exercises involved. You cycle through the
// group and only rest once the round is done.

import type { PlanExerciseRow } from './plansApi';

/** What to call a group of this size. */
export function groupedSetLabel(size: number): string {
  if (size >= 4) return 'Giant set';
  if (size === 3) return 'Tri-set';
  return 'Superset';
}

/** How a set scheme reads on a card. Null for an ordinary straight-set row. */
export function setSchemeLabel(scheme: string | null | undefined): string | null {
  switch (scheme) {
    case 'dropset':
      return 'Dropset';
    case 'superset':
      return 'Superset';
    case 'muscle_round':
      return 'Muscle Round';
    case 'rest_pause':
      return 'Rest-Pause';
    case 'hold':
      return 'Hold';
    default:
      return null;
  }
}

/**
 * The badges an exercise row carries, in order.
 *
 * These are two different things and an exercise can have both: the group it's
 * performed in, and what happens within its own sets. A drop set on the last
 * round of a superset is both, and showing only one of them hid the drop.
 *
 * The exception is a scheme of "superset" alongside a real group — that's the
 * same fact told twice, so the group badge says it and the scheme stays quiet.
 */
export function exerciseBadges(
  partnerCount: number,
  scheme: string | null | undefined
): string[] {
  const out: string[] = [];
  if (partnerCount > 0) out.push(groupedSetLabel(partnerCount + 1));
  const schemeLabel = setSchemeLabel(scheme);
  if (schemeLabel && !(partnerCount > 0 && scheme === 'superset')) out.push(schemeLabel);
  return out;
}

/** "A", "A and B", "A, B and C". */
export function formatNameList(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Every exercise in this one's group, in plan order (including itself). Empty
 * when the exercise isn't part of a group — a group needs at least two members.
 */
export function supersetMembers(
  exercise: PlanExerciseRow,
  all: PlanExerciseRow[]
): PlanExerciseRow[] {
  if (exercise.superset_group == null) return [];
  const members = all.filter((e) => e.superset_group === exercise.superset_group);
  return members.length > 1 ? members : [];
}

/** The other members' names, for describing the pairing on screen. */
export function supersetPartnerNames(
  exercise: PlanExerciseRow,
  all: PlanExerciseRow[]
): string[] {
  return supersetMembers(exercise, all)
    .filter((e) => e.id !== exercise.id)
    .map((e) => e.name);
}
