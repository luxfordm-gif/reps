// Reads every plan in the corpus on a browser a couple of years old.
// Usage: npm test  —  or: node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/test-old-safari.mjs
//
// An iPhone that still goes to the gym is often two or three iOS releases
// behind, and pdf.js is written against the newest one. We ship its legacy
// build for that reason, but the legacy build only transpiles the *language*:
// anything missing from the browser's own objects it can only polyfill by hand,
// and the list it polyfills by hand is pdf.js's, not ours.
//
// One it misses cost a real upload. getTextContent reads a page with
// `for await (const value of readableStream)`, and Safari only made a
// ReadableStream async-iterable in 17.4 — so on a phone below that, every plan
// failed on its first page with "undefined is not a function", whatever the PDF
// contained. src/lib/streamAsyncIterator.ts supplies the iterator.
//
// So this strips what a 2022-era Safari hasn't got, and reads the whole corpus
// with what's left. It checks the stripping still bites before it checks the
// fix holds — a guard that's stopped guarding is worse than no guard.

import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PDF_DIR = join(HERE, 'fixtures', 'plans');
const APP = 'src/lib/extractPdfText.ts';

/** The standard fonts the app serves — a plan's columns are measured with them. */
const STANDARD_FONT_DATA_URL = fileURLToPath(
  new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)
);

/**
 * Take away everything an iPhone on iOS 16 hasn't got.
 *
 * Node is newer than any phone, so left alone it would read these PDFs with
 * APIs the phone will never have and report a pass the gym can't reproduce.
 * Each line below is an API pdf.js reaches for and that Safari shipped after
 * the floor in vite.config.ts, with the release that brought it.
 */
function ageTheBrowser() {
  const removed = [];
  const drop = (label, obj, prop) => {
    if (obj && prop in obj) {
      delete obj[prop];
      removed.push(label);
    }
  };
  drop('ReadableStream async iteration (17.4)', ReadableStream.prototype, Symbol.asyncIterator);
  drop('ReadableStream.prototype.values (17.4)', ReadableStream.prototype, 'values');
  drop('Promise.withResolvers (17.4)', Promise, 'withResolvers');
  drop('Promise.try (18.2)', Promise, 'try');
  drop('AbortSignal.any (17.4)', AbortSignal, 'any');
  drop('URL.parse (18.0)', URL, 'parse');
  drop('Object.groupBy (17.4)', Object, 'groupBy');
  drop('Map.groupBy (17.4)', Map, 'groupBy');
  drop('Array.fromAsync (18.4)', Array, 'fromAsync');
  drop('Response.prototype.bytes (18.2)', Response.prototype, 'bytes');
  drop('Blob.prototype.bytes (18.2)', Blob.prototype, 'bytes');
  drop('Iterator helpers (18.4)', globalThis, 'Iterator');
  for (const p of ['toBase64', 'fromBase64', 'setFromBase64', 'toHex', 'fromHex', 'setFromHex']) {
    drop(`Uint8Array.${p} (18.2)`, Uint8Array, p);
    drop(`Uint8Array.prototype.${p} (18.2)`, Uint8Array.prototype, p);
  }
  for (const p of ['union', 'intersection', 'difference', 'symmetricDifference', 'isSubsetOf', 'isSupersetOf', 'isDisjointFrom']) {
    drop(`Set.prototype.${p} (17.0)`, Set.prototype, p);
  }
  for (const p of ['transfer', 'transferToFixedLength', 'resize']) {
    drop(`ArrayBuffer.prototype.${p} (18.2)`, ArrayBuffer.prototype, p);
  }
  for (const p of ['isWellFormed', 'toWellFormed']) {
    drop(`String.prototype.${p} (16.4)`, String.prototype, p);
  }
  return removed;
}

// Aged before pdf.js is imported, because its own polyfills are installed on
// the way in and only where the feature is genuinely absent — which is how they
// run on the phone too.
const removed = ageTheBrowser();

const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
const { reconstructRows } = await import('../src/lib/reconstructPdfRows.ts');
const { installStreamAsyncIterator } = await import('../src/lib/streamAsyncIterator.ts');

/** Read a plan the way extractPdfText does. */
async function readPlan(name) {
  const data = new Uint8Array(await readFile(join(PDF_DIR, name)));
  const pdf = await pdfjsLib.getDocument({
    data,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
    useSystemFonts: false,
  }).promise;
  const lines = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const positioned = [];
    for (const item of content.items) {
      if (!item.str || !item.str.trim() || !item.transform) continue;
      positioned.push({ x: item.transform[4], y: item.transform[5], str: item.str });
    }
    lines.push(...reconstructRows(positioned));
  }
  return lines;
}

const checks = [];
function check(label, pass, detail) {
  checks.push({ label, pass, detail });
}

const plans = (await readdir(PDF_DIR)).filter((f) => f.endsWith('.pdf')).sort();
check('the corpus has plans to read', plans.length > 0, `found ${plans.length} PDFs`);
check('the old-browser APIs were actually removed', removed.length > 0, 'nothing was removed');

// First: without the fix, this environment must still fail — and fail the way
// the phone did. If pdf.js ever stops async-iterating, or Node stops letting us
// take the iterator away, the rest of this file proves nothing and should say so
// rather than pass quietly.
let reproduced = null;
try {
  await readPlan(plans[0]);
} catch (err) {
  reproduced = err;
}
check(
  'an un-fixed old browser still fails to read a plan',
  reproduced !== null,
  'reading succeeded without the fix — this test no longer reproduces the bug it guards'
);
check(
  'and fails the way the phone did, with a TypeError',
  reproduced instanceof TypeError,
  `got ${reproduced?.constructor?.name ?? 'no error'}: ${reproduced?.message ?? ''}`
);

// Then: with it, the whole corpus reads.
installStreamAsyncIterator();
for (const name of plans) {
  let lines = null;
  let failure = null;
  try {
    lines = await readPlan(name);
  } catch (err) {
    failure = err;
  }
  check(
    `${name} reads on an old browser`,
    failure === null && lines.length > 0,
    failure ? `${failure.name}: ${failure.message}` : 'read, but produced no lines'
  );
}

// And the app has to install it before it loads pdf.js, or the fix is only ever
// in the tests. The runtime check above can't cover this: extractPdfText is
// Vite-only (it imports the worker as a URL), so Node can't import it.
const appSource = await readFile(new URL(`../${APP}`, import.meta.url), 'utf8');
const installsAt = appSource.indexOf('installStreamAsyncIterator()');
// The load-time import, not the `typeof import(...)` the module's type alias
// uses — that one is erased before any of this runs.
const importsAt = appSource.search(/(?<!typeof\s)import\('pdfjs-dist\/legacy\/build\/pdf\.mjs'\)/);
check(
  `${APP} installs the stream iterator`,
  installsAt !== -1,
  'installStreamAsyncIterator is never called'
);
check(
  `${APP} installs it before it loads pdf.js`,
  installsAt !== -1 && importsAt !== -1 && installsAt < importsAt,
  'the reader is imported before the iterator is installed'
);

console.log('=== old Safari ===');
console.log(`Removed ${removed.length} APIs newer than the browser floor:`);
for (const r of removed) console.log(`     - ${r}`);
console.log();
let ok = true;
for (const c of checks) {
  if (!c.pass) ok = false;
  console.log(`${c.pass ? 'OK  ' : 'FAIL'} ${c.label}`);
  if (!c.pass) console.log(`     ${c.detail}`);
}
console.log(ok ? '\nAll old-browser checks passed.' : '\nOld-browser checks FAILED.');
process.exit(ok ? 0 : 1);
