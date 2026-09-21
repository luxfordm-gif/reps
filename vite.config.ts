import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/** Public files the service worker precaches by name (they aren't in the bundle). */
const PRECACHED_PUBLIC_ASSETS = [
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
  'favicon-32.png',
]

/** pdf.js's own files: the worker, and the reader chunk it's code-split into. */
function isPdfjsAsset(fileName: string): boolean {
  return /(^|\/)pdf[.-]/.test(fileName)
}

/**
 * Emits `sw.js` at build time from sw/service-worker.js, with the exact list of
 * files this build produced baked in. Hand-maintaining that list would rot on
 * the first bundle-name change; generating it means every deploy precaches
 * precisely its own assets and drops the previous build's cache on activate.
 */
function precacheServiceWorker(): Plugin {
  return {
    name: 'reps-precache-sw',
    apply: 'build',
    buildStart() {
      // The precache list names these explicitly, so a rename would silently
      // ship a service worker that fails to install.
      const dir = fileURLToPath(new URL('./public/', import.meta.url))
      const present = new Set(
        readdirSync(dir).filter((f) => statSync(dir + f).isFile())
      )
      for (const required of PRECACHED_PUBLIC_ASSETS) {
        if (!present.has(required)) {
          this.error(`Missing public/${required} — the service worker precaches it`)
        }
      }
    },
    generateBundle(_options, bundle) {
      // The exclusion below matches on file name, so a rename upstream (or a
      // change in how the reader is chunked) would quietly put 1.7 MB of PDF
      // machinery into the precache of an app that works offline.
      if (Object.keys(bundle).filter(isPdfjsAsset).length < 2) {
        this.error(
          'Expected pdf.js to emit a worker and a reader chunk named pdf* — check the precache exclusion in vite.config.ts'
        )
      }
      const bundled = Object.keys(bundle)
        .filter((f) => !f.endsWith('.map'))
        // pdf.js — its worker and the reader chunk the upload screen imports on
        // demand — is 1.7 MB and only used when uploading a plan, which is
        // never something you do offline. Both still get cached at runtime the
        // first time they're fetched.
        .filter((f) => !isPdfjsAsset(f))
        .map((f) => `/${f}`)
      const precache = [
        '/index.html',
        ...bundled,
        ...PRECACHED_PUBLIC_ASSETS.map((f) => `/${f}`),
      ]
      const buildId = createHash('sha256')
        .update(precache.join('|'))
        .digest('hex')
        .slice(0, 12)
      const template = readFileSync(
        fileURLToPath(new URL('./sw/service-worker.js', import.meta.url)),
        'utf8'
      )
      const source = template
        .replaceAll('__PRECACHE__', JSON.stringify(precache, null, 2))
        .replaceAll('__BUILD_ID__', buildId)
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), precacheServiceWorker()],
  build: {
    // Stated rather than inherited from whatever the bundler's default is this
    // month. Phones live a long time — an iPhone stuck on iOS 16 still goes to
    // the gym — and a default that quietly moves forward ships syntax those
    // phones can't parse, which is a blank screen with nothing to report. The
    // same floor is why the plan parser loads pdf.js's legacy build; see
    // src/lib/extractPdfText.ts.
    target: ['chrome107', 'edge107', 'firefox104', 'safari16'],
  },
})
