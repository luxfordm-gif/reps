// Getting the app onto the home screen.
//
// Everything that makes this feel like an app rather than a page — offline
// training, the standalone window, the icon — only happens once it has been
// installed. In a browser tab it's a website that happens to know your sets.
// So the app has to ask, and ask in whatever way the platform allows:
//
//   Chrome/Edge  fire `beforeinstallprompt`, which we hold on to and fire back
//                when the person taps Install. One tap, no instructions.
//   iOS Safari   has no such event and never will. The only route is the Share
//                sheet, so all we can do is point at it.
//   Anything else on iOS (Chrome, Firefox, the Instagram in-app browser) can't
//                install at all — the answer there is "open this in Safari".
//
// The platform sniffing below is the unhappy kind, but there's no capability to
// feature-detect: the absence of `beforeinstallprompt` is indistinguishable
// from "the event hasn't fired yet", so Safari can only be recognised by name.

/**
 * Chrome's install event. Still not in lib.dom, so it's spelled out here.
 */
export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

/**
 * How this browser can be told to install, if at all.
 *
 *   'prompt'       a real install button — the browser gave us one to fire
 *   'ios-safari'   Safari on an iPhone or iPad: Share → Add to Home Screen
 *   'ios-browser'  an iOS browser that can't install; Safari can, so say so
 *   null           nothing useful to say — already installed, snoozed, or a
 *                  desktop browser with no install path
 *
 * A bare string rather than an object because there's nothing to carry with
 * it, and because a primitive is a snapshot `useSyncExternalStore` can compare
 * without us having to cache one.
 */
export type InstallAdvice = 'prompt' | 'ios-safari' | 'ios-browser' | null;

/** Which iOS browser we're in, or null if this isn't iOS at all. */
export type IosBrowser = 'safari' | 'other';

export const DISMISSED_KEY = 'reps.installPrompt.dismissedAt';

/**
 * How long "Not now" lasts. Long enough that dismissing it feels final —
 * nobody wants to be asked again tomorrow — but not forever, because the
 * person who swatted it away on the bus is a different person from the one
 * who has since logged twenty workouts.
 */
export const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

/** When a plan was first seen on this device, in epoch ms. */
export const PLAN_READY_KEY = 'reps.installPrompt.planReadyAt';

/**
 * How long after the first plan lands before the banner is allowed to speak.
 *
 * Nothing should be asked of someone who is still arriving. Until a plan is in
 * there is only one thing to do on this app — upload one — and a card about
 * home screens on top of that screen is noise in the one place there was none.
 * Even once the plan is in, the minutes straight after are spent reading it,
 * so the banner waits those out too and turns up on a later visit instead.
 */
export const PLAN_GRACE_MS = 5 * 60 * 1000;

// --- Detection -----------------------------------------------------------------

/**
 * Is this iOS, and can the browser we're in actually install?
 *
 * Pure so it can be tested against real user-agent strings; the caller passes
 * in what `navigator` says.
 */
export function detectIos(
  userAgent: string,
  platform: string,
  maxTouchPoints: number,
): IosBrowser | null {
  const ua = userAgent.toLowerCase();
  // An iPad on iPadOS 13+ claims to be a Mac. A touch-capable "MacIntel" is
  // the only thing that separates it from a real one — a desktop Safari
  // reports maxTouchPoints 0, even on a Mac with a touch trackpad.
  const isIos = /iphone|ipad|ipod/.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1);
  if (!isIos) return null;

  // Every browser on iOS is WebKit underneath and every one of them says
  // "Safari" somewhere in its UA, so Safari is what's left after the others
  // have been named. Add to Home Screen exists in Safari alone; the in-app
  // browsers (Instagram, Facebook, LinkedIn) don't even have a Share sheet
  // worth pointing at.
  const impostor = /crios|fxios|edgios|opios|gsa\/|fban|fbav|instagram|linkedinapp/.test(ua);
  return impostor ? 'other' : 'safari';
}

/** Is the app already running from the home screen? */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  // iOS never adopted display-mode for the legacy meta-tag route, so it gets
  // checked separately. `standalone` is non-standard and iOS-only.
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  if (iosStandalone === true) return true;
  if (typeof window.matchMedia !== 'function') return false;
  // `minimal-ui` and `fullscreen` aren't what the manifest asks for, but if a
  // browser has granted one of them the app is installed either way.
  return ['standalone', 'minimal-ui', 'fullscreen'].some(
    (mode) => window.matchMedia(`(display-mode: ${mode})`).matches,
  );
}

// --- The decision --------------------------------------------------------------

export interface InstallEnv {
  /** Already on the home screen. */
  installed: boolean;
  /** The browser handed us a prompt we're holding. */
  hasDeferredPrompt: boolean;
  /** iOS and which browser, or null for everything else. */
  ios: IosBrowser | null;
  /** When "Not now" was last tapped, in epoch ms. */
  dismissedAt: number | null;
  /** Is there an active plan right now? */
  hasPlan: boolean;
  /**
   * When a plan was first seen on this device, in epoch ms — null until one
   * has been. Persisted, so the grace period is served once rather than
   * restarting on every launch.
   */
  planReadyAt: number | null;
  now: number;
}

