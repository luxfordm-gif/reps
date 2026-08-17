/*
 * Reps service worker.
 *
 * Written by hand and stamped at build time by the `precacheServiceWorker`
 * plugin in vite.config.ts, which fills in the cache name and the file list for
 * the bundle being deployed.
 *
 * What it buys us: the app shell (HTML, JS, CSS, icons) is stored on the phone
 * the first time it's opened with signal, so opening it in a gym basement is a
 * cache read rather than a network round trip. Supabase traffic is deliberately
 * never cached here — data caching and offline writes are handled in the app,
 * where they can be merged with what the user has done since.
 */

const CACHE = 'reps-precache-__BUILD_ID__';
const PRECACHE = __PRECACHE__;

// ignoreVary matters more than it looks: hosts commonly answer with
// `Vary: Origin`, and a module script requested by the page carries an Origin
// header that the service worker's own precache fetch didn't. Without this,
// every JS and CSS lookup misses the cache and the app is blank offline.
const MATCH_OPTIONS = { ignoreVary: true };

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // allSettled: one missing file must not sink the whole install.
      await Promise.allSettled(
        PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' })))
      );
      // Take over as soon as this version is stored, so the next launch runs it.
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('reps-precache-') && k !== CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Anything off-origin (Supabase, fonts, images the user opens) goes straight
  // to the network — the app layer decides what to do when it fails.
  if (url.origin !== self.location.origin) return;

  // Every in-app route is served by the same shell, and it's served from cache
  // first: that's what makes a cold start with no signal work at all.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const shell = await caches.match('/index.html', MATCH_OPTIONS);
        if (shell) return shell;
        try {
          return await fetch(req);
        } catch {
          return new Response(
            '<!doctype html><meta charset="utf-8"><title>Reps</title>' +
              '<body style="font:16px -apple-system,sans-serif;padding:40px;text-align:center">' +
              "<p>Reps hasn't finished downloading yet. Open it once with signal and it'll work offline after that.</p>",
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        }
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(req, MATCH_OPTIONS);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        // Bundle files are content-hashed, so caching them as they're requested
        // is safe and covers anything loaded lazily after the install.
        if (res.ok && url.pathname.startsWith('/assets/')) {
          const cache = await caches.open(CACHE);
          cache.put(req, res.clone());
        }
        return res;
      } catch (err) {
        throw err;
      }
    })()
  );
});
