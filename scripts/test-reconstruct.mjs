// Test harness for the PDF table-row reconstruction.
// Usage: npm test  —  or: node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/test-reconstruct.mjs
//
// Uses a synthetic set of positioned text items (mimicking pdf.js output, whose
// origin is bottom-left so a larger Y is higher up the page) to check that
// wrapped exercise names and wrapped coach notes are stitched back onto their
// row instead of splitting into separate lines.
import { reconstructRows } from '../src/lib/reconstructPdfRows.ts';

// Columns: body≈120, name≈180, sets≈335, rep≈382, tempo≈418/437/454/471, notes≈495.
const items = [
  // Row 1 — everything on one line (name and note both fit).
  { x: 120, y: 900, str: 'CHEST' },
  { x: 180, y: 900, str: 'BARBELL BENCH PRESS' },
  { x: 335, y: 900, str: '3' }, { x: 382, y: 900, str: '8-10' },
  { x: 418, y: 900, str: '1' }, { x: 437, y: 900, str: '0' },
  { x: 454, y: 900, str: '1' }, { x: 471, y: 900, str: '0' },
  { x: 495, y: 900, str: 'ALTERNATE WEEKS WITH MAGNUM BENCH PRESS' },

  // Row 2 — exercise name wraps above and below the data line.
  { x: 180, y: 884, str: 'NAUTILUS DECLINE PIN LOADED' },
  { x: 120, y: 880, str: 'CHEST' },
  { x: 335, y: 880, str: '3' }, { x: 382, y: 880, str: '8-10' },
  { x: 418, y: 880, str: '1' }, { x: 437, y: 880, str: '0' },
  { x: 454, y: 880, str: '2' }, { x: 471, y: 880, str: '0' },
  { x: 511, y: 880, str: 'SLOWER NEGATIVE' },
  { x: 180, y: 876, str: 'CHEST PRESS' },

  // Row 3 — coach note wraps above the data line (note is centre-aligned).
  { x: 487, y: 864, str: 'SET 3: 10 REPS SLOW, 30s REST,' },
  { x: 120, y: 860, str: 'CHEST' },
  { x: 180, y: 860, str: 'INCLINE PLATE LOADED FLY' },
  { x: 335, y: 860, str: '2' }, { x: 382, y: 860, str: '10-12' },
  { x: 418, y: 860, str: '2' }, { x: 437, y: 860, str: '0' },
  { x: 454, y: 860, str: '1' }, { x: 471, y: 860, str: '1' },
  { x: 496, y: 856, str: '5 REPS SLOW, DONE' },

  // A dangling page number that should be dropped.
  { x: 300, y: 820, str: '1' },
];

const expected = [
  'CHEST BARBELL BENCH PRESS 3 8-10 1 0 1 0 ALTERNATE WEEKS WITH MAGNUM BENCH PRESS',
  'CHEST NAUTILUS DECLINE PIN LOADED CHEST PRESS 3 8-10 1 0 2 0 SLOWER NEGATIVE',
  'CHEST INCLINE PLATE LOADED FLY 2 10-12 2 0 1 1 SET 3: 10 REPS SLOW, 30s REST, 5 REPS SLOW, DONE',
];

const got = reconstructRows(items);
let ok = true;
console.log('=== Reconstructed rows ===');
got.forEach((line, i) => {
  const pass = line === expected[i];
  if (!pass) ok = false;
  console.log(`${pass ? 'OK  ' : 'FAIL'} ${line}`);
  if (!pass) console.log(`     expected: ${expected[i]}`);
});
if (got.length !== expected.length) {
  ok = false;
  console.log(`FAIL row count: got ${got.length}, expected ${expected.length}`);
}
console.log(ok ? '\nAll reconstruction checks passed.' : '\nReconstruction checks FAILED.');
process.exit(ok ? 0 : 1);
