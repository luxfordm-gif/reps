// Tests for all-time personal records: the three record kinds (weighted,
// bodyweight reps, timed hold), tie-breaks, and the guarantee that a record
// survives a new plan's history reset.
// Usage: npm test  —  or: node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/test-records.mjs
import {
  computeRecords,
  groupByBodyPart,
  recordAchievedAt,
} from '../src/lib/records.ts';

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}\n      expected ${e}\n      got      ${a}`);
  }
}

const set = (over) => ({
  normalizedName: 'flat bench press',
  displayName: 'Flat bench press',
  bodyPart: 'Chest',
  weightKg: null,
  reps: null,
  holdSeconds: null,
  completedAt: '2026-01-01T10:00:00.000Z',
  ...over,
});

console.log('\n=== weighted lifts ===');
{
  const records = computeRecords([
    set({ weightKg: 80, reps: 8, completedAt: '2026-01-01T10:00:00.000Z' }),
    set({ weightKg: 100, reps: 3, completedAt: '2026-02-01T10:00:00.000Z' }),
    set({ weightKg: 90, reps: 10, completedAt: '2026-03-01T10:00:00.000Z' }),
  ]);
  check('one record per movement', records.length, 1);
  const r = records[0];
  check('kind is weighted', r.kind, 'weighted');
  check('heaviest set is the heaviest weight', r.heaviest.weightKg, 100);
  check('heaviest carries its reps', r.heaviest.reps, 3);
  // Epley: 90 * (1 + 10/30) = 120 beats 100 * (1 + 3/30) = 110.
  check('best 1RM is the best estimate, not the heaviest bar', r.best1RM.weightKg, 90);
  check('1RM estimate', Math.round(r.best1RMkg), 120);
  check('every set counted', r.totalSets, 3);
  check('headline date is the heaviest set', recordAchievedAt(r), '2026-02-01T10:00:00.000Z');
}

console.log('\n=== tie-breaks ===');
{
  const records = computeRecords([
    set({ weightKg: 100, reps: 5, completedAt: '2026-01-01T10:00:00.000Z' }),
    set({ weightKg: 100, reps: 8, completedAt: '2026-02-01T10:00:00.000Z' }),
  ]);
  check('same weight, more reps wins', records[0].heaviest.reps, 8);
}
{
  const records = computeRecords([
    set({ weightKg: 100, reps: 5, completedAt: '2026-01-01T10:00:00.000Z' }),
    set({ weightKg: 100, reps: 5, completedAt: '2026-06-01T10:00:00.000Z' }),
  ]);
  check(
    'an identical set later does not move the record date',
    recordAchievedAt(records[0]),
    '2026-01-01T10:00:00.000Z'
  );
}

console.log('\n=== bodyweight and holds ===');
{
  const records = computeRecords([
    set({ normalizedName: 'pull ups', displayName: 'Pull ups', reps: 8 }),
    set({ normalizedName: 'pull ups', displayName: 'Pull ups', reps: 12 }),
  ]);
  check('bodyweight movement is a reps record', records[0].kind, 'reps');
  check('most reps wins', records[0].mostReps.reps, 12);
  check('no phantom weight record', records[0].heaviest, null);
}
{
  const records = computeRecords([
    set({ normalizedName: 'plank', displayName: 'Plank', holdSeconds: 60 }),
    set({ normalizedName: 'plank', displayName: 'Plank', holdSeconds: 95 }),
  ]);
  check('timed movement is a hold record', records[0].kind, 'hold');
  check('longest hold wins', records[0].longestHold.holdSeconds, 95);
}
{
  // A weighted movement that also has a hold stays a weighted record — that's
  // the number a lifter means by "my best".
  const records = computeRecords([
    set({ weightKg: 60, reps: 5 }),
    set({ holdSeconds: 30 }),
  ]);
  check('weight wins over hold for the headline', records[0].kind, 'weighted');
  check('the hold is still kept', records[0].longestHold.holdSeconds, 30);
}
{
  const records = computeRecords([set({ weightKg: null, reps: null })]);
  check('a movement with nothing scoreable is not a record', records.length, 0);
}

console.log('\n=== a new plan never costs you a record ===');
{
  // The scenario the reset default creates: sets logged under an old plan, then
  // a new plan starts the machine fresh. computeRecords reads every set ever
  // logged and knows nothing about baseline_reset_at, so the old PR survives.
  const oldPlanPR = set({
    weightKg: 120,
    reps: 5,
    completedAt: '2025-06-01T10:00:00.000Z',
  });
  const afterReset = set({
    weightKg: 60,
    reps: 12,
    completedAt: '2026-09-01T10:00:00.000Z',
  });
  const records = computeRecords([oldPlanPR, afterReset]);
  check('the pre-reset PR still stands', records[0].heaviest.weightKg, 120);
  check(
    'and keeps its original date',
    recordAchievedAt(records[0]),
    '2025-06-01T10:00:00.000Z'
  );
}

console.log('\n=== naming and grouping ===');
{
  const records = computeRecords([
    set({ displayName: 'Cybex bench', completedAt: '2026-01-01T10:00:00.000Z', weightKg: 50, reps: 5 }),
    set({ displayName: 'Flat bench press', completedAt: '2026-05-01T10:00:00.000Z', weightKg: 50, reps: 5 }),
  ]);
  check('the most recent name is used', records[0].displayName, 'Flat bench press');
}
{
  const records = computeRecords([
    set({ normalizedName: 'squat', displayName: 'Squat', bodyPart: 'Quads', weightKg: 140, reps: 5 }),
    set({ normalizedName: 'bench', displayName: 'Bench', bodyPart: 'Chest', weightKg: 100, reps: 5 }),
    set({ normalizedName: 'curl', displayName: 'Curl', bodyPart: null, weightKg: 20, reps: 10 }),
  ]);
  check(
    'grouped by body part, Other last',
    groupByBodyPart(records).map((g) => g.bodyPart),
    ['Chest', 'Quads', 'Other']
  );
}
{
  const records = computeRecords([
    set({ normalizedName: 'plank', displayName: 'Plank', holdSeconds: 60 }),
    set({ normalizedName: 'pull ups', displayName: 'Pull ups', reps: 10 }),
    set({ normalizedName: 'squat', displayName: 'Squat', weightKg: 140, reps: 5 }),
  ]);
  check(
    'weighted lifts sort ahead of reps, then holds',
    records.map((r) => r.kind),
    ['weighted', 'reps', 'hold']
  );
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
