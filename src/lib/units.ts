// Weight unit handling.
//
// Storage: always kilograms in the database.
// Body-weight display: kg or st (UK stones + pounds). Pure lb is reserved for
// lift weights (added later) where stones don't make sense.

export type LiftWeightUnit = 'kg' | 'lb';
export type BodyWeightUnit = 'kg' | 'st';

const KG_PER_LB = 0.45359237;
const LB_PER_STONE = 14;

export function lbToKg(lb: number): number {
  return lb * KG_PER_LB;
}

export function kgToLb(kg: number): number {
  return kg / KG_PER_LB;
}

export function kgToStoneLb(kg: number): { stones: number; pounds: number } {
  const totalLb = kgToLb(kg);
  const stones = Math.floor(totalLb / LB_PER_STONE);
  const pounds = totalLb - stones * LB_PER_STONE;
  return { stones, pounds };
}

export function stoneLbToKg(stones: number, pounds: number): number {
  return lbToKg(stones * LB_PER_STONE + pounds);
}

export function formatStoneLb(kg: number): string {
  const { stones, pounds } = kgToStoneLb(kg);
  let p = Math.round(pounds);
  let s = stones;
  if (p === LB_PER_STONE) {
    s += 1;
    p = 0;
  }
  return `${s} st ${p} lb`;
}

// Body weight preference (kg / st)
const BW_PREF = 'reps.bodyWeightUnit';

export function getBodyWeightUnit(): BodyWeightUnit {
  if (typeof window === 'undefined') return 'kg';
  const v = window.localStorage.getItem(BW_PREF);
  return v === 'st' ? 'st' : 'kg';
}

export function setBodyWeightUnit(unit: BodyWeightUnit) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(BW_PREF, unit);
}

// Lift weight preference (kg / lb) — used later
const LW_PREF = 'reps.liftWeightUnit';

export function getLiftWeightUnit(): LiftWeightUnit {
  if (typeof window === 'undefined') return 'kg';
  const v = window.localStorage.getItem(LW_PREF);
  return v === 'lb' ? 'lb' : 'kg';
}

export function setLiftWeightUnit(unit: LiftWeightUnit) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LW_PREF, unit);
}
