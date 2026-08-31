// Tests for weekly-alternation detection ("alternate weeks with X" and the
// "alternative" keyword family), and that the parser attaches the partner to the
// right exercise. Usage: npm test  —  or: node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/test-weekly-alternative.mjs
import {
  detectWeeklyAlternative,
  parseTrainingPlan,
} from '../src/lib/parseTrainingPlan.ts';

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

console.log('\n=== detectWeeklyAlternative ===');
check(
  'alternate weeks with X',
  detectWeeklyAlternative('ALTERNATE WEEKS WITH MAGNUM BENCH PRESS MACHINE'),
  { name: 'Magnum bench press machine', normalizedName: 'magnum bench press machine' }
);
check(
  'alternate week with X (singular)',
  detectWeeklyAlternative('Alternate week with Hammer strength row'),
  { name: 'Hammer strength row', normalizedName: 'hammer strength row' }
);
check(
  'alternate with X',
  detectWeeklyAlternative('Alternate with cable fly'),
  { name: 'Cable fly', normalizedName: 'cable fly' }
);
check(
  'alternative: X',
  detectWeeklyAlternative('Alternative: Incline smith press'),
  { name: 'Incline smith press', normalizedName: 'incline smith press' }
);
check(
  'alternative is X',
  detectWeeklyAlternative('Alternative is leg press'),
  { name: 'Leg press', normalizedName: 'leg press' }
);
check(
  'alternatively use X',
  detectWeeklyAlternative('Alternatively use pec deck'),
  { name: 'Pec deck', normalizedName: 'pec deck' }
);
check(
  'trailing punctuation trimmed',
  detectWeeklyAlternative('Alternate weeks with hack squat.'),
  { name: 'Hack squat', normalizedName: 'hack squat' }
);
check('no match on ordinary note', detectWeeklyAlternative('Slower negative'), null);
check('empty note', detectWeeklyAlternative(''), null);

console.log('\n=== parser attaches partner to the right exercise ===');
const plan = String.raw`
CHEST
BODY PART EXERCISE TOTAL SETS REP RANGE TEMPO NOTES
CHEST BARBELL BENCH PRESS 3 8-10 1 0 1 0 ALTERNATE WEEKS WITH MAGNUM BENCH PRESS MACHINE
CHEST PEC DECK 3 10-12 3 1 3 1 LAST SET DOUBLE DROP SET
`;
const parsed = parseTrainingPlan(plan);
const chest = parsed.days.find((d) => d.name.toLowerCase() === 'chest');
const bench = chest?.exercises.find((e) => e.normalizedName === 'barbell bench press');
const pec = chest?.exercises.find((e) => e.normalizedName === 'pec deck');
check('bench press has the weekly alternative', bench?.weeklyAlternative, {
  name: 'Magnum bench press machine',
  normalizedName: 'magnum bench press machine',
});
check('pec deck has no weekly alternative', pec?.weeklyAlternative ?? null, null);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
