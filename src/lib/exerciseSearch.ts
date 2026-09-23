import { normalizeExerciseName } from './normalizeExerciseName';

// Narrows a list of exercises to the ones matching what the user typed. Every
// word typed has to appear somewhere in the name, in any order, so "press
// incline" finds "Incline dumbbell press". An empty query keeps everything.
export function filterExercisesByQuery<T>(
  items: T[],
  query: string,
  nameOf: (item: T) => string
): T[] {
  const words = normalizeExerciseName(query).split(' ').filter(Boolean);
  if (words.length === 0) return items;
  return items.filter((item) => {
    const name = normalizeExerciseName(nameOf(item));
    return words.every((w) => name.includes(w));
  });
}
