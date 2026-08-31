// Tests for rest-period defaults and for grouping exercises the plan says to run
// back to back (supersets, tri-sets, giant sets).
// Usage: node --experimental-strip-types scripts/test-rest-supersets.mjs
import { parseTrainingPlan } from '../src/lib/parseTrainingPlan.ts';
import {
  defaultRestSeconds,
  restSecondsForExercises,
  restSecondsFromNotes,
} from '../src/lib/restDefaults.ts';

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

console.log('\n=== rest written in the coach notes ===');
check('seconds before "rest"', restSecondsFromNotes('45 SECONDS MAX REST SLOW TEMPO'), 45);
check('seconds after "rest"', restSecondsFromNotes('Rest 90 seconds between sets'), 90);
check('minutes', restSecondsFromNotes('2 minutes rest'), 120);
check('no rest', restSecondsFromNotes('No rest between movements'), 0);
check('minimal rest', restSecondsFromNotes('Minimal rest'), 30);
check('full recovery', restSecondsFromNotes('Full recovery between sets'), 180);
check('nothing to find', restSecondsFromNotes('Lower lat bias'), null);
check('a stretch hold is not a rest', restSecondsFromNotes('30 second weighted stretch'), null);

console.log('\n=== defaults by movement and scheme ===');
check('normal machine work', defaultRestSeconds({ name: 'Rope pushdown' }), 60);
check('deadlift', defaultRestSeconds({ name: 'Deadlift from floor' }), 120);
check('squat variation', defaultRestSeconds({ name: 'Squat variation of choice' }), 120);
check('leg press', defaultRestSeconds({ name: 'Leg press' }), 120);
check('rdl abbreviation', defaultRestSeconds({ name: 'RDL' }), 120);
check(
  'drop set runs straight through',
  defaultRestSeconds({ name: 'EZ bar curl', setScheme: 'dropset' }),
  0
);
check(
  'notes beat the compound default',
  defaultRestSeconds({ name: 'Squat', notes: 'Rest 30 seconds' }),
  30
);

console.log('\n=== a round rests as long as its longest movement ===');
check(
  'drop set paired with normal work',
  restSecondsForExercises([
    { name: 'Incline cable fly', supersetGroup: 1 },
    { name: 'Nautilus flat press', setScheme: 'dropset', supersetGroup: 1 },
    { name: 'Rope pushdown', supersetGroup: null },
  ]),
  [60, 60, 60]
);

const plan = String.raw`
LEGS
BODY PART EXERCISE TOTAL SETS REP RANGE TEMPO NOTES
GLUTES/HAMS SEATED LEG CURL 2 8-10 1 1 2 1 SUPERSET WITH LEG EXTENSIONS
GLUTES/HAMS LEG EXTENSIONS 2 8-10 1 1 2 1
CHEST INCLINE CABLE FLY 2 8-10 3 1 3 1 TRI-SET WITH NAUTILUS FLAT PRESS AND CABLE CROSSOVER
CHEST NAUTILUS FLAT PRESS 2 10-12 1 1 2 1
CHEST CABLE CROSSOVER 2 12-15 1 1 2 1
SHOULDERS LATERAL RAISE 3 12-15 1 1 1 0 GIANT SET
SHOULDERS FRONT RAISE 3 12-15 1 1 1 0
SHOULDERS REAR DELT FLY 3 12-15 1 1 1 0
SHOULDERS UPRIGHT ROW 3 12-15 1 1 1 0
BICEPS EZ BAR CURL 3 10-12 1 0 1 0 DROPSET SUPERSET WITH REVERSE GRIP
BICEPS HAMMER CURL 3 10-12 1 1 1 0
`;
const day = parseTrainingPlan(plan).days[0];
const byName = (name) => day.exercises.find((e) => e.name === name);

console.log('\n=== grouping from a real plan table ===');
check('named partner pairs both rows', byName('Seated leg curl').supersetGroup, byName('Leg extensions').supersetGroup);
check('and only those two', byName('Seated leg curl').supersetPartnerNames, ['Leg extensions']);
check('tri-set pulls in both partners', byName('Incline cable fly').supersetPartnerNames, [
  'Nautilus flat press',
  'Cable crossover',
]);
check('a bare giant set chains the next three', byName('Lateral raise').supersetPartnerNames, [
  'Front raise',
  'Rear delt fly',
  'Upright row',
]);
check(
  'a variation of the same movement is not a group',
  byName('EZ bar curl').supersetGroup,
  null
);
check('so the row beneath it stays free', byName('Hammer curl').supersetGroup, null);
check('and it keeps its drop-set scheme', byName('EZ bar curl').setScheme, 'dropset');

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exitCode = failures === 0 ? 0 : 1;
