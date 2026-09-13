// Which tiles sit in Home's "Quick actions" row, and in what order.
//
// The row scrolls sideways, so the order is the setting that matters most:
// whatever is first is what you see without moving your thumb. Stored as a
// plain list of ids in localStorage — the same shape as the other home-screen
// preferences — and validated on read so an old or hand-edited value can't
// render a tile that no longer exists.

export type QuickActionId = 'water' | 'coffee' | 'steps' | 'weight';

export interface QuickActionMeta {
  id: QuickActionId;
  label: string;
  hint: string;
}

/** Every tile the row can show, in the order the settings screen lists them. */
export const QUICK_ACTION_META: QuickActionMeta[] = [
  { id: 'water', label: 'Water', hint: 'Tap to add, hold to remove' },
  { id: 'coffee', label: 'Coffee', hint: 'Tap to add, hold to remove' },
  { id: 'steps', label: 'Steps', hint: "Opens today's step count" },
  { id: 'weight', label: 'Log weight', hint: 'Opens the body weight log' },
];

const ALL_IDS: QuickActionId[] = QUICK_ACTION_META.map((a) => a.id);

/** Water and coffee first because they're tapped several times a day; steps
 *  third so it peeks in from the right edge and the row reads as scrollable. */
export const DEFAULT_QUICK_ACTIONS: QuickActionId[] = ['water', 'coffee', 'steps', 'weight'];

const KEY = 'reps.quickActions';

function isQuickActionId(v: unknown): v is QuickActionId {
  return typeof v === 'string' && (ALL_IDS as string[]).includes(v);
}

/**
 * The stored list, cleaned up: unknown ids dropped, duplicates removed. An
 * empty or unreadable value falls back to the default — the row is the only
 * way to log water, so it never resolves to nothing.
 */
export function normalizeQuickActions(value: unknown): QuickActionId[] {
  if (!Array.isArray(value)) return [...DEFAULT_QUICK_ACTIONS];
  const out: QuickActionId[] = [];
  for (const v of value) {
    if (isQuickActionId(v) && !out.includes(v)) out.push(v);
  }
  return out.length > 0 ? out : [...DEFAULT_QUICK_ACTIONS];
}

export function getQuickActions(): QuickActionId[] {
  if (typeof window === 'undefined') return [...DEFAULT_QUICK_ACTIONS];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [...DEFAULT_QUICK_ACTIONS];
    return normalizeQuickActions(JSON.parse(raw));
  } catch {
    return [...DEFAULT_QUICK_ACTIONS];
  }
}

export function setQuickActions(ids: QuickActionId[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(normalizeQuickActions(ids)));
  } catch {
    // localStorage unavailable — the row just keeps whatever is on screen.
  }
}

/** Turn a tile on (appended to the end) or off. Turning the last one off is
 *  refused: an empty row would leave no way back to these screens from Home. */
export function toggleQuickAction(
  ids: QuickActionId[],
  id: QuickActionId
): QuickActionId[] {
  if (ids.includes(id)) {
    if (ids.length <= 1) return ids;
    return ids.filter((i) => i !== id);
  }
  return [...ids, id];
}

/** Move a tile one place towards the front (-1) or the back (+1). */
export function moveQuickAction(
  ids: QuickActionId[],
  id: QuickActionId,
  delta: -1 | 1
): QuickActionId[] {
  const from = ids.indexOf(id);
  if (from === -1) return ids;
  const to = from + delta;
  if (to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}
