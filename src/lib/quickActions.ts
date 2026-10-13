// Which tiles sit in Home's "Quick actions" row, and in what order.
//
// The row scrolls sideways, so the order is the setting that matters most:
// whatever is first is what you see without moving your thumb. Stored as a
// plain list of ids in localStorage — the same shape as the other home-screen
// preferences — and validated on read so an old or hand-edited value can't
// render a tile that no longer exists.

export type QuickActionId = 'water' | 'coffee' | 'steps' | 'weight' | 'sleep';

export interface QuickActionMeta {
  id: QuickActionId;
  label: string;
  hint: string;
}

/** Every tile the row can show, in the order the settings screen lists them. */
export const QUICK_ACTION_META: QuickActionMeta[] = [
  { id: 'water', label: 'Water', hint: 'Tap to add, hold to remove' },
  { id: 'coffee', label: 'Coffee', hint: 'Tap to add, hold to remove' },
  { id: 'weight', label: 'Log weight', hint: 'Opens the body weight log' },
  { id: 'steps', label: 'Steps', hint: "Opens today's step count" },
  { id: 'sleep', label: 'Sleep', hint: "Opens last night's hours" },
];

const ALL_IDS: QuickActionId[] = QUICK_ACTION_META.map((a) => a.id);

/** The three tiles that were here before keep their order, with steps and
 *  then sleep added on the end — the ones you scroll to, and the only ones
 *  that open a screen rather than count a tap. */
export const DEFAULT_QUICK_ACTIONS: QuickActionId[] = ['water', 'coffee', 'weight', 'steps', 'sleep'];

const KEY = 'reps.quickActions';
/** Every tile that existed when the list was last saved. A tile added since is
 *  switched on once, at the end, for people who had already set up their row —
 *  otherwise a new tile only ever reaches people who never opened the setting. */
const OFFERED_KEY = 'reps.quickActionsOffered';
/** What existed before OFFERED_KEY did, for a list saved by an older build. */
const LEGACY_OFFERED: QuickActionId[] = ['water', 'coffee', 'weight', 'steps'];

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

/** A saved list with any tile that didn't exist when it was saved added on
 *  the end. A tile someone saw and switched off stays off. */
export function withNewQuickActions(ids: QuickActionId[], offered: unknown): QuickActionId[] {
  const known = Array.isArray(offered) ? offered.filter(isQuickActionId) : LEGACY_OFFERED;
  const added = ALL_IDS.filter((id) => !known.includes(id) && !ids.includes(id));
  return added.length > 0 ? [...ids, ...added] : ids;
}

export function getQuickActions(): QuickActionId[] {
  if (typeof window === 'undefined') return [...DEFAULT_QUICK_ACTIONS];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [...DEFAULT_QUICK_ACTIONS];
    const saved = normalizeQuickActions(JSON.parse(raw));
    const offeredRaw = window.localStorage.getItem(OFFERED_KEY);
    const ids = withNewQuickActions(saved, offeredRaw ? JSON.parse(offeredRaw) : null);
    if (ids !== saved || !offeredRaw) setQuickActions(ids);
    return ids;
  } catch {
    return [...DEFAULT_QUICK_ACTIONS];
  }
}

export function setQuickActions(ids: QuickActionId[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(normalizeQuickActions(ids)));
    window.localStorage.setItem(OFFERED_KEY, JSON.stringify(ALL_IDS));
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
