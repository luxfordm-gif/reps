// Tests which records lead the Performance tab: core movements first, in
// order, then whatever is heaviest.
// Usage: npm test  —  or: node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/test-headline-records.mjs
import { coreLiftRank, headlineRecords } from '../src/lib/records.ts';

let failures = 0;
function eq(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) console.log(`  ✓ ${label}`);
  else { failures += 1; console.log(`  ✗ ${label}\n      got  ${g}\n      want ${w}`); }
}

// Machines carry the manufacturer's name, so the movement has to be found
// inside the label rather than matched against the whole of it.
const rec = (displayName, weightKg, kind = 'weighted') => ({
  normalizedName: displayName.toLowerCase(),
  displayName,
  bodyPart: null,
  unit: 'kg',
  kind,
  heaviest: { weightKg },
  best1RM: null, best1RMkg: 0, mostReps: null, longestHold: null,
  totalSets: 1, lastLoggedAt: '2026-09-01T00:00:00Z',
});
const names = (rs) => rs.map((r) => r.displayName);

console.log('\n=== recognising a core lift inside a machine name ===');
eq('a branded leg press', coreLiftRank('nebula leg press'), 3);
eq('a branded row', coreLiftRank('arsenal low row'), 6);
eq('barbell back squat', coreLiftRank('barbell back squat'), 0);
eq('incline bench press', coreLiftRank('incline bench press'), 1);
eq('romanian deadlift', coreLiftRank('romanian deadlift'), 2);
eq('deadlift spelled as two words', coreLiftRank('romanian dead lift'), 2);
eq('a calf raise is not a core lift', coreLiftRank('standing calf raise'), Infinity);
eq('nor is a leg extension', coreLiftRank('leg extension'), Infinity);
// "calf press" and "leg press" both end in press; only one is a core lift.
eq('a calf press is not a leg press', coreLiftRank('seated calf press'), Infinity);

console.log('\n=== what leads the board ===');
eq(
  'core lifts outrank a heavier accessory',
  names(headlineRecords([
    rec('Standing calf raise', 451),
    rec('Nebula leg press', 250),
    rec('Barbell bench press', 100),
    rec('Barbell back squat', 140),
  ])),
  ['Barbell back squat', 'Barbell bench press', 'Nebula leg press', 'Standing calf raise']
);
eq(
  'and they come in the canonical order, not by weight',
  names(headlineRecords([
    rec('Arsenal low row', 240),
    rec('Deadlift', 180),
    rec('Bench press', 100),
    rec('Squat', 140),
  ])),
  ['Squat', 'Bench press', 'Deadlift', 'Arsenal low row']
);

console.log('\n=== breadth over repetition ===');
eq(
  'only the heaviest of several squat variants leads; the rest fall back',
  names(headlineRecords([
    rec('Back squat', 140),
    rec('Front squat', 110),
    rec('Hack squat', 200),
    rec('Bench press', 100),
  ])),
  ['Hack squat', 'Bench press', 'Back squat', 'Front squat']
);

console.log('\n=== the edges ===');
eq(
  'six at most',
  headlineRecords([
    rec('Squat', 1), rec('Bench press', 1), rec('Deadlift', 1), rec('Leg press', 1),
    rec('Overhead press', 1), rec('Lat pulldown', 1), rec('Row', 1), rec('Calf raise', 1),
  ]).length,
  6
);
eq('the limit is adjustable', headlineRecords([rec('Squat', 1), rec('Bench press', 1)], 1).length, 1);
eq(
  'bodyweight and hold records are left out — there is no weight to show',
  names(headlineRecords([rec('Pull-up', 0, 'reps'), rec('Plank', 0, 'hold'), rec('Squat', 100)])),
  ['Squat']
);
eq('nothing logged yet', headlineRecords([]), []);

console.log(failures === 0 ? '\nAll headline-record tests passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
