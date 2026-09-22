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
 * Where pdf.js's standard fonts are served from, as both the app and the build
 * have to agree on it. Under /assets/ so the service worker's runtime caching
 * picks them up on first use, like every other lazily-fetched bundle file.
 */
export const STANDARD_FONTS_PATH = 'assets/standard_fonts/'

/**
 * pdf.js's own files: the worker, the reader chunk it's code-split into, and
 * the standard fonts.
 */
function isPdfjsAsset(fileName: string): boolean {
  return /(^|\/)pdf[.-]/.test(fileName) || fileName.startsWith(STANDARD_FONTS_PATH)
}

/**
 * Serves pdf.js's standard font files.
 *
 * A PDF can leave the common fonts — Helvetica, Times, Courier — out of the
 * file, on the understanding that whatever opens it already has them. Nothing
 * in a browser does, so pdf.js carries its own metrically-matching copies and
 * asks for them at `standardFontDataUrl`. We never served them, so every plan
 * exported by the usual tools (they all embed nothing and name Helvetica) had
 * its fonts fail to load and fell back to a built-in table of average widths.
 *
 * That matters here more than it would elsewhere: a plan is a table, we work
 * out which column a word is in from where it sits on the page, and where it
 * sits is measured with the font's own character widths. Reading those from
 * the real font is the difference between a column boundary we've measured and
 * one we've approximated.
 *
 * They're emitted rather than committed to public/ so they can't drift from
 * the pdfjs-dist version in package.json, and served in dev from the same URL
 * so a plan reads identically in both.
 */
function pdfjsStandardFonts(): Plugin {
  const dir = fileURLToPath(
    new URL('./node_modules/pdfjs-dist/standard_fonts/', import.meta.url)
  )
  const files = () => readdirSync(dir).filter((f) => statSync(dir + f).isFile())
  return {
    name: 'reps-pdfjs-standard-fonts',
    configureServer(server) {
      server.middlewares.use(`/${STANDARD_FONTS_PATH}`, (req, res) => {
        // An allow-list of the names pdf.js ships, because this maps a URL onto
        // a real path and the request comes from outside. Anything else is 404
        // here rather than passed along: in production this path serves these
        // files and nothing else, and dev shouldn't answer differently.
        let name = ''
        try {
          name = decodeURIComponent((req.url ?? '').replace(/^\//, '').split('?')[0])
        } catch {
          // Malformed escape — not a file name we ship.
        }
        if (!files().includes(name)) {
          res.statusCode = 404
          res.end()
          return
        }
        res.setHeader('Content-Type', 'application/octet-stream')
        res.end(readFileSync(dir + name))
      })
    },
    generateBundle() {
      for (const name of files()) {
        this.emitFile({
          type: 'asset',
          fileName: `${STANDARD_FONTS_PATH}${name}`,
          source: readFileSync(dir + name),
        })
      }
    },
  }
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
      const pdfjs = Object.keys(bundle).filter(isPdfjsAsset)
      if (pdfjs.filter((f) => !f.startsWith(STANDARD_FONTS_PATH)).length < 2) {
        this.error(
          'Expected pdf.js to emit a worker and a reader chunk named pdf* — check the precache exclusion in vite.config.ts'
        )
      }
      if (!pdfjs.some((f) => f.startsWith(STANDARD_FONTS_PATH))) {
        this.error(
          `Expected pdf.js standard fonts at ${STANDARD_FONTS_PATH} — a plan's columns are measured with them`
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

/**
 * Which bundle this is, for the detail block under an error message.
 *
 * The changelog's version is a date, and a date can't tell two deploys on the
 * same day apart — which is exactly the day a fix goes out and someone reports
 * it still broken. This is stamped per build, so a pasted report says whether
 * the phone was running the fix or still holding yesterday's from its cache.
 */
const BUILD_STAMP = new Date().toISOString()

// https://vite.dev/config/
export default defineConfig({
  define: { __BUILD_STAMP__: JSON.stringify(BUILD_STAMP) },
  plugins: [react(), pdfjsStandardFonts(), precacheServiceWorker()],
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
