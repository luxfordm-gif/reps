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
      const bundled = Object.keys(bundle)
        .filter((f) => !f.endsWith('.map'))
        // The PDF worker is 1.2 MB and only used when uploading a plan, which
        // is never something you do offline. It still gets cached at runtime
        // the first time it's fetched.
        .filter((f) => !f.includes('pdf.worker'))
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
})
