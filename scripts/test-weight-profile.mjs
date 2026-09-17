// Tests for weighted profiles: reading a machine's loading points out of the
// logger's inputs, adding them up into the weight a set logs, and putting a
// logged breakdown back on the right pegs.
// Usage: npm test  —  or: node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/test-weight-profile.mjs
import {
  MAX_LOAD_POSITIONS,
  describePoints,
  isMultiPoint,
  loadedPoints,
  parseLoadPositions,
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

console.log('\n=== how many points a machine has ===');
{
  check('nothing stored is an ordinary machine', parseLoadPositions(null), 1);
  check('a number comes back as itself', parseLoadPositions(3), 3);
  check('the cache stores it as a string', parseLoadPositions('2'), 2);
  check('anything past the third peg is not a profile', parseLoadPositions(4), 1);
  check('nor is junk', parseLoadPositions('sometimes'), 1);
  check('three is as many as a machine gets', MAX_LOAD_POSITIONS, 3);
  check('one point is not a profile', isMultiPoint(1), false);
  check('two is', isMultiPoint(2), true);
  check('neither is a machine with no preference', isMultiPoint(null), false);
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

console.log('\n=== which pegs are carrying weight ===');
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
    'a fourth peg from somewhere is dropped',
    parsePositionWeights([10, 5, 20, 99]),
    [10, 5, 20]
  );
}

console.log('\n=== changing the profile ===');
{
  check('widening leaves the new points empty', resizePoints(['10'], 3, ''), ['10', '', '']);
  check('narrowing drops what it cannot hold', resizePoints(['10', '5', '20'], 2, ''), ['10', '5']);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
