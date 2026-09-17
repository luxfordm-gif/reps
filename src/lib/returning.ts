// Whether this device has ever held a signed-in session.
//
// The sign-in screen used to say "Welcome back." to everyone, including someone
// opening the app for the first time. This is the smallest honest answer to
// that: a flag set the first time a session exists, on this device, and never
// cleared on sign-out — signing out doesn't make you a stranger.

const KEY = 'reps.hasSignedIn';

export function hasSignedInBefore(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    // Private mode or blocked storage: treat them as new rather than guess.
    return false;
  }
}

export function markSignedIn(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, '1');
  } catch {
    // Nothing to do — the greeting just stays neutral next time.
  }
}
