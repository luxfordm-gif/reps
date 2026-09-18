// Tests the "18 sets · 210 reps · 4,250 kg" line under each workout in the
// weekly card — in particular what it does when there is no honest weight.
// Usage: npm test  —  or: node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/test-week-metrics.mjs
import { formatSessionMetrics } from '../src/lib/dashboard.ts';

let failures = 0;
function eq(label, got, want) {
  if (got === want) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}\n      got  "${got}"\n      want "${want}"`);
  }
}

console.log('\n=== a normal session ===');
eq(
  'sets, reps and weight',
  formatSessionMetrics({ setCount: 18, repCount: 210, volumeKg: 4250 }),
  '18 sets · 210 reps · 4,250 kg'
);
eq(
  'thousands are separated',
  formatSessionMetrics({ setCount: 20, repCount: 240, volumeKg: 12400 }),
  '20 sets · 240 reps · 12,400 kg'
);
eq(
  'a fractional total is rounded, not shown to the gram',
  formatSessionMetrics({ setCount: 3, repCount: 30, volumeKg: 1012.6 }),
  '3 sets · 30 reps · 1,013 kg'
);

console.log('\n=== one of a thing ===');
eq(
  'a single set and rep are singular',
  formatSessionMetrics({ setCount: 1, repCount: 1, volumeKg: 60 }),
  '1 set · 1 rep · 60 kg'
);

console.log('\n=== when there is no weight to report ===');
// Bodyweight work: real sets, real reps, nothing lifted. The whole reason
// sets lead rather than weight.
eq(
  'a bodyweight session still says what was done',
  formatSessionMetrics({ setCount: 12, repCount: 180, volumeKg: 0 }),
  '12 sets · 180 reps'
);
// A pin-logged machine stores the pin position in the weight column, so the
// total would not be a number of kilograms. sessionsApi sends null instead.
eq(
  'a pin-logged session omits the weight rather than inventing one',
  formatSessionMetrics({ setCount: 15, repCount: 160, volumeKg: null }),
  '15 sets · 160 reps'
);
eq(
  'sets alone, when reps were never entered',
  formatSessionMetrics({ setCount: 4, repCount: 0, volumeKg: null }),
  '4 sets'
);
eq(
  'nothing logged at all says nothing, rather than "0 sets"',
  formatSessionMetrics({ setCount: 0, repCount: 0, volumeKg: null }),
  ''
);

console.log(failures === 0 ? '\nAll week-metrics tests passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
