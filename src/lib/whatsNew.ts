// When the "What's new" dialog is allowed to appear.
//
// It is for people who have been using Reps and want to know what changed
// since last time. Someone who signed up ten minutes ago has no "last time" —
// every screen is new to them — so release notes in front of the upload screen
// are noise at the worst possible moment, and the notes themselves refer to
// things they have never seen.
//
// So the dialog waits for a plan. A plan is the point where signing up is
// behind you and the app is something you use: the PDF is in, Home has days on
// it, and a release after that is genuinely news. Everything shipped before
// that moment is baselined away silently — it was all new to you anyway.

/**
 * What Home knows about whether there's a plan.
 *
 * "unknown" matters as much as the other two: Home starts with whatever was
 * cached and fills in after a fetch, and an offline phone with no cached copy
 * never finds out. Treating a not-yet-loaded plan as "none" would throw away a
 * settled user's baseline on every cold start.
 */
export type PlanPresence = 'unknown' | 'none' | 'plan';

export type WhatsNewAction =
  /** Nothing is known yet — ask again when it is. */
  | 'wait'
  /** Drop the recorded version: it was written before this user had a plan. */
  | 'forget'
  /** Record the current version without showing anything. */
  | 'baseline'
  /** Show the dialog. */
  | 'show'
  /** Already up to date. */
  | 'nothing';

/**
 * What a recorded version is worth now, following any entry that has since been
 * withdrawn down to the one below it.
 *
 * A withdrawn entry can itself point at one that was withdrawn later, so this
 * walks the chain — bounded, because a map written by hand can be made to
 * point at itself.
 */
function effectiveSeen(seen: string, withdrawn: Readonly<Record<string, string>>): string {
  let version = seen;
  for (let hops = 0; hops < 20; hops += 1) {
    const next = withdrawn[version];
    if (next === undefined || next === version) break;
    version = next;
  }
  return version;
}

export function decideWhatsNew(args: {
  planPresence: PlanPresence;
  seen: string | null;
  latest: string;
  /** Entries withdrawn since they shipped — WITHDRAWN_VERSIONS. */
  withdrawn: Readonly<Record<string, string>>;
}): WhatsNewAction {
  const { planPresence, seen, latest, withdrawn } = args;
  if (planPresence === 'unknown') return 'wait';

  // No plan: there is nothing to announce, and any version recorded while the
  // user was in this state is meaningless — it would otherwise become the
  // "last time" they are measured against, and the first release after they
  // upload would pop a dialog full of changes to an app they had never used.
  // This is also what repairs devices that recorded a version under the old
  // rule, which baselined on sign-in.
  if (planPresence === 'none') return seen === null ? 'nothing' : 'forget';

  // First time we've seen this user with a plan: start the clock here, quietly.
  if (seen === null) return 'baseline';

  // A device can be carrying an entry that has since been withdrawn. What it
  // is worth is the entry that sat below it — those notes they have read, the
  // withdrawn ones never counted. Resolving it first, rather than treating it
  // as unrecognised, is what lets both halves come out right: no replay of the
  // entry underneath, and no swallowing a real release that has shipped since.
  if (effectiveSeen(seen, withdrawn) === latest) return 'nothing';

  return 'show';
}

const SEEN_KEY = 'reps.lastSeenVersion';

// localStorage throws outright in Safari's private mode rather than failing
// quietly, and release notes are never worth taking the app down for.
export function readSeenVersion(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

export function writeSeenVersion(version: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SEEN_KEY, version);
  } catch {
    // Private mode: the dialog may come back next launch. That's the cost.
  }
}

export function forgetSeenVersion(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(SEEN_KEY);
  } catch {
    // Nothing stored, nothing to clear.
  }
}
