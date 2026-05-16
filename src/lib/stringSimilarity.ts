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

export function findCloseMatch(
  target: string,
  candidates: SimilarityCandidate[],
  excludeNormalized?: string
): SimilarityCandidate | null {
  const t = normalizeExerciseName(target);
  if (t.length === 0) return null;
  let best: { c: SimilarityCandidate; distance: number } | null = null;
  for (const c of candidates) {
    const n = c.normalizedName;
    if (!n) continue;
    if (excludeNormalized && n === excludeNormalized) continue;
    if (n === t) continue;
    const distance = levenshtein(t, n);
    const substringMatch =
      Math.min(t.length, n.length) >= MIN_SUBSTRING_OVERLAP &&
      (t.includes(n) || n.includes(t));
    if (distance > MAX_EDIT_DISTANCE && !substringMatch) continue;
    if (!best || distance < best.distance) best = { c, distance };
  }
  return best?.c ?? null;
}
