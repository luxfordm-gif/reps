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

console.log('=== pdf.js build ===');
let ok = true;
for (const c of checks) {
  if (!c.pass) ok = false;
  console.log(`${c.pass ? 'OK  ' : 'FAIL'} ${c.label}`);
  if (!c.pass) console.log(`     ${c.detail}`);
}
console.log(ok ? '\nAll pdf.js build checks passed.' : '\npdf.js build checks FAILED.');
process.exit(ok ? 0 : 1);
