import type { MachineUnit } from './units';
import { estimate1RM } from './oneRepMax';

// All-time personal records, for the Personal records screen.
//
// This is deliberately independent of `baseline_reset_at`. Starting a new plan
// resets what the logger PRE-FILLS, so you work up to the new rep ranges rather
// than chasing last block's numbers — but it must never cost you a record. A PR
// is the one number you want to still be there in two years, so every set you
// have ever logged counts here, whatever plan it was logged under.
//
// Three kinds of record, because not everything in a plan is a weighted lift:
//   • weighted — the heaviest set, plus the best estimated 1RM
//   • reps     — bodyweight movements (pull-ups, press-ups): the most reps in a set
//   • hold     — planks and max holds: the longest single hold
// A machine that has both weighted and bodyweight sets is treated as weighted;
// that's the number a lifter means by "my best".

export type RecordKind = 'weighted' | 'reps' | 'hold';

/** A single set, named so it can be shown as "100 kg × 5". */
export interface RecordSet {
  weightKg: number | null;
  reps: number | null;
  holdSeconds: number | null;
  achievedAt: string;
}

export interface LiftRecord {
  normalizedName: string;
  displayName: string;
  bodyPart: string | null;
  unit: MachineUnit;
  kind: RecordKind;
  /** Heaviest single set. Null for reps/hold records. */
  heaviest: RecordSet | null;
  /** The set with the best estimated 1RM, and that estimate in kg. */
  best1RM: RecordSet | null;
  best1RMkg: number;
  /** Most reps in one set — the headline for a bodyweight movement. */
  mostReps: RecordSet | null;
  /** Longest single hold, in seconds. */
  longestHold: RecordSet | null;
  totalSets: number;
  lastLoggedAt: string;
}

export interface RawSet {
  normalizedName: string;
  displayName: string;
  bodyPart: string | null;
  weightKg: number | null;
  reps: number | null;
  holdSeconds: number | null;
  completedAt: string;
}

/**
 * Fold every logged set into one record per movement.
 *
 * Pure, so the ordering and the tie-breaks can be tested without a database.
 * Ties on weight go to the set with more reps, then to the earlier set — you
 * set the record the first time you hit it, not the last time you repeated it.
 */
export function computeRecords(sets: RawSet[]): LiftRecord[] {
  const byName = new Map<string, RawSet[]>();
  for (const s of sets) {
    if (!s.normalizedName) continue;
    const list = byName.get(s.normalizedName);
    if (list) list.push(s);
    else byName.set(s.normalizedName, [s]);
  }

  const records: LiftRecord[] = [];
  for (const [normalizedName, group] of byName) {
    let heaviest: RecordSet | null = null;
    let best1RM: RecordSet | null = null;
    let best1RMkg = 0;
    let mostReps: RecordSet | null = null;
    let longestHold: RecordSet | null = null;
    let lastLoggedAt = '';
    let displayName = '';
    let bodyPart: string | null = null;

    for (const s of group) {
      if (s.completedAt > lastLoggedAt) {
        lastLoggedAt = s.completedAt;
        // The most recent name wins: renaming a machine should rename its record.
        if (s.displayName) displayName = s.displayName;
      }
      if (!displayName && s.displayName) displayName = s.displayName;
      if (s.bodyPart) bodyPart = s.bodyPart;

      const as = (): RecordSet => ({
        weightKg: s.weightKg,
        reps: s.reps,
        holdSeconds: s.holdSeconds,
        achievedAt: s.completedAt,
      });

      if (s.weightKg != null && s.weightKg > 0 && s.reps != null && s.reps > 0) {
        if (
          heaviest == null ||
          s.weightKg > (heaviest.weightKg ?? 0) ||
          (s.weightKg === heaviest.weightKg && s.reps > (heaviest.reps ?? 0))
        ) {
          heaviest = as();
        }
        const e = estimate1RM(s.weightKg, s.reps);
        if (e > best1RMkg) {
          best1RMkg = e;
          best1RM = as();
        }
      } else if (s.reps != null && s.reps > 0) {
        // Bodyweight: no weight on the bar, but the reps are still a record.
        if (mostReps == null || s.reps > (mostReps.reps ?? 0)) mostReps = as();
      }

      if (s.holdSeconds != null && s.holdSeconds > 0) {
        if (longestHold == null || s.holdSeconds > (longestHold.holdSeconds ?? 0)) {
          longestHold = as();
        }
      }
    }

    const kind: RecordKind =
      heaviest != null ? 'weighted' : longestHold != null ? 'hold' : 'reps';

    // A movement with nothing scoreable (every set blank) isn't a record.
    if (heaviest == null && mostReps == null && longestHold == null) continue;

    records.push({
      normalizedName,
      displayName: displayName || normalizedName,
      bodyPart,
      unit: 'kg',
      kind,
      heaviest,
      best1RM,
      best1RMkg,
      mostReps,
      longestHold,
      totalSets: group.length,
      lastLoggedAt,
    });
  }

  return sortRecords(records);
}

/** Heaviest lifts first within a body part; movements with no weight after them. */
export function sortRecords(records: LiftRecord[]): LiftRecord[] {
  return [...records].sort((a, b) => {
    if (a.kind !== b.kind) {
      const rank = { weighted: 0, reps: 1, hold: 2 } as const;
      return rank[a.kind] - rank[b.kind];
    }
    if (a.kind === 'weighted') return b.best1RMkg - a.best1RMkg;
    if (a.kind === 'reps') return (b.mostReps?.reps ?? 0) - (a.mostReps?.reps ?? 0);
    return (b.longestHold?.holdSeconds ?? 0) - (a.longestHold?.holdSeconds ?? 0);
  });
}

/** The date a record's headline set was hit — what "New" is judged against. */
export function recordAchievedAt(r: LiftRecord): string {
  if (r.kind === 'weighted') return r.heaviest?.achievedAt ?? r.lastLoggedAt;
  if (r.kind === 'reps') return r.mostReps?.achievedAt ?? r.lastLoggedAt;
  return r.longestHold?.achievedAt ?? r.lastLoggedAt;
}

/** Group records under their body part, "Other" last, for the screen's sections. */
export function groupByBodyPart(
  records: LiftRecord[]
): { bodyPart: string; records: LiftRecord[] }[] {
  const groups = new Map<string, LiftRecord[]>();
  for (const r of records) {
    const key = r.bodyPart?.trim() || 'Other';
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }
  return [...groups.entries()]
    .map(([bodyPart, rs]) => ({ bodyPart, records: rs }))
    .sort((a, b) => {
      if (a.bodyPart === 'Other') return 1;
      if (b.bodyPart === 'Other') return -1;
      return a.bodyPart.localeCompare(b.bodyPart);
    });
}
