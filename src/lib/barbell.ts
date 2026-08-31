export type BarIcon = 'easy' | 'standard';

export type Bar = {
  id: string;
  label: string;
  weightKg: number;
  icon: BarIcon;
};

export const BARS: Bar[] = [
  { id: 'easy', label: 'Easy bar', weightKg: 10, icon: 'easy' },
  { id: 'mens', label: 'Olympic bar', weightKg: 25, icon: 'standard' },
  { id: 'womens', label: "Women's bar", weightKg: 15, icon: 'standard' },
];

export const STANDARD_PLATES_KG = [25, 20, 15, 10, 5, 2.5, 1.25, 0.5] as const;

export function totalKg(barWeightKg: number, platesPerSide: number[]) {
  const oneSide = platesPerSide.reduce((a, b) => a + b, 0);
  return { oneSide, total: barWeightKg + oneSide * 2 };
}

/*
 * Plate-list operations. One side's plates are a flat array sorted heaviest
 * first, which is also the order they sit on the bar — so an array index is
 * the plate you tapped.
 */

export function addPlate(plates: number[], kg: number): number[] {
  return [...plates, kg].sort((a, b) => b - a);
}

/** Removes the plate at a position on the bar, not every plate of that size. */
export function removePlateAt(plates: number[], index: number): number[] {
  return plates.filter((_, i) => i !== index);
}

/** Drops one plate of a size — what tapping its chip does. */
export function removeOneOfSize(plates: number[], kg: number): number[] {
  const idx = plates.findIndex((x) => x === kg);
  if (idx === -1) return plates;
  return plates.filter((_, i) => i !== idx);
}

export function setQuantityOfSize(plates: number[], kg: number, count: number): number[] {
  const next = plates.filter((x) => x !== kg);
  for (let i = 0; i < count; i++) next.push(kg);
  return next.sort((a, b) => b - a);
}

export function groupPlates(plates: number[]): { kg: number; count: number }[] {
  const map = new Map<number, number>();
  for (const p of plates) map.set(p, (map.get(p) ?? 0) + 1);
  return [...map.entries()]
    .map(([kg, count]) => ({ kg, count }))
    .sort((a, b) => b.kg - a.kg);
}

const KEY_LAST_BAR_ID = 'reps.barbell.lastBarId';
const KEY_CUSTOM_BAR_KG = 'reps.barbell.customBarKg';
const KEY_CUSTOM_PLATES = 'reps.barbell.customPlates';

function safeLocalStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function getLastBarId(): string | null {
  return safeLocalStorage()?.getItem(KEY_LAST_BAR_ID) ?? null;
}

export function setLastBarId(id: string): void {
  safeLocalStorage()?.setItem(KEY_LAST_BAR_ID, id);
}

export function getCustomBarKg(): number | null {
  const raw = safeLocalStorage()?.getItem(KEY_CUSTOM_BAR_KG);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function setCustomBarKg(kg: number): void {
  safeLocalStorage()?.setItem(KEY_CUSTOM_BAR_KG, String(kg));
}

export function getCustomPlates(): number[] {
  const raw = safeLocalStorage()?.getItem(KEY_CUSTOM_PLATES);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((n) => typeof n === 'number' && Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}

export function addCustomPlate(kg: number): number[] {
  const ls = safeLocalStorage();
  if (!ls) return [];
  const existing = new Set(getCustomPlates());
  existing.add(kg);
  const next = [...existing].sort((a, b) => b - a);
  ls.setItem(KEY_CUSTOM_PLATES, JSON.stringify(next));
  return next;
}
