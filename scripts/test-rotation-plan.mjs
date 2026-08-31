// Tests for rotating plans: numbered day headers ("LEGS 1"), ROTATION WEEK
// markers, a home abs workout outside the rotation, and the row shapes a
// merged-cell abs table produces.
// Usage: node --experimental-strip-types scripts/test-rotation-plan.mjs
import { parseTrainingPlan } from '../src/lib/parseTrainingPlan.ts';
import { restSecondsFromNotes } from '../src/lib/restDefaults.ts';

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

// Trimmed from a real two-week PPL plan, keeping every shape that matters:
// the volume table that must NOT read as a day, numbered day titles, the
// rotation markers, and the abs table's merged body-part cell and SUPERSET
// set counts.
const plan = String.raw`
WEEKS VOLUME
CHEST 7
BACK 15
ALL SETS LISTED ARE WORKING SETS - USE 1-2 FEEDER SETS WHEN REQUIRED
ROTATION WEEK 1
LEGS 1
BODY PART EXERCISE TOTAL SETS RANGE REP TEMPO NOTES
QUADS ADDUCTOR 2 6-8 1 1 2 1
QUADS CYBEX OG LEG PRESS 3 8-10 4 1 1 0 SET 3: 10 REPS SLOW TEMPO, 30s REST, 5 REPS SLOW TEMPO
PUSH 1
BODY PART EXERCISE TOTAL SETS RANGE REP TEMPO NOTES
CHEST FLAT SMITH BENCH PRESS 2 6-8 1 0 1 0
ROTATION WEEK 2
LEGS 2
BODY PART EXERCISE TOTAL SETS RANGE REP TEMPO NOTES
QUADS CYBEX HACK SQUAT 2 10-12 2 0 1 1
GLUTES/HAMS BELT SQUAT RDL 2 6-8 2 1 1 0 SET 2: CLUSTER SET 5 SETS 5 REPS 1 MIN REST
Abdominals Home Workout (1x Weekly)
BODY PART EXERCISE TOTAL SETS RANGE REP TEMPO NOTES
ABDOMINALS SIT UPS 3 Failure 1 0 2 0
ABDOMINALS FLUTTER KICKS 3 Max Time
WEIGHTED CRUNCHES 5kg SUPERSET 8 - 12 1 1 1 0
WEIGHTED BICYCLES 5kg SUPERSET Failure
CRUNCHES SUPERSET Failure
ABDOMINALS REPEAT SUPERSET X 2
SIDE PLANKS SUPERSET MAX HOLD
PLANKS SUPERSET MAX HOLD 1 0 1 0
`;

const result = parseTrainingPlan(plan);
const day = (name) => result.days.find((d) => d.name === name);

console.log('\n=== days and rotation weeks ===');
check('every day found', result.days.map((d) => d.name), [
  'Legs 1',
  'Push 1',
  'Legs 2',
  'Abs',
]);
check('week 1 days', [day('Legs 1').weekIndex, day('Push 1').weekIndex], [1, 1]);
check('week 2 days', day('Legs 2').weekIndex, 2);
check('home abs runs every week', day('Abs').weekIndex, null);
check('home abs is a reference card, not a tracked session', day('Abs').referenceOnly, true);
check('gym days are still tracked', day('Legs 1').referenceOnly, false);
check('no warnings', result.warnings, []);
check('nothing unparsed', result.unparsedLines, []);
check(
  'the volume table is not mistaken for a day',
  result.days.some((d) => d.name === 'CHEST' || d.name === 'Chest'),
  false
);

console.log('\n=== abs table shapes ===');
const abs = day('Abs').exercises;
check('every abs row parsed', abs.length, 7);
check('failure rep range', abs[0].repRange, 'Failure');
check('a row with no tempo at all', [abs[1].name, abs[1].repRange, abs[1].tempo], [
  'Flutter kicks',
  'Max Time',
  null,
]);
check(
  'merged body-part cell inherited down the block',
  abs.slice(2).every((e) => e.bodyPart === 'Abdominals'),
  true
);
check('the giant set is one group', new Set(abs.slice(2).map((e) => e.supersetGroup)).size, 1);
check('with all five movements in it', abs.slice(2).length, 5);
check('rounds come from the repeat note', abs[2].totalSets, 2);

console.log('\n=== rest inside a set is not rest between sets ===');
check(
  'cluster-set rest ignored',
  restSecondsFromNotes('SET 2: CLUSTER SET 5 SETS 5 REPS 1 MIN REST'),
  null
);
check(
  'per-set protocol rest ignored',
  restSecondsFromNotes('SET 3: 10 REPS SLOW TEMPO, 30s REST, 5 REPS SLOW TEMPO'),
  null
);
check('a plain rest note still counts', restSecondsFromNotes('45 SECONDS MAX REST'), 45);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exitCode = failures === 0 ? 0 : 1;
