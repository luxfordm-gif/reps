// What an exercise row is badged with, and what a plan file has to be before
// we hand it to the parser.
// Usage: npm test  —  or: node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/test-badges.mjs
import { exerciseBadges, groupedSetLabel, setSchemeLabel } from '../src/lib/supersets.ts';
import { describePlanFileProblem, MAX_PLAN_PDF_BYTES } from '../src/lib/planUpload.ts';

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

console.log('\n=== a group is named for its size ===');
check('two', groupedSetLabel(2), 'Superset');
check('three', groupedSetLabel(3), 'Tri-set');
check('four', groupedSetLabel(4), 'Giant set');
check('five', groupedSetLabel(5), 'Giant set');

console.log('\n=== a row on its own shows only its scheme ===');
check('a drop set', exerciseBadges(0, 'dropset'), ['Dropset']);
check('a muscle round', exerciseBadges(0, 'muscle_round'), ['Muscle Round']);
check('a rest-pause', exerciseBadges(0, 'rest_pause'), ['Rest-Pause']);
check('a hold', exerciseBadges(0, 'hold'), ['Hold']);
check('straight sets get nothing', exerciseBadges(0, 'standard'), []);
check('nor does a missing scheme', exerciseBadges(0, null), []);

console.log('\n=== a row in a group shows the group ===');
check('a pair', exerciseBadges(1, 'standard'), ['Superset']);
check('a tri-set', exerciseBadges(2, 'standard'), ['Tri-set']);
check('a giant set', exerciseBadges(3, 'standard'), ['Giant set']);

console.log('\n=== both, when it is both ===');
{
  // This is the case that was hidden: only one badge was ever shown, and the
  // group won, so a drop set inside a superset looked like an ordinary one.
  check('a drop set inside a superset', exerciseBadges(1, 'dropset'), ['Superset', 'Dropset']);
  check('a drop set inside a giant set', exerciseBadges(3, 'dropset'), ['Giant set', 'Dropset']);
  check('a rest-pause inside a tri-set', exerciseBadges(2, 'rest_pause'), ['Tri-set', 'Rest-Pause']);
}

console.log('\n=== the same fact is not told twice ===');
{
  // A scheme of "superset" on a row that's already in a group says nothing the
  // group badge hasn't.
  check('grouped and schemed superset', exerciseBadges(1, 'superset'), ['Superset']);
  check('the group still names itself by size', exerciseBadges(3, 'superset'), ['Giant set']);
  // Ungrouped, the scheme is the only thing that knows.
  check('but ungrouped it still shows', exerciseBadges(0, 'superset'), ['Superset']);
}

console.log('\n=== scheme labels ===');
check('unknown scheme', setSchemeLabel('something else'), null);
check('undefined', setSchemeLabel(undefined), null);

console.log('\n=== a plan file has to be readable before we try ===');
{
  const ok = { name: 'plan.pdf', size: 40 * 1024 };
  check('an ordinary plan passes', describePlanFileProblem(ok), null);
  check('so does one right on the limit', describePlanFileProblem({ name: 'p.pdf', size: MAX_PLAN_PDF_BYTES }), null);
  check('an empty file is named as empty', describePlanFileProblem({ name: 'p.pdf', size: 0 }), 'p.pdf is empty.');
}
{
  const problem = describePlanFileProblem({ name: 'scan.pdf', size: 24 * 1024 * 1024 });
  check('an oversized file is refused', problem !== null, true);
  check('and told how big it was', problem.includes('24MB'), true);
  check('and what the limit is', problem.includes('10MB'), true);
}
check('the limit is 10MB', MAX_PLAN_PDF_BYTES, 10 * 1024 * 1024);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
if (failures > 0) process.exit(1);
