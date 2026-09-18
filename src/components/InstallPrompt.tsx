import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  getInstallAdvice,
  markDismissed,
  promptToInstall,
  subscribeInstall,
  type InstallAdvice,
} from '../lib/installPrompt';
import { haptics } from '../lib/haptics';

/**
 * The nudge to put Reps on the home screen.
 *
 * It sits above the tab bar rather than over the screen, and only on Home:
 * this is a suggestion, not something to interrupt a workout with. One tap
 * dismisses it for a month.
 *
 * The bottom offset is the tab bar's own height — 12px of top padding, a 44px
 * pill inside 6px of padding, 24px below — so the banner lands a clear gap
 * above it instead of on it.
 */
const NAV_HEIGHT_PX = 92;

/**
 * Long enough for the screen behind it to have arrived and been read. A banner
 * that is already there when Home fades in reads as part of the furniture and
 * gets dismissed without being taken in.
 */
const APPEAR_DELAY_MS = 3000;

export function InstallPrompt() {
  // The install state lives outside React — it arrives on a browser event that
  // fires before this component exists — so it's read as an external store
  // rather than copied into state on mount. Dismissing notifies the same
  // store, which is why there's no separate "dismissed" flag here.
  const advice = useSyncExternalStore(subscribeInstall, getInstallAdvice);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setSettled(true), APPEAR_DELAY_MS);
    return () => window.clearTimeout(t);
  }, []);

  if (!settled || !advice) return null;

  return (
    <div
      className="sheet-in fixed inset-x-0 z-40 px-4"
      style={{ bottom: NAV_HEIGHT_PX }}
      role="region"
      aria-label="Add Reps to your home screen"
    >
      <InstallBanner
        advice={advice}
        onInstall={() => {
          haptics.tap();
          // Fire and forget: promptToInstall records the answer itself, and
          // the store notifies when it has one.
          void promptToInstall();
        }}
        onDismiss={() => {
          haptics.tick();
          markDismissed();
        }}
      />
    </div>
  );
}

interface BannerProps {
  advice: Exclude<InstallAdvice, null>;
  onInstall: () => void;
  onDismiss: () => void;
}

/**
 * The banner itself, knowing nothing about how the advice was arrived at.
 * Separate from the component above so the three things it can say can be put
 * on a screen side by side and looked at.
 */
export function InstallBanner({ advice, onInstall, onDismiss }: BannerProps) {
  return (
    <div className="mx-auto max-w-md rounded-card bg-paper-card p-4 shadow-lift">
      <div className="flex items-start gap-3">
        <img src="/icon-192.png" alt="" className="h-11 w-11 shrink-0 rounded-panel" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold tracking-tight text-ink">Add Reps to your home screen</p>
          <p className="mt-0.5 text-caption leading-snug text-muted">
            Opens full screen and keeps working when the gym has no signal.
          </p>
        </div>
        <button
          onClick={onDismiss}
          aria-label="Not now"
          className="pressable -mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted active:bg-surface-strong"
        >
          <CloseIcon />
        </button>
      </div>

      {advice === 'prompt' && (
        <button
          onClick={onInstall}
          className="pressable mt-3.5 w-full rounded-pill bg-ink py-3 text-sm font-semibold text-white active:opacity-80"
        >
          Install
        </button>
      )}

      {advice === 'ios-safari' && (
        // Safari can't be asked to install, only pointed at. The glyph is
        // the one on the button they're being sent to, so the sentence can
        // be matched to the toolbar without translating a word into a shape.
        <p className="mt-3.5 flex items-center gap-2 rounded-panel bg-surface px-3 py-2.5 text-xs text-ink">
          <span className="shrink-0 text-muted">
            <ShareIcon />
          </span>
          <span className="leading-snug">
            Tap <span className="font-semibold">Share</span>, then{' '}
            <span className="font-semibold">Add to Home Screen</span>.
          </span>
        </p>
      )}

      {advice === 'ios-browser' && (
        <p className="mt-3.5 rounded-panel bg-surface px-3 py-2.5 text-xs leading-snug text-ink">
          Open this page in <span className="font-semibold">Safari</span> to add it — on an iPhone
          it's the only browser that can.
        </p>
      )}
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
      <path
        d="M5 5l10 10M15 5L5 15"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** iOS's Share glyph: a box with an arrow leaving the top of it. */
function ShareIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <path d="M11 3.5v9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path
        d="M7.75 6.75 11 3.5l3.25 3.25"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.5 9.5h-1a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1h-1"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
