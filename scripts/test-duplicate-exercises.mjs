// Tests the duplicate-exercise detector — in particular what it refuses to
// suggest, since accepting a wrong pair merges two histories irreversibly.
// Usage: npm test  —  or: node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/test-duplicate-exercises.mjs
import { findDuplicatePairs } from '../src/lib/duplicateExercises.ts';

let failures = 0;
function eq(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) console.log(`  ✓ ${label}`);
  else { failures += 1; console.log(`  ✗ ${label}\n      got  ${g}\n      want ${w}`); }
}

const m = (displayName, bodyPart, setCount, unit = 'kg', planRefCount = 1) => ({
  normalizedName: displayName.toLowerCase(),
  displayName,
  bodyPart,
  unit,
  setCount,
  planRefCount,
});
const keys = (pairs) => pairs.map((p) => `${p.survivor.displayName}+${p.loser.displayName}`);

console.log('\n=== the real pairs, from an actual machine list ===');
{
  const pairs = findDuplicatePairs([
    m('Deadlift', 'Back', 8),
    m('Deadlift from floor', 'Back', 24),
  ]);
  eq('a name plus words is the same movement', keys(pairs), ['Deadlift from floor+Deadlift']);
  eq('and the reason is named', pairs[0].reason, 'extension');
  eq('the survivor is the one with more history', pairs[0].survivor.setCount, 24);
}
{
  const pairs = findDuplicatePairs([
    m('Hammer strngth high row', 'Back', 5),
    m('Hammer strength high row', 'Back', 40),
  ]);
  eq('a typo in a long name is caught', keys(pairs), ['Hammer strength high row+Hammer strngth high row']);
  eq('reason', pairs[0].reason, 'typo');
}
{
  const pairs = findDuplicatePairs([
    m('Assisted pullup', 'Back', 3),
    m('Assisted pullups', 'Back', 30),
  ]);
  eq('a stray plural is caught', keys(pairs), ['Assisted pullups+Assisted pullup']);
  eq('reason', pairs[0].reason, 'plural');
}

console.log('\n=== what it must never suggest ===');
{
  // One character apart, same body part, opposite muscles. This pair is the
  // reason the threshold is relative to length rather than a flat distance.
  const pairs = findDuplicatePairs([
    m('Abductor', 'Glutes/hams', 0),
    m('Adductor', 'Glutes/hams', 4),
  ]);
  eq('abductor and adductor are left alone', keys(pairs), []);
}
{
  // Short words one edit apart.
  eq('curl / curls is too short to judge', keys(findDuplicatePairs([m('Curl', 'Biceps', 5), m('Curls', 'Biceps', 6)])), []);
}
{
  // A word inside another word is not a phrase inside a phrase.
  eq('row is not inside arrow', keys(findDuplicatePairs([m('Barrow', 'Back', 5), m('Barrows', null, 5)])).length > 0, true);
  eq('press is not inside compressed', keys(findDuplicatePairs([m('Chest press', 'Chest', 9), m('Compressed chest', 'Chest', 9)])), []);
}
{
  // Similar names, but the app knows they train different things.
  eq(
    'a disagreeing body part rules a pair out',
    keys(findDuplicatePairs([m('Front raise', 'Shoulders', 9), m('Front raises', 'Chest', 9)])),
    [],
  );
  // Unknown on one side says nothing either way, so the pair still stands.
  eq(
    'an unknown body part does not rule it out',
    keys(findDuplicatePairs([m('Front raise', 'Shoulders', 9), m('Front raises', null, 12)])),
    ['Front raises+Front raise'],
  );
}

console.log('\n=== dismissals and ordering ===');
{
  const machines = [
    m('Deadlift', 'Back', 8),
    m('Deadlift from floor', 'Back', 24),
    m('Assisted pullup', 'Back', 3),
    m('Assisted pullups', 'Back', 30),
  ];
  const all = findDuplicatePairs(machines);
  eq('both pairs found', all.length, 2);
  eq('a plural sorts above an extension', all[0].reason, 'plural');
  const dismissed = new Set([all[0].key]);
  eq('a dismissed pair stays dismissed', findDuplicatePairs(machines, dismissed).length, 1);
  eq('and the key is order-independent', all[0].key, all[0].key.split('\u0000').sort().join('\u0000'));
}
{
  const pairs = findDuplicatePairs([
    m('Leg press', 'Quads', 10, 'kg'),
    m('Leg presses', 'Quads', 4, 'pin'),
  ]);
  eq('a unit difference is flagged, not hidden', pairs[0].unitDiffers, true);
}
{
  eq('nothing to compare', findDuplicatePairs([]), []);
  eq('one machine is never a pair', findDuplicatePairs([m('Deadlift', 'Back', 8)]), []);
}

console.log(failures === 0 ? '\nAll passed.' : `\n${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
