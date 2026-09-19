// Tests the figures behind a movement's own screen: the range-scoped change in
// estimated 1RM, the most reps ever done, and the record fields under them.
// Usage: npm test  —  or: node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/test-exercise-detail.mjs
import { buildExerciseHistory, est1RMChangePct, mostRepsIn } from '../src/lib/performanceApi.ts';
import { computeRecords } from '../src/lib/records.ts';

let failures = 0;
function eq(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) console.log(`  ✓ ${label}`);
  else { failures += 1; console.log(`  ✗ ${label}\n      got  ${g}\n      want ${w}`); }
}

const at = (d) => {
  const t = new Date('2026-09-17T18:00:00');
  t.setDate(t.getDate() - d);
  return t.toISOString();
};
const perfSet = (weight, reps, daysAgo) => ({
  displayName: 'Adductor',
  normalizedName: 'adductor',
  weight,
  reps,
  completedAt: at(daysAgo),
  bodyPart: 'Quads',
});

console.log('\n=== estimated 1RM across a span ===');
{
  // 100×5 (≈116.7) then 120×5 (≈140) — a clean 20% on the bar and on the estimate.
  const h = buildExerciseHistory([perfSet(100, 5, 30), perfSet(120, 5, 1)], 'adductor');
  eq('two days of history', h.length, 2);
  eq('first against last', est1RMChangePct(h), 20);
}
{
  // Heavier for fewer reps: the bar went up, the estimate went down.
  const h = buildExerciseHistory([perfSet(100, 10, 30), perfSet(110, 3, 1)], 'adductor');
  eq('the estimate can fall while the weight rises', est1RMChangePct(h) < 0, true);
}
{
  const h = buildExerciseHistory([perfSet(100, 5, 1)], 'adductor');
  eq('one session is a reading, not a trend', est1RMChangePct(h), null);
  eq('and no sessions is no answer', est1RMChangePct([]), null);
}
{
  // Days with no weight carry no estimate and must not anchor the figure.
  const h = buildExerciseHistory(
    [{ ...perfSet(0, 20, 30), weight: null }, perfSet(100, 5, 10), perfSet(110, 5, 1)],
    'adductor'
  );
  eq('unscoreable days are skipped', est1RMChangePct(h), 10);
}

console.log('\n=== most reps ever ===');
{
  const h = buildExerciseHistory([perfSet(100, 5, 10), perfSet(60, 14, 3)], 'adductor');
  eq('the highest rep count across every set', mostRepsIn(h), 14);
  eq('nothing logged is null', mostRepsIn([]), null);
}

console.log('\n=== a weighted lift now reports its rep record ===');
{
  // This is the fix: mostReps used to be set only by sets with no weight, so
  // every weighted movement reported nothing and the screen printed a dash.
  const rec = computeRecords([
    { normalizedName: 'adductor', displayName: 'Adductor', bodyPart: 'Quads',
      weightKg: 125, reps: 8, holdSeconds: null, completedAt: at(5) },
    { normalizedName: 'adductor', displayName: 'Adductor', bodyPart: 'Quads',
      weightKg: 100, reps: 14, holdSeconds: null, completedAt: at(2) },
  ])[0];
  eq('the movement is still weighted', rec.kind, 'weighted');
  eq('heaviest is unchanged', rec.heaviest.weightKg, 125);
  eq('and most reps is the best of the weighted sets', rec.mostReps.reps, 14);
}
{
  // Bodyweight movements behave exactly as before.
  const rec = computeRecords([
    { normalizedName: 'pull up', displayName: 'Pull up', bodyPart: 'Back',
      weightKg: null, reps: 10, holdSeconds: null, completedAt: at(5) },
    { normalizedName: 'pull up', displayName: 'Pull up', bodyPart: 'Back',
      weightKg: null, reps: 12, holdSeconds: null, completedAt: at(2) },
  ])[0];
  eq('still a reps record', rec.kind, 'reps');
  eq('with the best set', rec.mostReps.reps, 12);
}

console.log(failures === 0 ? '\nAll passed.' : `\n${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
