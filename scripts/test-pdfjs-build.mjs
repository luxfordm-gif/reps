// Guards which build of pdf.js the app ships.
// Usage: npm test  —  or: node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/test-pdfjs-build.mjs
//
// pdf.js publishes two builds from the same source. The default one is compiled
// for the newest browsers — getDocument itself calls Promise.withResolvers,
// which Safari only got in 17.4 — so importing it meant every plan upload on a
// slightly older phone failed inside pdf.js with "undefined is not a function",
// before any of our code ran. Nothing caught it, because the PDF corpus tests
// import the legacy build (the only one that runs under Node) while the app
// imported the modern one: the build we tested was never the build we shipped.
//
// So: both sides must name the same legacy entry point, and the browser side
// must not reach for the default build by any of its spellings.

import { readFile } from 'node:fs/promises';

const APP = 'src/lib/extractPdfText.ts';
const CORPUS = ['scripts/test-plan-corpus.mjs', 'scripts/stress-pdfs.mjs'];
const VITE_CONFIG = 'vite.config.ts';
const LEGACY_LIB = 'pdfjs-dist/legacy/build/pdf.mjs';
const LEGACY_WORKER = 'pdfjs-dist/legacy/build/pdf.worker.min.mjs';

/** Every module specifier the file imports, static or dynamic. */
function specifiers(source) {
  const found = [];
  const re = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
  for (const m of source.matchAll(re)) found.push(m[1]);
  return found;
}

const checks = [];
function check(label, pass, detail) {
  checks.push({ label, pass, detail });
}

const app = specifiers(await readFile(new URL(`../${APP}`, import.meta.url), 'utf8'));

const appPdfjs = app.filter((s) => s.startsWith('pdfjs-dist'));

check(
  `${APP} imports pdf.js at all`,
  appPdfjs.length > 0,
  `found: ${appPdfjs.join(', ') || 'none'}`
);
check(
  `${APP} loads the legacy reader`,
  appPdfjs.some((s) => s.split('?')[0] === LEGACY_LIB),
  `found: ${appPdfjs.join(', ')}`
);
check(
  `${APP} loads the legacy worker`,
  appPdfjs.some((s) => s.split('?')[0] === LEGACY_WORKER),
  `found: ${appPdfjs.join(', ')}`
);
check(
  `${APP} reaches for no other pdf.js build`,
  appPdfjs.every((s) => s.split('?')[0].startsWith('pdfjs-dist/legacy/')),
  `found: ${appPdfjs.join(', ')}`
);
for (const file of CORPUS) {
  const used = specifiers(await readFile(new URL(`../${file}`, import.meta.url), 'utf8')).filter(
    (s) => s.startsWith('pdfjs-dist')
  );
  check(
    `${file} tests the same reader the app ships`,
    used.some((s) => s.split('?')[0] === LEGACY_LIB),
    `found: ${used.join(', ') || 'none'}`
  );
}

// Standard fonts: a plan names Helvetica and doesn't embed it, so pdf.js needs
// its own copy to know how wide each character is — and character widths are
// what put a word in a column. The app serves them from the path vite.config.ts
// emits them to, and the corpus has to read with the same font data, or it
// isn't measuring what users measure.
const viteConfig = await readFile(new URL(`../${VITE_CONFIG}`, import.meta.url), 'utf8');
const fontsPath = viteConfig.match(/STANDARD_FONTS_PATH = '([^']+)'/)?.[1];
const appSource = await readFile(new URL(`../${APP}`, import.meta.url), 'utf8');

check(`${VITE_CONFIG} names a path for the standard fonts`, Boolean(fontsPath), 'no STANDARD_FONTS_PATH found');
check(
  `${APP} asks for the standard fonts`,
  /standardFontDataUrl/.test(appSource),
  'no standardFontDataUrl passed to getDocument'
);
check(
  `${APP} asks for them where the build puts them`,
  Boolean(fontsPath) && appSource.includes(fontsPath),
  `build emits to '${fontsPath}', which ${APP} never mentions`
);
// And they have to be the fonts actually measured with. Left to itself pdf.js
// measures a non-embedded font with whatever the device has installed, which
// differs between an iPhone, a Pixel and this machine — so the app pins it off
// the same way the corpus runners do.
check(
  `${APP} measures with the shipped fonts, not the phone's`,
  /useSystemFonts:\s*false/.test(appSource),
  'useSystemFonts is not pinned to false'
);
for (const file of CORPUS) {
  const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
  check(
    `${file} reads with the same font data`,
    /standardFontDataUrl/.test(source),
    'no standardFontDataUrl passed to getDocument'
  );
  check(
    `${file} measures with the same fonts`,
    /useSystemFonts:\s*false/.test(source),
    'useSystemFonts is not pinned to false'
  );
}

console.log('=== pdf.js build ===');
let ok = true;
for (const c of checks) {
  if (!c.pass) ok = false;
  console.log(`${c.pass ? 'OK  ' : 'FAIL'} ${c.label}`);
  if (!c.pass) console.log(`     ${c.detail}`);
}
console.log(ok ? '\nAll pdf.js build checks passed.' : '\npdf.js build checks FAILED.');
process.exit(ok ? 0 : 1);