/**
 * What, if anything, to say about installing. Pure — the whole point is that
 * the rules can be read in one place and tested without a browser.
 */
export function chooseInstallAdvice(env: InstallEnv): InstallAdvice {
  if (env.installed) return null;
  if (env.dismissedAt != null && env.now - env.dismissedAt < SNOOZE_MS) return null;
  // Nothing until there's a plan, and nothing for a while after it lands.
  // Someone still uploading — or still filling in their name — is being asked
  // to commit to an app they haven't seen do anything yet.
  if (!env.hasPlan) return null;
  if (env.planReadyAt == null || env.now - env.planReadyAt < PLAN_GRACE_MS) return null;
  // A held prompt beats the iOS advice: if a browser gave us one, one tap is
  // always better than a paragraph of instructions.
  if (env.hasDeferredPrompt) return 'prompt';
  if (env.ios === 'safari') return 'ios-safari';
  if (env.ios === 'other') return 'ios-browser';
  return null;
}

// --- Dismissal -----------------------------------------------------------------

/**
 * localStorage throws outright in Safari's private mode rather than failing
 * quietly, and a banner is never worth taking the app down for.
 */
export function readDismissedAt(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function markDismissed(now: number = Date.now()): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DISMISSED_KEY, String(now));
  } catch {
    // Private mode. The banner comes back next launch; that's the cost.
  }
  notify();
}

// --- The plan gate -------------------------------------------------------------

/**
 * Whether there is a plan right now. Session-only and default false: the
 * banner stays quiet until Home has actually loaded and said otherwise, which
 * is also what keeps it quiet for a second account signing in on a phone that
 * already carries the stamp below.
 */
let hasPlan = false;

/**
 * A mirror of the persisted stamp, for a browser that won't give us storage.
 * Without it Safari's private mode would never open the gate at all.
 */
let planReadyAtMemo: number | null = null;

export function readPlanReadyAt(): number | null {
  if (typeof window === 'undefined') return planReadyAtMemo;
  try {
    const raw = window.localStorage.getItem(PLAN_READY_KEY);
    const n = raw == null ? NaN : Number(raw);
    if (Number.isFinite(n)) return n;
  } catch {
    // Private mode. The in-memory copy is all there is.
  }
  return planReadyAtMemo;
}

/**
 * Home reporting what it just loaded. Called with `true` the first time a plan
 * is seen, which starts the grace period; the stamp is written once and never
 * moved, so uploading a second plan doesn't buy another five minutes of quiet.
 */
export function notePlanState(present: boolean, now: number = Date.now()): void {
  const had = hasPlan;
  hasPlan = present;
  let stamped = false;
  if (present && readPlanReadyAt() == null) {
    planReadyAtMemo = now;
    try {
      window.localStorage.setItem(PLAN_READY_KEY, String(now));
    } catch {
      // Private mode: the stamp lasts as long as the tab does.
    }
    stamped = true;
  }
  if (stamped || had !== present) notify();
}

// --- The live bit --------------------------------------------------------------

let deferred: BeforeInstallPromptEvent | null = null;
let installedDuringSession = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

/**
 * Start listening for the install event.
 *
 * Called from main.tsx rather than from the banner, and deliberately so:
 * Chrome fires `beforeinstallprompt` once, early, and often before React has
 * mounted. A component that subscribed on mount would miss it and the Install
 * button would simply never appear.
 */
export function startInstallWatch(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('beforeinstallprompt', (e) => {
    // Without this Chrome shows its own mini-infobar, and we lose the ability
    // to ask at a moment of our choosing.
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });

  window.addEventListener('appinstalled', () => {
    // Fires for the browser's own install path too, not just ours — so the
    // banner goes away even when they installed it from the address bar.
    deferred = null;
    installedDuringSession = true;
    notify();
  });
}

export function subscribeInstall(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The env as it stands right now, ready for `chooseInstallAdvice`. */
export function readInstallEnv(): InstallEnv {
  return {
    installed: installedDuringSession || isStandalone(),
    hasDeferredPrompt: deferred !== null,
    ios:
      typeof navigator === 'undefined'
        ? null
        : detectIos(navigator.userAgent, navigator.platform, navigator.maxTouchPoints),
    dismissedAt: readDismissedAt(),
    hasPlan,
    planReadyAt: readPlanReadyAt(),
    now: Date.now(),
  };
}

/**
 * What to say right now. The snapshot `useSyncExternalStore` reads — a string,
 * so equal answers compare equal and the banner doesn't re-render on every
 * pass.
 */
export function getInstallAdvice(): InstallAdvice {
  return chooseInstallAdvice(readInstallEnv());
}

/**
 * Fire the browser's install dialog. The event is single-use — spent whether
 * they accept or decline — so it's dropped either way.
 */
export async function promptToInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferred;
  if (!event) return 'unavailable';
  deferred = null;
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    // Either way they have answered, so stop asking: `appinstalled` settles an
    // accept, but it doesn't fire in the tab they installed *from*, and a
    // decline has no event at all.
    markDismissed();
    return outcome;
  } catch {
    // The prompt itself failed — that isn't an answer, so don't snooze on it.
    notify();
    return 'unavailable';
  }
}
