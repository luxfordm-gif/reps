// Tests the average behind the water and steps tiles — what it divides by,
// and how far back it reaches.
// Usage: npm test  —  or: node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/test-daily-average.mjs
import { dailyAverage, HABIT_WINDOW_DAYS } from '../src/lib/dashboard.ts';

let failures = 0;
function eq(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) console.log(`  ✓ ${label}`);
  else { failures += 1; console.log(`  ✗ ${label}\n      got  ${g}\n      want ${w}`); }
}

// Friday 18 Sept 2026. Three weeks back reaches Sat 29 Aug inclusive.
const NOW = new Date('2026-09-18T12:00:00');
const d = (iso, value) => ({ date: iso, value });
const sept = (day, value) => d(`2026-09-${String(day).padStart(2, '0')}`, value);
const aug = (day, value) => d(`2026-08-${String(day).padStart(2, '0')}`, value);

console.log('\n=== the window is three weeks ===');
eq('twenty-one days', HABIT_WINDOW_DAYS, 21);
eq(
  'the far edge is in it',
  dailyAverage([aug(29, 8)], HABIT_WINDOW_DAYS, NOW),
  { average: 8, daysLogged: 1 }
);
eq(
  'the day before it is not',
  dailyAverage([aug(28, 99)], HABIT_WINDOW_DAYS, NOW),
  { average: null, daysLogged: 0 }
);
// The reason for widening it: a week-long window showed a dash every Monday,
// and any gap since Sunday read as the tile being broken rather than as a
// gap. Three weeks still has something to say.
eq(
  'a fortnight-old reading still counts',
  dailyAverage([sept(4, 9000)], HABIT_WINDOW_DAYS, NOW),
  { average: 9000, daysLogged: 1 }
);

console.log('\n=== what it divides by ===');
// Three days logged out of twenty-one. Dividing by the calendar would make a
// well-tracked fortnight look like a failure.
eq(
  'averaged over the days logged, not the days elapsed',
  dailyAverage([sept(14, 10), sept(15, 10), sept(16, 10)], HABIT_WINDOW_DAYS, NOW),
  { average: 10, daysLogged: 3 }
);
eq(
  'one day logged is an average of that day',
  dailyAverage([sept(18, 6)], HABIT_WINDOW_DAYS, NOW),
  { average: 6, daysLogged: 1 }
);
// A future-dated row shouldn't inflate the window.
eq(
  'a day that has not happened is not in it',
  dailyAverage([sept(16, 4), sept(20, 100)], HABIT_WINDOW_DAYS, NOW),
  { average: 4, daysLogged: 1 }
);

console.log('\n=== zeroes and duplicates ===');
// The water tile decrements too, so a zero row is usually a tap taken back.
eq(
  'a zero row is not a logged day',
  dailyAverage([sept(14, 0), sept(15, 6), sept(16, 4)], HABIT_WINDOW_DAYS, NOW),
  { average: 5, daysLogged: 2 }
);
eq(
  'two rows for one day count as one day',
  dailyAverage([sept(15, 3), sept(15, 3), sept(16, 6)], HABIT_WINDOW_DAYS, NOW),
  { average: 6, daysLogged: 2 }
);

console.log('\n=== nothing to average ===');
eq('no entries', dailyAverage([], HABIT_WINDOW_DAYS, NOW), { average: null, daysLogged: 0 });
eq(
  'only zeroes',
  dailyAverage([sept(14, 0), sept(15, 0)], HABIT_WINDOW_DAYS, NOW),
  { average: null, daysLogged: 0 }
);
eq(
  'only rows older than the window',
  dailyAverage([aug(10, 5)], HABIT_WINDOW_DAYS, NOW),
  { average: null, daysLogged: 0 }
);

console.log(failures === 0 ? '\nAll daily-average tests passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
