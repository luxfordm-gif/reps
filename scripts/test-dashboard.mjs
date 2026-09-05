// Tests for the Performance dashboard's figures: consistency, workouts per
// week, overall strength (and when it refuses to guess), most improved, body
// weight delta, and the small helpers. Usage: npm test  —  or:
// node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/test-dashboard.mjs
import {
  bodyWeightRange,
  computeConsistency,
  computeMostImproved,
  computeOverallStrength,
  computeWorkoutsPerWeek,
  summarizeBodyWeight,
  weekDots,
  weekStartISO,
  weeksOnPlanAt,
} from '../src/lib/dashboard.ts';

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ✓ ${label}`);
  else {
    failures += 1;
    console.log(`  ✗ ${label}\n      expected ${e}\n      got      ${a}`);
  }
}

// A fixed "now": Friday 5 Sep 2026, midday local.
const NOW = new Date(2026, 8, 4, 12, 0, 0);
const daysAgo = (n, h = 10) => {
  const d = new Date(NOW.getTime() - n * 86400000);
  d.setHours(h, 0, 0, 0);
  return d.toISOString();
};
const sess = (n) => ({ completed_at: daysAgo(n) });

console.log('\n=== weeks on plan ===');
check('no plan → 1', weeksOnPlanAt(null, NOW), 1);
check('started today → 1', weeksOnPlanAt(daysAgo(0), NOW), 1);
check('started 6 days ago → still week 1', weeksOnPlanAt(daysAgo(6), NOW), 1);
check('started 7 days ago → week 2', weeksOnPlanAt(daysAgo(7), NOW), 2);
check('started 70 days ago → week 11', weeksOnPlanAt(daysAgo(70), NOW), 11);

console.log('\n=== consistency ===');
{
  // 4 gym days a week, on the plan 3 weeks (14 days ago → week 3), 10 sessions done.
  const sessions = Array.from({ length: 10 }, (_, i) => sess(i));
  const c = computeConsistency(sessions, daysAgo(14), 4, NOW);
  check('planned = target × weeks', c.planned, 12);
  check('done counts sessions since the plan started', c.done, 10);
  check('pct rounded', c.pct, 83);
}
{
  const before = [sess(30), sess(31)];
  const c = computeConsistency([...before, sess(1)], daysAgo(14), 4, NOW);
  check('sessions before the plan started are ignored', c.done, 1);
}
{
  const c = computeConsistency(Array.from({ length: 20 }, (_, i) => sess(i)), daysAgo(14), 4, NOW);
  check('capped at 100', c.pct, 100);
}
check('no plan → null', computeConsistency([sess(1)], null, 4, NOW).pct, null);
check('no gym days → null', computeConsistency([sess(1)], daysAgo(14), 0, NOW).pct, null);

console.log('\n=== workouts per week ===');
{
  const sessions = [sess(1), sess(3), sess(8), sess(10), sess(12), sess(16)];
  const w = computeWorkoutsPerWeek(sessions, daysAgo(20), NOW, 4);
  check('eight-week-style sparkline has the asked-for length', w.weekly.length, 4);
  check('this week is last', w.weekly[3], 2);
  check('average = sessions since start ÷ weeks on plan (3)', w.average, 2);
}
check('nothing logged → null average', computeWorkoutsPerWeek([], daysAgo(20), NOW).average, null);
{
  const w = computeWorkoutsPerWeek([sess(1), sess(2), sess(9)], null, NOW);
  check('no plan: averages over weeks with data', w.average, 1.5);
}

console.log('\n=== overall strength ===');
const lift = (name, kg, reps, n) => ({
  normalizedName: name,
  displayName: name,
  weight: kg,
  reps,
  completedAt: daysAgo(n),
});
{
  // On the plan 42 days. Three lifts, each up ~10% between the first and last fortnight.
  const sets = [
    lift('bench', 100, 5, 40), lift('bench', 110, 5, 3),
    lift('squat', 140, 5, 38), lift('squat', 154, 5, 5),
    lift('row', 80, 8, 41), lift('row', 88, 8, 2),
    // A lift only trained recently: must not move the number.
    lift('curl', 20, 10, 4),
    // A lift only trained early: must not move the number either.
    lift('fly', 30, 12, 39),
  ];
  const s = computeOverallStrength(sets, daysAgo(42), NOW);
  check('three lifts in both windows', s.lifts, 3);
  check('mean change is +10%', s.pct, 10);
  check('no reason when it can be computed', s.reason, null);
  check('series has a point per week with data', s.series.length > 0, true);
  check('the first week is the baseline (~0%)', s.series[0].pct, 0);
}
{
  const s = computeOverallStrength([lift('bench', 100, 5, 20), lift('bench', 110, 5, 1)], daysAgo(21), NOW);
  check('under four weeks → too early', s.reason, 'too_early');
  check('and no number', s.pct, null);
}
{
  const s = computeOverallStrength([lift('bench', 100, 5, 40), lift('bench', 110, 5, 3)], daysAgo(42), NOW);
  check('one lift → too few', s.reason, 'too_few_lifts');
  check('but says how many it had', s.lifts, 1);
}
check('no plan → no_plan', computeOverallStrength([], null, NOW).reason, 'no_plan');
{
  // Sets from before the plan started don't count as baseline.
  const sets = [
    lift('bench', 200, 5, 60), // pre-plan monster set
    lift('bench', 100, 5, 40), lift('bench', 105, 5, 2),
    lift('squat', 100, 5, 40), lift('squat', 105, 5, 2),
    lift('row', 100, 5, 40), lift('row', 105, 5, 2),
  ];
  const s = computeOverallStrength(sets, daysAgo(42), NOW);
  check('pre-plan sets are ignored', s.pct, 5);
}

console.log('\n=== most improved ===');
{
  const sets = [
    lift('bench', 100, 5, 45), lift('bench', 105, 5, 10),
    lift('squat', 140, 5, 40), lift('squat', 168, 5, 8), // +20%
    lift('row', 80, 8, 50), lift('row', 78, 8, 3), // went down
  ];
  const m = computeMostImproved(sets, NOW);
  check('the biggest kg gain wins', m.normalizedName, 'squat');
  check('delta in kg', Math.round(m.deltaKg), 33);
  check('delta in %', Math.round(m.deltaPct), 20);
}
check('nothing improved → null', computeMostImproved([lift('row', 80, 8, 50), lift('row', 78, 8, 3)], NOW), null);
check('no prior window → null', computeMostImproved([lift('bench', 100, 5, 3)], NOW), null);

console.log('\n=== body weight ===');
{
  const rows = [
    { weight_kg: 93.4, recorded_on: '2026-05-18' },
    { weight_kg: 92.0, recorded_on: '2026-07-01' },
    { weight_kg: 91.8, recorded_on: '2026-09-03' },
  ];
  const s = summarizeBodyWeight(rows, '2026-06-20T08:00:00.000Z');
  check('latest reading', s.latestKg, 91.8);
  check('delta is measured from the first reading on the plan', s.deltaKg, -0.2);
  check('and says so', s.since, 'plan');
  const noPlan = summarizeBodyWeight(rows, null);
  check('no plan: from the earliest reading', noPlan.deltaKg, -1.6);
  check('and says so', noPlan.since, 'first');
}
check('no rows → null', summarizeBodyWeight([], null), null);
{
  const one = summarizeBodyWeight([{ weight_kg: 90, recorded_on: '2026-09-01' }], null);
  check('a single reading has no delta', one.deltaKg, null);
}
{
  const rows = [
    { recorded_on: '2026-01-01' },
    { recorded_on: '2026-08-01' },
    { recorded_on: '2026-09-01' },
  ];
  check('range keeps the last 84 days, oldest first', bodyWeightRange(rows, 84, NOW).map((r) => r.recorded_on), [
    '2026-08-01',
    '2026-09-01',
  ]);
}

console.log('\n=== helpers ===');
check('week dots from bars', weekDots([[0.5], [], [0.7, 0.2], [], [], [], []]), [true, false, true, false, false, false, false]);
check('week start is a Monday', weekStartISO(new Date(2026, 8, 4)), '2026-08-31');

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
