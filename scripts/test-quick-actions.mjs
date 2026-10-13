// Tests for the home screen's quick action row config: which tiles are shown,
// in what order, and the guards that stop a stored value from emptying the row.
// Usage: npm test  —  or: node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/test-quick-actions.mjs
import {
  DEFAULT_QUICK_ACTIONS,
  normalizeQuickActions,
  moveQuickAction,
  toggleQuickAction,
  withNewQuickActions,
} from '../src/lib/quickActions.ts';

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

console.log('normalize');
check('a stored list is kept as-is', normalizeQuickActions(['steps', 'water']), [
  'steps',
  'water',
]);
check('unknown ids are dropped', normalizeQuickActions(['steps', 'mood', 'water']), [
  'steps',
  'water',
]);
check('duplicates collapse', normalizeQuickActions(['water', 'water', 'steps']), [
  'water',
  'steps',
]);
check('an empty list falls back to the default', normalizeQuickActions([]), DEFAULT_QUICK_ACTIONS);
check('rubbish falls back to the default', normalizeQuickActions('water'), DEFAULT_QUICK_ACTIONS);
check(
  'a list of only unknown ids falls back to the default',
  normalizeQuickActions(['mood', 'heart']),
  DEFAULT_QUICK_ACTIONS
);
check('steps is on by default', DEFAULT_QUICK_ACTIONS.includes('steps'), true);
check('sleep is on by default', DEFAULT_QUICK_ACTIONS.includes('sleep'), true);

console.log('new tiles');
check(
  'a list saved before sleep existed gets it on the end',
  withNewQuickActions(['steps', 'water'], null),
  ['steps', 'water', 'sleep']
);
check(
  'sleep switched off after it was offered stays off',
  withNewQuickActions(['steps', 'water'], ['water', 'coffee', 'weight', 'steps', 'sleep']),
  ['steps', 'water']
);
check(
  'a list that already has sleep is left alone',
  withNewQuickActions(['sleep', 'water'], null),
  ['sleep', 'water']
);

console.log('toggle');
check('switching a tile off removes it', toggleQuickAction(['water', 'steps'], 'water'), [
  'steps',
]);
check('switching one on appends it', toggleQuickAction(['water'], 'steps'), [
  'water',
  'steps',
]);
check('the last tile can not be switched off', toggleQuickAction(['water'], 'water'), [
  'water',
]);

console.log('reorder');
check('moving earlier swaps with the tile in front', moveQuickAction(['water', 'coffee', 'steps'], 'steps', -1), [
  'water',
  'steps',
  'coffee',
]);
check('moving later swaps with the tile behind', moveQuickAction(['water', 'coffee', 'steps'], 'water', 1), [
  'coffee',
  'water',
  'steps',
]);
check('the first tile can not move earlier', moveQuickAction(['water', 'steps'], 'water', -1), [
  'water',
  'steps',
]);
check('the last tile can not move later', moveQuickAction(['water', 'steps'], 'steps', 1), [
  'water',
  'steps',
]);
check('a tile that is switched off does not move', moveQuickAction(['water', 'steps'], 'coffee', -1), [
  'water',
  'steps',
]);

if (failures > 0) {
  console.log(`\n${failures} failing`);
  process.exit(1);
}
console.log('\nall passing');
