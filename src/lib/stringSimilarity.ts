import { normalizeExerciseName } from './normalizeExerciseName';

export interface SimilarityCandidate {
  name: string;
  normalizedName: string;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

const MAX_EDIT_DISTANCE = 2;
const MIN_SUBSTRING_OVERLAP = 4;

export interface CloseMatch {
  candidate: SimilarityCandidate;
  /** Edit distance between the normalized names. */
  distance: number;
  /**
   * Why it matched. A `typo` is within a couple of characters — almost always a
   * misspelling of the same thing, so the existing spelling is worth offering.
   * A `contains` match is one name inside the other ("cable row" inside "seated
   * cable row"), which is a likelier-than-not guess rather than a correction.
   */
  reason: 'typo' | 'contains';
}

/**
 * The closest of `candidates` to `target`, with why it matched.
 *
 * Callers that only need the name use findCloseMatch; this one exists for the
 * upload screen, which words the question differently for a misspelling than
 * for a near-miss, and only offers to adopt the old spelling for the former.
 */
export function findCloseMatchDetailed(
  target: string,
  candidates: readonly SimilarityCandidate[],
  excludeNormalized?: string
): CloseMatch | null {
  const t = normalizeExerciseName(target);
  if (t.length === 0) return null;
  let best: CloseMatch | null = null;
  for (const c of candidates) {
    const n = c.normalizedName;
    if (!n) continue;
    if (excludeNormalized && n === excludeNormalized) continue;
    if (n === t) continue;
    const distance = levenshtein(t, n);
    const isTypo = distance <= MAX_EDIT_DISTANCE;
    const substringMatch =
      Math.min(t.length, n.length) >= MIN_SUBSTRING_OVERLAP &&
      (t.includes(n) || n.includes(t));
    if (!isTypo && !substringMatch) continue;
    if (!best || distance < best.distance) {
      best = { candidate: c, distance, reason: isTypo ? 'typo' : 'contains' };
    }
  }
  return best;
}

export function findCloseMatch(
  target: string,
  candidates: SimilarityCandidate[],
  excludeNormalized?: string
): SimilarityCandidate | null {
  return findCloseMatchDetailed(target, candidates, excludeNormalized)?.candidate ?? null;
}
