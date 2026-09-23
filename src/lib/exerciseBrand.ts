// A machine's brand, told apart from the movement it trains.
//
// Coaches write a branded machine as one string — "PRIME PEC DECK FLY",
// "REVERSE PEC DECK PRIME" — and the app keeps it that way: the whole name is
// the machine's identity, because 60 kg on a Prime chest press is not 60 kg on
// a Hammer Strength one. The brand is only pulled apart for display ("Pec deck
// fly" with "Prime" under it) and for entry, where it gets its own field and is
// put back on the front of the name.

import { normalizeExerciseName } from './normalizeExerciseName';
import { MACHINE_MAKERS, brandSuggestions } from './machineCatalogue';

interface BrandPattern {
  /** Lower-cased, as it's looked for in a name. */
  text: string;
  /** How it's shown. */
  spelling: string;
  startOnly: boolean;
}

// Every way a known maker can be written — its name or an alias, alone or
// followed by one of its lines — mapped to how it's shown. "Hammer" alone is a
// curl, so it isn't here; only "Hammer Strength" is.
const KNOWN_PATTERNS: BrandPattern[] = MACHINE_MAKERS.flatMap((maker) => {
  const names = [maker.name, ...(maker.aliases ?? [])];
  const startOnly = !!maker.startOnly;
  return names.flatMap((n) => [
    { text: n.toLowerCase(), spelling: maker.name, startOnly },
    ...(maker.lines ?? []).map((line) => ({
      text: `${n} ${line}`.toLowerCase(),
      spelling: `${maker.name} ${line}`,
      startOnly,
    })),
  ]);
});

const KNOWN_BY_TEXT = new Map(KNOWN_PATTERNS.map((p) => [p.text, p.spelling]));

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

/** The catalogue's spelling of a maker, or a maker and line, if it knows it. */
function knownSpelling(brand: string): string | undefined {
  return KNOWN_BY_TEXT.get(brand.toLowerCase().replace(/\s+/g, ' '));
}

// Built once per change to the typed brands: every name on screen is split
// on each render, and there are a few hundred patterns.
let patternCache: BrandPattern[] | null = null;

function allPatterns(): BrandPattern[] {
  if (patternCache) return patternCache;
  const custom = customBrands.map((b) => ({ text: b.toLowerCase(), spelling: b, startOnly: false }));
  // Longest first, so "Cybex Eagle" is tried before "Cybex" and "Hammer
  // Strength" as a whole before anything shorter could claim part of it.
  patternCache = [...KNOWN_PATTERNS, ...custom].sort((a, b) => b.text.length - a.text.length);
  return patternCache;
}

/** Adds brands the user typed so names carrying them split too. Makers in the
 *  catalogue aren't stored — they already split. True when the list grew. */
export function rememberBrands(brands: Iterable<string | null | undefined>): boolean {
  let changed = false;
  for (const raw of brands) {
    const b = cleanBrand(raw);
    if (!b || knownSpelling(b)) continue;
    if (customBrands.some((c) => c.toLowerCase() === b.toLowerCase())) continue;
    customBrands = [...customBrands, b];
    patternCache = null;
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
  patternCache = null;
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
 * Splits a brand out of an exercise name. The brand has to be whole words and
 * something has to be left over, so "Prime" on its own stays a name. The
 * movement is returned starting with a capital, as names are shown.
 *
 *   "Prime pec deck fly"                   → { movement: "Pec deck fly", brand: "Prime" }
 *   "Reverse pec deck prime"               → { movement: "Reverse pec deck", brand: "Prime" }
 *   "Single arm hammer strength pulldown"  → { movement: "Single arm pulldown", brand: "Hammer Strength" }
 *   "Cable shoulder press, Nautilus"       → { movement: "Cable shoulder press", brand: "Nautilus" }
 *   "Rope hammer curl"                     → { movement: "Rope hammer curl", brand: null }
 *
 * A brand at either end is looked for first; one in the middle only when no
 * brand is at an end. Makers marked startOnly count only at the front.
 */
export function splitBrand(name: string): SplitName {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  const lower = trimmed.toLowerCase();
  const patterns = allPatterns();
  const byText = new Map(patterns.map((p) => [p.text, p.spelling]));

  // A brand set off by a comma — "Cable shoulder press, Nautilus", "Flex, Dip
  // machine". The comma says it's a label rather than part of the movement, so
  // even makers that only count at the front are taken from the end here.
  // A dash does the same job: "Preacher curl - Gymleco".
  const parts = trimmed.split(/,| [-–—] /).map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const last = byText.get(parts[parts.length - 1].toLowerCase());
    if (last) return found(parts.slice(0, -1).join(', '), last);
    const first = byText.get(parts[0].toLowerCase());
    if (first) return found(parts.slice(1).join(', '), first);
  }

  for (const p of patterns) {
    const b = p.text;
    if (!b || lower.length <= b.length + 1) continue;
    if (lower.startsWith(b + ' ')) {
      return found(trimmed.slice(b.length + 1), p.spelling);
    }
    if (!p.startOnly && lower.endsWith(' ' + b)) {
      return found(trimmed.slice(0, trimmed.length - b.length - 1), p.spelling);
    }
  }
  for (const p of patterns) {
    if (!p.text || p.startOnly) continue;
    const at = lower.indexOf(' ' + p.text + ' ');
    if (at < 0) continue;
    const before = trimmed.slice(0, at);
    const after = trimmed.slice(at + p.text.length + 2);
    return found(`${before} ${after}`, p.spelling);
  }
  return { movement: trimmed, brand: null };

  // What's left has to read as a movement. "Teca 540" is a machine's model
  // number, and "540" under a brand says nothing, so it stays one name.
  function found(movement: string, brand: string): SplitName {
    const m = movement.trim();
    if (!/[a-z]{2}/i.test(m)) return { movement: trimmed, brand: null };
    return { movement: capitalise(m), brand };
  }
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

/**
 * Brands to offer while one is being typed: makers and their lines from the
 * catalogue, plus brands typed before. A word starting with what's typed
 * ranks above a match further inside ("cy" finds Cybex before anything else),
 * and nothing is offered once the field already says exactly one of them.
 */
export function matchBrands(query: string, limit = 5): string[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return [];
  const all = [...new Set([...brandSuggestions(), ...customBrands])];
  if (all.some((b) => b.toLowerCase() === q)) return [];
  const starts: string[] = [];
  const contains: string[] = [];
  for (const b of all) {
    const lower = b.toLowerCase();
    if (lower.startsWith(q) || lower.includes(' ' + q)) starts.push(b);
    else if (lower.includes(q)) contains.push(b);
  }
  // Shorter first within each group, so the maker comes before its lines.
  const byLength = (a: string, b: string) => a.length - b.length || a.localeCompare(b);
  return [...starts.sort(byLength), ...contains.sort(byLength)].slice(0, limit);
}
