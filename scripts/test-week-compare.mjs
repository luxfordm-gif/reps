// Tests the week-against-week comparison and the weekly intensity series.
// Usage: npm test  —  or: node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/test-week-compare.mjs
import {
  compareWeeks as compareWeeksAt,
  compareWindow as compareWindowAt,
  computeWeeklyVolume as computeWeeklyVolumeAt,
  weekVsAveragePct,
  countSessionsByExercise,
} from '../src/lib/dashboard.ts';

let failures = 0;
function eq(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) console.log(`  ✓ ${label}`);
  else { failures += 1; console.log(`  ✗ ${label}\n      got  ${g}\n      want ${w}`); }
}

// A Thursday, so "this week" is three days old — the state the tab is read in.
const NOW = new Date('2026-09-17T18:00:00');
/** A set logged `d` days before now. */
const at = (d) => {
  const t = new Date(NOW);
  t.setDate(t.getDate() - d);
  return t.toISOString();
};
const set = (name, weight, reps, daysAgo) => ({
  normalizedName: name,
  displayName: name === 'bench' ? 'Bench press' : name,
  weight,
  reps,
  completedAt: at(daysAgo),
});
const session = (daysAgo) => ({ completed_at: at(daysAgo) });

// Every fixture here is dated backwards from NOW, so the functions under test
// have to be read from NOW as well. They fall back to the real clock when that
// argument is left off, which doesn't fail — it quietly moves the week
// boundaries out from under the fixtures, so a case that omitted it passed in
// the week it was written and failed from the next Monday on. Defaulted here so
// a call can't be dated from today by accident.
const compareWeeks = (sets, sessions, weeksBack, now = NOW) =>
  compareWeeksAt(sets, sessions, weeksBack, now);
const compareWindow = (sets, sessions, days, now = NOW) =>
  compareWindowAt(sets, sessions, days, now);
const computeWeeklyVolume = (sets, weeks, now = NOW) =>
  computeWeeklyVolumeAt(sets, weeks, now);

console.log('\n=== a lift is only compared where both weeks have it ===');
{
  // This week (Mon 14th onwards): bench 65x8, squat 100x5.
  // Last week: bench 60x8, and a deadlift that isn't in this one.
  const sets = [
    set('bench', 65, 8, 2),
    set('squat', 100, 5, 1),
    set('bench', 60, 8, 9),
    set('deadlift', 120, 5, 8),
  ];
  const c = compareWeeks(sets, [session(2), session(1), session(9)], 1, NOW);
  eq('only the lift in both weeks moves', c.movers.map((m) => m.normalizedName), ['bench']);
  eq('the gain is on estimated 1RM', c.movers[0].deltaPct, 8.3);
  eq('and the top set is carried through', [c.movers[0].previousKg, c.movers[0].currentKg], [60, 65]);
  eq('heavier / lighter / held', [c.heavier, c.lighter, c.held], [1, 0, 0]);
  eq('this week totalled', [c.current.workouts, c.current.sets, c.current.exercises], [2, 2, 2]);
  eq('against last week', [c.previous.workouts, c.previous.sets, c.previous.exercises], [1, 2, 2]);
}

console.log('\n=== reaching back two weeks, for a plan on a fortnight ===');
{
  const sets = [set('bench', 70, 5, 1), set('bench', 60, 5, 8), set('bench', 65, 5, 15)];
  const c = compareWeeks(sets, [], 2, NOW);
  eq('the week before last is the one compared', c.movers[0].previousKg, 65);
  eq('last week is left out of the totals', c.previous.sets, 1);
}

console.log('\n=== heavier for fewer reps is not a free win ===');
{
  // 60x10 is an estimated 80; 65x3 is 71.5 — up on the bar, down on the lift.
  const sets = [set('bench', 65, 3, 1), set('bench', 60, 10, 8)];
  const c = compareWeeks(sets, [], 1, NOW);
  eq('the extra weight reads as a drop', c.movers[0].deltaPct < 0, true);
  eq('though the bar did go up', c.movers[0].deltaKg, 5);
}

console.log('\n=== a week within a percent of the last one is held, not moved ===');
{
  const sets = [set('bench', 100, 5, 1), set('bench', 100, 5, 8)];
  const c = compareWeeks(sets, [], 1, NOW);
  eq('identical weeks hold', [c.heavier, c.lighter, c.held], [0, 0, 1]);
}

console.log('\n=== nothing to compare with ===');
{
  const c = compareWeeks([set('bench', 100, 5, 1)], [session(1)], 1, NOW);
  eq('an empty earlier week yields no movers', c.movers, []);
  eq('but this week still totals up', [c.current.workouts, c.current.sets], [1, 1]);
}

