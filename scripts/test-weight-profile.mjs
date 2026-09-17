// Tests for weight profiles: reading a machine's profile, reading its loading
// points out of the logger's inputs, adding them up into the weight a set logs,
// and putting a logged breakdown back on the right pegs or cam position.
// Usage: npm test  —  or: node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/test-weight-profile.mjs
import {
  MAX_PROFILE_POSITIONS,
  MIN_PROFILE_POSITIONS,
  clampPositions,
  curveBreakdown,
  curvePointOf,
  describePoints,
  hasCurve,
  hasPegs,
  loadedPoints,
  parseProfile,
  parseProfileKind,
  parsePositionWeights,
  readPointInputs,
  resizePoints,
  sumPoints,
} from '../src/lib/weightProfile.ts';

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

console.log('\n=== what profile a machine has ===');
{
  check('an untagged machine has none', parseProfile(null, null), { kind: null, positions: 1 });
  check('pegs come back with their count', parseProfile('pegs', 3), { kind: 'pegs', positions: 3 });
  check('so does a curve', parseProfile('curve', 6), { kind: 'curve', positions: 6 });
  check(
    'a count with no kind is a machine tagged before curves existed',
    parseProfile(null, 3),
    { kind: 'pegs', positions: 3 }
  );
  check('a count of one is no profile at all', parseProfile(null, 1), { kind: null, positions: 1 });
  check(
    'a kind with no count gets the usual three',
    parseProfile('curve', null),
    { kind: 'curve', positions: 3 }
  );
  check('a made-up kind is not a profile', parseProfileKind('springs'), null);
  check('pegs need more than one to be pegs', hasPegs({ kind: 'pegs', positions: 1 }), false);
  check('two pegs are pegs', hasPegs({ kind: 'pegs', positions: 2 }), true);
  check('a curve is not pegs', hasPegs({ kind: 'curve', positions: 3 }), false);
  check('and pegs are not a curve', hasCurve({ kind: 'pegs', positions: 3 }), false);
}

console.log('\n=== how many positions ===');
{
  check('a machine cannot have fewer than two', clampPositions(1), MIN_PROFILE_POSITIONS);
  check('a Strive-sized six is fine', clampPositions(6), 6);
  check('a fat-fingered sixty is not', clampPositions(60), MAX_PROFILE_POSITIONS);
  check('the cache stores it as a string', clampPositions('5'), 5);
  check('junk falls back to the default', clampPositions('four'), 3);
  check('a half position is rounded', clampPositions(4.4), 4);
}

console.log('\n=== adding the points up ===');
{
  check('the total is what is hung on every point', sumPoints([10, null, 20]), 30);
  check('an empty machine has no weight, not zero', sumPoints([null, null]), null);
  check('a deliberate zero is a weight', sumPoints([0, null]), 0);
  check('halves add up cleanly', sumPoints([2.5, 2.5, 20]), 25);
}

console.log('\n=== reading the logger\'s inputs ===');
{
  const read = readPointInputs(['10', '', '20']);
  check('blank points are unloaded', read.values, [10, null, 20]);
  check('and the rest add up', read.total, 30);
  check('nothing is wrong with that', read.invalid, false);

  const empty = readPointInputs(['', '', '']);
  check('an untouched set has no total', empty.total, null);
  check('which is not a complaint', empty.invalid, false);

  const bad = readPointInputs(['10', 'x']);
  check('a point that is not a number is refused', bad.invalid, true);

  const spaced = readPointInputs([' 12.5 ', '']);
  check('a typed-in space is still a number', spaced.total, 12.5);

  const single = readPointInputs(['40']);
  check('an ordinary machine is just the one point', single.total, 40);
}

console.log('\n=== which positions are carrying weight ===');
{
  check('the loaded ones, by their numbers', loadedPoints([10, null, 20]), [1, 3]);
  check('an empty machine has none', loadedPoints([null, null, null]), []);
  check(
    'and they read back the way the machine is set up',
    describePoints([10, null, 20], (n) => `${n} kg`),
    '1 · 10 kg + 3 · 20 kg'
  );
}

console.log('\n=== restoring a logged breakdown ===');
{
  check('a stored array comes back whole', parsePositionWeights([10, null, 20]), [10, null, 20]);
  check(
    'jsonb handed back as text is parsed',
    parsePositionWeights('[10,null,20]'),
    [10, null, 20]
  );
  check('a set logged before the profile existed has none', parsePositionWeights(null), null);
  check('nor does a row of nulls count as one', parsePositionWeights([null, null]), null);
  check('junk in the column is ignored', parsePositionWeights('not json'), null);
  check('a short array grows to the machine', parsePositionWeights([10], 3), [10, null, null]);
  check(
    'a machine with four pegs keeps all four',
    parsePositionWeights([10, 5, 20, 99]),
    [10, 5, 20, 99]
  );
  check(
    'but nothing past the cap survives',
    parsePositionWeights([1, 2, 3, 4, 5, 6, 7, 8, 9]).length,
    MAX_PROFILE_POSITIONS
  );
}

console.log('\n=== a curve is a breakdown with one position ===');
{
  check(
    'the whole weight goes on the chosen position',
    curveBreakdown(6, 3, 30),
    [null, null, null, 30, null, null]
  );
  check('and that is still the set\'s weight', sumPoints(curveBreakdown(6, 3, 30)), 30);
  check('which position it was reads back', curvePointOf(curveBreakdown(6, 3, 30)), 3);
  check('the first position is zero, not one', curvePointOf([30, null, null]), 0);
  check('a set on no position has none', curvePointOf(null), null);
  check('and a pegs load is not a curve', curvePointOf([10, null, 20]), null);
}

console.log('\n=== changing the profile ===');
{
  check('widening leaves the new positions empty', resizePoints(['10'], 3, ''), ['10', '', '']);
  check('narrowing drops what it cannot hold', resizePoints(['10', '5', '20'], 2, ''), ['10', '5']);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
