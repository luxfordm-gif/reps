// Tying a row in a freshly-uploaded plan to a machine you already train.
//
// Getting this wrong is expensive in both directions. Miss a match and the
// machine starts from zero with none of its history or PRs; make one that isn't
// real and two different machines' numbers are merged into one. So nothing here
// decides on its own beyond an exact name: everything else is put to the user
// on the review screen, and an unanswered question counts as "different".
//
// Three things are checked, in order of how sure they are:
//
//   1. the same normalized name — the same machine, no question asked;
//   2. the same name misspelt — "Dedlift" for "Deadlift". Caught by comparing
//      the names character by character, because word overlap can't see it:
//      a typo changes the whole word, so the two share nothing and score zero;
//   3. a near miss by word overlap — "Incline DB press" against "Incline
//      dumbbell press", where over half the words are shared.

import { findCloseMatchDetailed } from './stringSimilarity';

export interface PreviousExercise {
  name: string;
  normalizedName: string;
  /** How many sets have been logged on it, used to break ties between equally
   *  similar candidates — the machine you actually train is the likelier one. */
  setCount: number;
}

/**
 * 'typo' is kept apart from 'fuzzy' because the answer differs: a misspelling
 * is worth correcting to the name already on record, whereas a near miss is a
 * question about which machine is meant, where the plan's wording may be right.
 */
export type MatchKind = 'exact' | 'typo' | 'fuzzy' | 'none';

export interface Match {
  kind: MatchKind;
  candidate?: PreviousExercise;
  decision: 'pending' | 'same' | 'different';
}

/** Share of words two names have in common, ignoring one-letter fragments. */
export function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 2)
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Over half the words shared. Below this, near-misses are mostly noise. */
export const FUZZY_THRESHOLD = 0.5;

export function computeMatch(
  exercise: { name: string; normalizedName: string },
  previous: readonly PreviousExercise[]
): Match {
  if (previous.length === 0) return { kind: 'none', decision: 'pending' };

  const exact = previous.find((p) => p.normalizedName === exercise.normalizedName);
  if (exact) return { kind: 'exact', candidate: exact, decision: 'same' };

  const close = findCloseMatchDetailed(exercise.name, previous);
  if (close) {
    const candidate = previous.find(
      (p) => p.normalizedName === close.candidate.normalizedName
    );
    if (candidate) {
      return {
        kind: close.reason === 'typo' ? 'typo' : 'fuzzy',
        candidate,
        decision: 'pending',
      };
    }
  }

  const newTokens = tokenize(exercise.name);
  let best: { p: PreviousExercise; score: number } | null = null;
  for (const p of previous) {
    const score = jaccard(newTokens, tokenize(p.name));
    if (!best || score > best.score) {
      best = { p, score };
    } else if (score === best.score && p.setCount > best.p.setCount) {
      // Matching against the whole history means near-ties are common; prefer
      // the better-used machine.
      best = { p, score };
    }
  }
  if (best && best.score >= FUZZY_THRESHOLD) {
    return { kind: 'fuzzy', candidate: best.p, decision: 'pending' };
  }
  return { kind: 'none', decision: 'pending' };
}

/**
 * Whether this row is tied to a machine already in the history — an exact name,
 * or a suggestion the user confirmed. Those are the only rows where starting
 * the new block from zero is a meaningful choice.
 */
export function carriesHistory(match?: Match): boolean {
  if (!match) return false;
  if (match.kind === 'exact') return true;
  return (match.kind === 'fuzzy' || match.kind === 'typo') && match.decision === 'same';
}

/** The kinds that put a question to the user rather than deciding for them. */
export function isAnswerable(match?: Match): boolean {
  return match?.kind === 'fuzzy' || match?.kind === 'typo';
}
