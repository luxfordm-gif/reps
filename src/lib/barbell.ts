export type BarIcon = 'easy' | 'standard';

export type Bar = {
  id: string;
  label: string;
  weightKg: number;
  icon: BarIcon;
};

export const BARS: Bar[] = [
  { id: 'easy', label: 'Easy bar', weightKg: 10, icon: 'easy' },
  { id: 'womens', label: "Women's 15kg bar", weightKg: 15, icon: 'standard' },
  { id: 'mens', label: '25kg bar', weightKg: 25, icon: 'standard' },
];

export const STANDARD_PLATES_KG = [25, 20, 15, 10, 5, 2.5, 1.25, 0.5] as const;

export function totalKg(barWeightKg: number, platesPerSide: number[]) {
  const oneSide = platesPerSide.reduce((a, b) => a + b, 0);
  return { oneSide, total: barWeightKg + oneSide * 2 };
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
