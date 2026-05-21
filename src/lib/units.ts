// Weight unit handling.
//
// Storage: always kilograms in the database.
// Body-weight display: kg or st (UK stones + pounds). Pure lb is reserved for
// lift weights (added later) where stones don't make sense.

export type LiftWeightUnit = 'kg' | 'lb';
export type BodyWeightUnit = 'kg' | 'st';
// Per-machine unit. 'pin' is for stack machines where the user logs the pin
// position rather than a calibrated weight — stored 1:1 in the kg column.
export type MachineUnit = 'kg' | 'lb' | 'pin';

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

// Lift weight value <-> stored kg, generalised over MachineUnit. Pin units
// store and display the same number (1:1) — there is no physical conversion.
export function fromKgFor(kg: number, unit: MachineUnit): number {
  if (unit === 'lb') return Math.round(kgToLb(kg) * 2) / 2;
  return kg;
}

export function toKgFor(n: number, unit: MachineUnit): number {
  if (unit === 'lb') return lbToKg(n);
  return n;
}

export function formatWeight(kg: number | null | undefined, unit: MachineUnit): string {
  if (kg == null) return '–';
  const v = fromKgFor(kg, unit);
  if (unit === 'pin') return `pin ${v}`;
  return `${v} ${unit}`;
}

// Height handling. Storage is always centimetres.

export type HeightUnit = 'cm' | 'ftin';

const CM_PER_INCH = 2.54;

export function cmToFtIn(cm: number): { feet: number; inches: number } {
  const totalIn = cm / CM_PER_INCH;
  const feet = Math.floor(totalIn / 12);
  const inches = totalIn - feet * 12;
  return { feet, inches };
}

export function ftInToCm(feet: number, inches: number): number {
  return (feet * 12 + inches) * CM_PER_INCH;
}

export function formatFtIn(cm: number): string {
  const { feet, inches } = cmToFtIn(cm);
  let f = feet;
  let i = Math.round(inches);
  if (i === 12) {
    f += 1;
    i = 0;
  }
  return `${f}′ ${i}″`;
}

const H_PREF = 'reps.heightUnit';

export function getHeightUnit(): HeightUnit {
  if (typeof window === 'undefined') return 'cm';
  return window.localStorage.getItem(H_PREF) === 'ftin' ? 'ftin' : 'cm';
}

export function setHeightUnit(unit: HeightUnit) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(H_PREF, unit);
}
