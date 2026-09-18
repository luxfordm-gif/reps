// Tests the week streak and the twelve-week training-load series.
// Usage: npm test  —  or: node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/test-streak-load.mjs
import { computeWeekStreak, computeWeeklyLoad } from '../src/lib/dashboard.ts';

let failures = 0;
function eq(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) console.log(`  ✓ ${label}`);
  else { failures += 1; console.log(`  ✗ ${label}\n      got  ${g}\n      want ${w}`); }
}

// A Friday, so "this week" is partly done — the interesting case.
const NOW = new Date('2026-09-18T12:00:00');
const daysAgo = (n) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - n);
  return { completed_at: d.toISOString() };
};
/** n sessions in the week that started `w` weeks before this one. */
const week = (w, n) => Array.from({ length: n }, (_, i) => daysAgo(w * 7 + i));

console.log('\n=== the week in progress is never held against you ===');
// Target 3. This week has 1 so far; the three weeks behind it all hit.
eq(
  'a target not yet met this week leaves the run standing',
  computeWeekStreak([...week(0, 1), ...week(1, 3), ...week(2, 3), ...week(3, 3)], 3, NOW),
  { current: 3, longest: 3, thisWeekCounts: false }
);
eq(
  'meeting it early extends the run straight away',
  computeWeekStreak([...week(0, 3), ...week(1, 3), ...week(2, 3)], 3, NOW),
  { current: 3, longest: 3, thisWeekCounts: true }
);

console.log('\n=== breaking and rebuilding ===');
eq(
  'a missed week ends the run',
  computeWeekStreak([...week(1, 3), ...week(2, 1), ...week(3, 3), ...week(4, 3)], 3, NOW),
  { current: 1, longest: 2, thisWeekCounts: false }
);
eq(
  'the longest run is remembered after the current one breaks',
  computeWeekStreak(
    [...week(1, 1), ...week(2, 3), ...week(3, 3), ...week(4, 3), ...week(5, 3)],
    3,
    NOW
  ),
  { current: 0, longest: 4, thisWeekCounts: false }
);
eq(
  'exceeding the target still just counts as one week',
  computeWeekStreak([...week(1, 9), ...week(2, 5)], 3, NOW),
  { current: 2, longest: 2, thisWeekCounts: false }
);

console.log('\n=== nothing to count ===');
eq('no sessions', computeWeekStreak([], 3, NOW), { current: 0, longest: 0, thisWeekCounts: false });
eq('no target', computeWeekStreak(week(1, 5), 0, NOW), { current: 0, longest: 0, thisWeekCounts: false });

console.log('\n=== twelve weeks of load ===');
const sets = (w, n) => Array.from({ length: n }, (_, i) => ({
  completedAt: (() => { const d = new Date(NOW); d.setDate(d.getDate() - (w * 7 + (i % 5))); return d.toISOString(); })(),
}));
const load = computeWeeklyLoad([...sets(0, 12), ...sets(2, 30), ...sets(11, 4)], 12, NOW);
eq('one point per week, oldest first', load.length, 12);
eq('the oldest week', load[0].sets, 4);
eq('a busy week two back', load[9].sets, 30);
eq('this week', load[11].sets, 12);
// The point of the whole chart: a fortnight off has to be visible as a dip.
eq('weeks with nothing logged are present as zero, not skipped',
   load.filter((p) => p.sets === 0).length, 9);
eq('weeks run in order', load.map((p) => p.weekStart).join() === [...load.map((p) => p.weekStart)].sort().join(), true);
eq('nothing logged at all still returns a full window', computeWeeklyLoad([], 12, NOW).length, 12);

console.log(failures === 0 ? '\nAll streak and load tests passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
