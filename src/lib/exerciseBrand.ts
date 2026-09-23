// A machine's brand, told apart from the movement it trains.
//
// Coaches write a branded machine as one string — "PRIME PEC DECK FLY",
// "REVERSE PEC DECK PRIME" — and the app keeps it that way: the whole name is
// the machine's identity, because 60 kg on a Prime chest press is not 60 kg on
// a Hammer Strength one. The brand is only pulled apart for display ("Pec deck
// fly" with "Prime" under it) and for entry, where it gets its own field and is
// put back on the front of the name.

import { normalizeExerciseName } from './normalizeExerciseName';

// Gym-equipment makers as they spell themselves. Only brands that can't be read
// as part of a movement: "Hammer" alone is a curl, so only "Hammer Strength"
// counts, and "Pulse" is left out for the same reason.
export const KNOWN_BRANDS = [
  'Arsenal Strength',
  'Atlantis',
  'BodyMaster',
  'Cybex',
  'Eleiko',
  'Freemotion',
  'Gym80',
  'Hammer Strength',
  'Hoist',
  'Keiser',
  'Life Fitness',
  'Matrix',
  'Nautilus',
  'Panatta',
  'Precor',
  'Prime',
  'Star Trac',
  'Technogym',
  'Watson',
] as const;

const CUSTOM_KEY = 'reps.customBrands';

let customBrands: string[] = readCustomBrands();

function readCustomBrands(): string[] {
  try {
    if (typeof window === 'undefined') return [];
    const raw = window.localStorage.getItem(CUSTOM_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((b): b is string => typeof b === 'string') : [];
  } catch {
    return [];
  }
}

function writeCustomBrands(): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(CUSTOM_KEY, JSON.stringify(customBrands));
  } catch {
    // Private mode or full storage: the brand still splits for this visit.
  }
}

/** Trims and collapses a typed brand. Returns null when nothing is left. */
export function cleanBrand(brand: string | null | undefined): string | null {
  const b = (brand ?? '').trim().replace(/\s+/g, ' ');
  return b ? b : null;
}

function knownSpelling(brand: string): string | undefined {
  const key = brand.toLowerCase();
  return KNOWN_BRANDS.find((k) => k.toLowerCase() === key);
}

/** Every brand the app will split off a name: the known makers plus any the
 *  user has typed into a brand field. */
export function allBrands(): string[] {
  return [...KNOWN_BRANDS, ...customBrands];
}

/** Adds brands the user typed so names carrying them split too. Known makers
 *  aren't stored — they already split. True when the list grew. */
export function rememberBrands(brands: Iterable<string | null | undefined>): boolean {
  let changed = false;
  for (const raw of brands) {
    const b = cleanBrand(raw);
    if (!b || knownSpelling(b)) continue;
    if (customBrands.some((c) => c.toLowerCase() === b.toLowerCase())) continue;
    customBrands = [...customBrands, b];
    changed = true;
  }
  if (changed) writeCustomBrands();
  return changed;
}

/** The brands the user has typed that aren't known makers. */
export function customBrandList(): string[] {
  return [...customBrands];
}

/** Test hook: forgets the typed brands. */
export function resetCustomBrands(): void {
  customBrands = [];
  writeCustomBrands();
}

function capitalise(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export interface SplitName {
  movement: string;
  brand: string | null;
}

/**
 * Splits a brand off the start or end of an exercise name. The brand has to be
 * whole words and something has to be left over, so "Prime" on its own stays a
 * name. The movement is returned starting with a capital, as names are shown.
 *
 *   "Prime pec deck fly"       → { movement: "Pec deck fly", brand: "Prime" }
 *   "Reverse pec deck prime"   → { movement: "Reverse pec deck", brand: "Prime" }
 *   "Rope hammer curl"         → { movement: "Rope hammer curl", brand: null }
 */
export function splitBrand(name: string, brands: readonly string[] = allBrands()): SplitName {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  const lower = trimmed.toLowerCase();
  // Longest first, so "Hammer Strength" is tried as a whole before anything
  // shorter could claim part of it.
  const ordered = [...brands].sort((a, b) => b.length - a.length);
  for (const raw of ordered) {
    const brand = cleanBrand(raw);
    if (!brand) continue;
    const b = brand.toLowerCase();
    if (lower.length <= b.length + 1) continue;
    const spelling = knownSpelling(brand) ?? brand;
    if (lower.startsWith(b + ' ')) {
      return { movement: capitalise(trimmed.slice(b.length + 1).trim()), brand: spelling };
    }
    if (lower.endsWith(' ' + b)) {
      return {
        movement: capitalise(trimmed.slice(0, trimmed.length - b.length - 1).trim()),
        brand: spelling,
      };
    }
  }
  return { movement: trimmed, brand: null };
}

/** Puts a brand back on the front of a movement: ("Chest press", "Prime") →
 *  "Prime chest press". A blank brand leaves the movement as it is. */
export function composeName(movement: string, brand: string | null | undefined): string {
  const m = movement.trim().replace(/\s+/g, ' ');
  const b = cleanBrand(brand);
  if (!b) return m;
  if (!m) return b;
  // "Chest press" reads as "Prime chest press", but "EZ bar curl" keeps its
  // capitals.
  const rest = /^[A-Z][a-z]/.test(m) ? m.charAt(0).toLowerCase() + m.slice(1) : m;
  return `${b} ${rest}`;
}

/**
 * The name an edit comes to: the original name, untouched, when neither field
 * changed, and the fields joined when either did. Splitting "Reverse pec deck
 * prime" and joining it again gives "Prime reverse pec deck" — a different key —
 * so an edit that changes nothing must not go through composeName.
 */
export function editedName(initialName: string, movement: string, brand: string | null | undefined): string {
  const initial = splitBrand(initialName);
  const same =
    normalizeExerciseName(composeName(movement, brand)) ===
    normalizeExerciseName(composeName(initial.movement, initial.brand));
  if (same) return initialName.trim();
  return movement.trim() ? composeName(movement, brand) : '';
}

/** The identity key for a movement on a brand of machine. */
export function exerciseKey(movement: string, brand: string | null | undefined): string {
  return normalizeExerciseName(composeName(movement, brand));
}
