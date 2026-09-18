// Tests the weekly average behind the water and steps tiles — in particular
// what it divides by.
// Usage: npm test  —  or: node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/test-daily-average.mjs
import { weekDailyAverage } from '../src/lib/dashboard.ts';

let failures = 0;
function eq(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) console.log(`  ✓ ${label}`);
  else { failures += 1; console.log(`  ✗ ${label}\n      got  ${g}\n      want ${w}`); }
}

// Friday 18 Sept 2026. The week runs Mon 14th to today.
const NOW = new Date('2026-09-18T12:00:00');
const d = (day, value) => ({ date: `2026-09-${String(day).padStart(2, '0')}`, value });

console.log('\n=== what it divides by ===');
// Three days logged out of five elapsed. Dividing by the calendar would give
// 6 a day and make a well-tracked week look like a bad one.
eq(
  'averaged over the days logged, not the days elapsed',
  weekDailyAverage([d(14, 10), d(15, 10), d(16, 10)], NOW),
  { average: 10, daysLogged: 3 }
);
eq(
  'one day logged is an average of that day',
  weekDailyAverage([d(18, 6)], NOW),
  { average: 6, daysLogged: 1 }
);

console.log('\n=== the week boundary ===');
eq(
  'last week is not in it',
  weekDailyAverage([d(13, 99), d(12, 99), d(16, 4)], NOW),
  { average: 4, daysLogged: 1 }
);
eq(
  'Monday is in it',
  weekDailyAverage([d(14, 8)], NOW),
  { average: 8, daysLogged: 1 }
);
// A future-dated row shouldn't inflate a week in progress.
eq(
  'a day that has not happened is not in it',
  weekDailyAverage([d(16, 4), d(20, 100)], NOW),
  { average: 4, daysLogged: 1 }
);

console.log('\n=== zeroes and duplicates ===');
// The water tile decrements too, so a zero row is usually a tap taken back.
eq(
  'a zero row is not a logged day',
  weekDailyAverage([d(14, 0), d(15, 6), d(16, 4)], NOW),
  { average: 5, daysLogged: 2 }
);
eq(
  'two rows for one day count as one day',
  weekDailyAverage([d(15, 3), d(15, 3), d(16, 6)], NOW),
  { average: 6, daysLogged: 2 }
);

console.log('\n=== nothing to average ===');
eq('no entries', weekDailyAverage([], NOW), { average: null, daysLogged: 0 });
eq('only zeroes', weekDailyAverage([d(14, 0), d(15, 0)], NOW), { average: null, daysLogged: 0 });
eq('only last week', weekDailyAverage([d(10, 5)], NOW), { average: null, daysLogged: 0 });

console.log(failures === 0 ? '\nAll daily-average tests passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
