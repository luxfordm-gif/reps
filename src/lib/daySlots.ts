// One card per day type, whichever week's version is due.
//
// A rotating plan has two versions of each training day — "Legs 1" and
// "Legs 2" — done on alternating weeks. Rather than tracking a plan-wide
// "current week", each day type is a slot that alternates on its own, the same
// way a weekly exercise alternative does: whichever version you completed last,
// the other one is due. Miss a week and nothing skips; the slot just carries on
// from where you left it.

import type { FullPlan } from './plansApi';

type TrainingDay = FullPlan['training_days'][number];

export interface DaySlot {
  /** The day type — "Legs", not "Legs 1". */
  name: string;
  /** This slot's versions, one per rotation week, sorted by week. */
  variants: TrainingDay[];
}

/** "Legs 2" → "Legs". Names without a rotation number pass through. */
export function baseDayName(name: string): string {
  return name.replace(/\s+\d+$/, '');
}

/**
 * Group a plan's days into slots, in the order the cards should show:
 * gym days by plan position, then reference days (the home abs workout), with
 * Upper last — it's the plan's optional extra, done after the core three.
 * A plan with no rotation comes out as single-variant slots in plan order.
 */
export function buildDaySlots(days: TrainingDay[]): DaySlot[] {
  const byName = new Map<string, DaySlot>();
  for (const day of days) {
    const name = baseDayName(day.name);
    let slot = byName.get(name);
    if (!slot) {
      slot = { name, variants: [] };
      byName.set(name, slot);
    }
    slot.variants.push(day);
  }
  const slots = [...byName.values()];
  for (const slot of slots) {
    slot.variants.sort((a, b) => (a.week_index ?? 0) - (b.week_index ?? 0));
  }

  const isReference = (s: DaySlot) => s.variants.every((v) => v.reference_only === true);
  const isUpper = (s: DaySlot) => /^upper$/i.test(s.name);
  const main = slots.filter((s) => !isReference(s) && !isUpper(s));
  const reference = slots.filter(isReference);
  const upper = slots.filter((s) => !isReference(s) && isUpper(s));
  return [...main, ...reference, ...upper];
}

/**
 * The version of a slot that's due, given when each training day was last
 * completed: one that's never been done, else the one done longest ago; ties go
 * to the earliest week. Completing Legs 1 makes Legs 2 due, and vice versa.
 */
export function dueVariant(
  slot: DaySlot,
  lastCompletedAtByDayId: ReadonlyMap<string, string>
): TrainingDay {
  let best = slot.variants[0];
  let bestAt = lastCompletedAtByDayId.get(best?.id ?? '') ?? null;
  for (const variant of slot.variants.slice(1)) {
    const at = lastCompletedAtByDayId.get(variant.id) ?? null;
    if (bestAt == null) break; // an earlier never-done variant wins outright
    if (at == null || at < bestAt) {
      best = variant;
      bestAt = at;
    }
  }
  return best;
}

/** The slot's other version, for the "show the other week instead" switch. */
export function siblingVariant(slot: DaySlot, day: TrainingDay): TrainingDay | null {
  if (slot.variants.length < 2) return null;
  return slot.variants.find((v) => v.id !== day.id) ?? null;
}
