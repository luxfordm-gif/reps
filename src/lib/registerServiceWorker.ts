// Registers the precaching service worker (production builds only — there's no
// sw.js in dev, and a stale one would serve yesterday's bundle over HMR).
//
// The worker skips waiting as soon as it has stored a new build, so a deploy is
// picked up on the next launch. We deliberately never force-reload a page the
// user is on: reloading mid-workout would throw away the rest timer and
// whatever they're typing into a set.

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export function registerServiceWorker(): void {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  if (!import.meta.env.PROD) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((registration) => {
        let lastCheck = Date.now();
        const checkForUpdate = () => {
          if (document.visibilityState !== 'visible') return;
          if (Date.now() - lastCheck < UPDATE_CHECK_INTERVAL_MS) return;
          lastCheck = Date.now();
          registration.update().catch(() => {});
        };
        document.addEventListener('visibilitychange', checkForUpdate);
      })
      .catch((err) => {
        // A failed registration only costs offline support, never the app.
        console.warn('[sw] registration failed', err);
      });
  });
}
