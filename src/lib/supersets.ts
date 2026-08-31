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
