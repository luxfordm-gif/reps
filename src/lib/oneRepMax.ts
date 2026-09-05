// Estimated one-rep max, kept free of the Supabase client so the aggregation
// that depends on it stays testable from a plain node script.

/** Epley estimated one-rep max. Single reps return the lifted weight unchanged. */
export function estimate1RM(weight: number, reps: number): number {
  if (reps <= 1) return weight;
  return weight * (1 + reps / 30);
}
