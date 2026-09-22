// The detail block under an error message.
// Usage: npm test  —  or: node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/test-error-report.mjs
//
// This block exists to be copied out of the app and pasted into a message, so
// what's tested is what a person would end up reading: the right facts, named
// the same way every time, short enough to send. The device line gets the most
// attention here because it's the one that turns "it doesn't work on my phone"
// into a version number — and it's derived from a user-agent string, which is
// the least trustworthy input in a browser.

import { readFile } from 'node:fs/promises';
import {
  buildErrorReport,
  describeCause,
  describeDevice,
  formatBytes,
} from '../src/lib/errorReport.ts';

const checks = [];
function check(label, pass, detail) {
  checks.push({ label, pass, detail });
}
function eq(label, got, want) {
  check(label, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

// --- the phone, from its user-agent string -------------------------------

const IPHONE_16 =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';

eq('an iPhone on 16.6 names the release', describeDevice(IPHONE_16), 'iPhone · iOS 16.6 · Safari 16.6');
eq(
  'an iPad is on iPadOS, not iOS',
  describeDevice(
    'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
  ),
  'iPad · iPadOS 17.4 · Safari 17.4'
);
// Every browser on iOS ends its string with "Safari", so the ones that aren't
// Safari have to be recognised first or they all read as Safari.
eq(
  'Chrome on an iPhone is Chrome',
  describeDevice(
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1'
  ),
  'iPhone · iOS 17.2 · Chrome 120'
);
eq(
  'Firefox on an iPhone is Firefox',
  describeDevice(
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/121.0 Mobile/15E148 Safari/605.1.15'
  ),
  'iPhone · iOS 17.0 · Firefox 121'
);
eq(
  'an Android phone reads as one line',
  describeDevice(
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
  ),
  'Android 13 · Chrome 120'
);
eq(
  'a Mac is a Mac',
  describeDevice(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'
  ),
  'macOS 10.15 · Safari 17.4'
);
// Nothing recognised is not nothing reported: the raw string is on its own
// line in the report below, so an unparsed device loses no information.
eq('an unrecognisable agent says so', describeDevice('something else entirely'), 'unknown device');
eq('an empty agent says so too', describeDevice(''), 'unknown device');

// --- sizes and causes ----------------------------------------------------

eq('bytes stay bytes', formatBytes(512), '512 bytes');
eq('kilobytes round', formatBytes(86_000), '84 KB');
eq('megabytes keep a decimal', formatBytes(12 * 1024 * 1024), '12.0 MB');

eq(
  'a named error keeps its name',
  describeCause(new TypeError("undefined is not a function (near '...e of t...')")),
  "TypeError: undefined is not a function (near '...e of t...')"
);
eq('a plain Error is just its message', describeCause(new Error('nope')), 'nope');
eq('nothing thrown reads as none', describeCause(undefined), 'none');
eq('an empty message reads as none', describeCause(new Error('')), 'none');
eq('a thrown string survives', describeCause('went wrong'), 'went wrong');
// A newline in the middle would break the one-fact-per-line shape the report
// relies on, and a very long message is one nobody pastes.
eq('newlines are flattened', describeCause(new Error('one\ntwo')), 'one two');
const long = describeCause(new Error('x'.repeat(500)));
check('a long message is cut short', long.length <= 301 && long.endsWith('…'), `length ${long.length}`);

// --- the report ----------------------------------------------------------

const ENV = {
  version: '2026-09-22',
  build: '2026-09-22T07:40:11.000Z',
  userAgent: IPHONE_16,
  viewport: '390x844@3',
  installed: true,
  online: true,
  at: '2026-09-22T08:12:04.000Z',
};

const report = buildErrorReport(
  {
    code: 'browser-too-old',
    doing: 'reading page 1 of 2',
    cause: new TypeError("undefined is not a function (near '...e of t...')"),
    file: { name: 'training_plan_exercises.pdf', size: 86_000 },
  },
  ENV
);

// The failure Tom hit, written out in full. A golden copy, because the value of
// this block is that it reads the same way every time it arrives.
eq(
  'the whole report reads as intended',
  report,
  [
    'Reps 2026-09-22 — reading page 1 of 2 failed',
    'build: 2026-09-22T07:40:11.000Z',
    'code: browser-too-old',
    "error: TypeError: undefined is not a function (near '...e of t...')",
    'file: training_plan_exercises.pdf (84 KB)',
    'device: iPhone · iOS 16.6 · Safari 16.6',
    'opened: home screen, online',
    'screen: 390x844@3',
    'when: 2026-09-22T08:12:04.000Z',
    `ua: ${IPHONE_16}`,
  ].join('\n')
);

const noFile = buildErrorReport({ code: 'plan-save', doing: 'saving the plan', cause: new Error('network') }, ENV);
check('a failure with no file in hand leaves the line out', !noFile.includes('file:'), noFile);
check('and still says what it was doing', noFile.includes('saving the plan failed'), noFile);

const tabbed = buildErrorReport({ code: 'x', doing: 'y' }, { ...ENV, installed: false, online: false });
check('a browser tab is told apart from the home screen', tabbed.includes('opened: browser tab, offline'), tabbed);

// The changelog version is a date, so two deploys on one day share it — and the
// day a fix ships is the day that matters. The build stamp is what says whether
// the phone had the fix or was still serving yesterday's from its cache.
check('the build is named separately from the version', report.includes('build: 2026-09-22T07:40:11.000Z'), report);
const viteConfig = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');
check(
  'and the build stamps it in',
  /__BUILD_STAMP__/.test(viteConfig),
  'vite.config.ts never defines __BUILD_STAMP__'
);

// The long user-agent string goes last, so a message app that folds a long
// paste still shows the lines someone can act on.
const lines = report.split('\n');
check('the user agent is the last line', lines.at(-1).startsWith('ua: '), lines.at(-1));
check(
  'every other line is one short fact',
  lines.slice(0, -1).every((l) => l.length <= 90),
  lines.slice(0, -1).find((l) => l.length > 90) ?? ''
);

// --- the codes -----------------------------------------------------------

// Codes are what makes two reports six months apart comparable, so they have to
// be stable slugs and each one has to mean a different thing.
const readerSource = await readFile(new URL('../src/lib/extractPdfText.ts', import.meta.url), 'utf8');
const codes = [...readerSource.matchAll(/code: '([^']+)'/g)].map((m) => m[1]);
check('the reader names its failures', codes.length >= 5, `found ${codes.length}: ${codes.join(', ')}`);
check(
  'each code is a distinct slug',
  new Set(codes).size === codes.length && codes.every((c) => /^[a-z][a-z0-9-]*$/.test(c)),
  codes.join(', ')
);

console.log('=== error report ===');
let ok = true;
for (const c of checks) {
  if (!c.pass) ok = false;
  console.log(`${c.pass ? 'OK  ' : 'FAIL'} ${c.label}`);
  if (!c.pass) console.log(`     ${c.detail}`);
}
console.log(ok ? '\nAll error-report checks passed.' : '\nError-report checks FAILED.');
process.exit(ok ? 0 : 1);