console.log('\n=== the rolling window, for the longer view ===');
{
  // 56 days each side. Bench climbs across the boundary, curl only ever
  // appears in the recent half.
  const sets = [
    set('bench', 70, 5, 3),
    set('bench', 60, 5, 70),
    set('curl', 20, 10, 5),
  ];
  const c = compareWindow(sets, [session(3), session(70)], 56);
  eq('only the lift in both halves moves', c.movers.map((m) => m.normalizedName), ['bench']);
  eq('and it reads as a gain', c.movers[0].deltaPct, 16.7);
  eq('the recent half is the current one', [c.current.sets, c.previous.sets], [2, 1]);
  eq('workouts split across the halves too', [c.current.workouts, c.previous.workouts], [1, 1]);
}
{
  // Today's set must land in the current half, not fall off the end.
  const c = compareWindow([set('bench', 70, 5, 0), set('bench', 60, 5, 40)], [], 30);
  eq('a set logged right now counts', c.movers.length, 1);
}
{
  // A window reaching back before anything was logged has no earlier half.
  const c = compareWindow([set('bench', 70, 5, 1)], [], 30);
  eq('nothing to compare against yields no movers', c.movers, []);
  eq('but the recent half still totals', c.current.sets, 1);
}

console.log('\n=== a mover carries its body part through ===');
{
  const withPart = (bodyPart, daysAgo, weight) => ({
    ...set('bench', weight, 5, daysAgo),
    bodyPart,
  });
  const c = compareWeeks([withPart('Chest', 1, 70), withPart('Chest', 8, 60)], [], 1);
  eq('so the list can be filtered by it', c.movers[0].bodyPart, 'Chest');
  const none = compareWeeks([set('bench', 70, 5, 1), set('bench', 60, 5, 8)], [], 1);
  eq('and is null when the sets have none', none.movers[0].bodyPart, null);
}

console.log('\n=== volume, counted both ways ===');
{
  // Two lifts this week: 100×5 and 60×10 = 500 + 600 = 1100 kg over 2 sets.
  const sets = [set('bench', 100, 5, 1), set('row', 60, 10, 2)];
  const v = computeWeeklyVolume(sets, 4, NOW);
  eq('a point per week in the window', v.length, 4);
  eq('this week totals the kilograms', v[3].kg, 1100);
  eq('and counts the sets', v[3].sets, 2);
  eq('empty weeks are drawn, not skipped', [v[0].kg, v[0].sets], [0, 0]);
}
{
  // Pegs and curves store the real total in `weight`, so nothing is excluded.
  const sets = [set('pegmachine', 40, 10, 1)];
  eq('every machine counts', computeWeeklyVolume(sets, 1, NOW)[0].kg, 400);
}
{
  // A set with no weight still counts as a set, but adds no kilograms.
  const sets = [{ ...set('pullup', 0, 12, 1), weight: null }];
  const v = computeWeeklyVolume(sets, 1, NOW)[0];
  eq('a bodyweight set is a set with no volume', [v.kg, v.sets], [0, 1]);
}

console.log('\n=== this week against the weeks behind it ===');
{
  // Eleven quiet weeks then a big one: 500 kg a week, then 1000.
  const sets = [];
  for (let wk = 1; wk < 12; wk++) sets.push(set('bench', 50, 10, wk * 7));
  sets.push(set('bench', 100, 10, 1));
  const v = computeWeeklyVolume(sets, 12, NOW);
  eq('a week at double the norm reads as +100%', weekVsAveragePct(v, 'kg'), 100);
  eq('sets held level read as no change', weekVsAveragePct(v, 'sets'), 0);
}
{
  // Nothing behind this week: no normal to measure against.
  const v = computeWeeklyVolume([set('bench', 100, 10, 1)], 12, NOW);
  eq('an empty history yields null', weekVsAveragePct(v, 'kg'), null);
  eq('and a single week has nothing to compare', weekVsAveragePct(v.slice(-1), 'kg'), null);
}

console.log('\n=== how often a movement has been trained ===');
{
  // Five sets across two days is two outings, not five.
  const sets = [
    set('bench', 100, 5, 1), set('bench', 100, 5, 1), set('bench', 100, 5, 1),
    set('bench', 95, 5, 8), set('bench', 95, 5, 8),
    set('curl', 20, 10, 3),
  ];
  const counts = countSessionsByExercise(sets);
  eq('days, not sets', counts.get('bench'), 2);
  eq('a movement done once counts once', counts.get('curl'), 1);
  eq('nothing logged is absent from the map', counts.get('squat'), undefined);
  eq('no sets at all is an empty map', countSessionsByExercise([]).size, 0);
}
{
  // Two sessions on the same calendar day are still one day.
  const morning = set('bench', 100, 5, 2);
  const evening = { ...set('bench', 100, 5, 2), completedAt: new Date(new Date(morning.completedAt).setHours(21)).toISOString() };
  eq('twice in a day is one day', countSessionsByExercise([morning, evening]).get('bench'), 1);
}

console.log(failures === 0 ? '\nAll passed.' : `\n${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
