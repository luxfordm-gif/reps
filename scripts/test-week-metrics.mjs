// Tests the "18 sets · 210 reps · 4,250 kg" line under each workout in the
// weekly card — in particular what it does when there is no honest weight.
// Usage: npm test  —  or: node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/test-week-metrics.mjs
import {
  formatSessionMetrics,
  formatSessionVolume,
  formatVolumeChange,
} from '../src/lib/dashboard.ts';

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
  'sets and reps; the weight is the figure on the right, not part of this line',
  formatSessionMetrics({ setCount: 18, repCount: 210, volumeKg: 4250 }),
  '18 sets · 210 reps'
);

console.log('\n=== one of a thing ===');
eq(
  'a single set and rep are singular',
  formatSessionMetrics({ setCount: 1, repCount: 1, volumeKg: 60 }),
  '1 set · 1 rep'
);

console.log('\n=== when there is no weight to report ===');
// Bodyweight work: real sets, real reps, nothing lifted. The whole reason
// sets lead rather than weight.
eq(
  'a bodyweight session still says what was done',
  formatSessionMetrics({ setCount: 12, repCount: 180, volumeKg: 0 }),
  '12 sets · 180 reps'
);

console.log('\n=== the figure on the right ===');
eq('a normal total', formatSessionVolume(4250), '4,250');
eq('thousands are separated', formatSessionVolume(12400), '12,400');
eq('rounded, not shown to the gram', formatSessionVolume(1012.6), '1,013');
eq('a bodyweight session has no figure to show', formatSessionVolume(0), null);
eq('a pin-logged session has none either', formatSessionVolume(null), null);

console.log('\n=== against the last time ===');
eq('up', formatVolumeChange(6), '↑ 6% vs last time');
eq('down is stated, not scolded', formatVolumeChange(-12), '↓ 12% vs last time');
eq('level gets a word rather than a directionless 0%', formatVolumeChange(0), 'same as last time');
eq('a first outing has nothing to compare with', formatVolumeChange(null), null);
eq('a big jump is not capped', formatVolumeChange(140), '↑ 140% vs last time');
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
