// Tests for the per-day rotation: grouping "Legs 1"/"Legs 2" into one Legs
// slot, card order, and which week's version a slot opens.
// Usage: node --experimental-strip-types scripts/test-day-slots.mjs
import {
  baseDayName,
  buildDaySlots,
  dueVariant,
  siblingVariant,
} from '../src/lib/daySlots.ts';

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

const mkDay = (id, name, week, reference = false, position = 0) => ({
  id,
  plan_id: 'p',
  name,
  position,
  week_index: week,
  reference_only: reference,
  plan_exercises: [],
});

// The real plan's shape: two weeks of Legs/Push/Pull/Upper plus a home abs day.
const days = [
  mkDay('l1', 'Legs 1', 1, false, 0),
  mkDay('p1', 'Push 1', 1, false, 1),
  mkDay('pl1', 'Pull 1', 1, false, 2),
  mkDay('u1', 'Upper 1', 1, false, 3),
  mkDay('l2', 'Legs 2', 2, false, 4),
  mkDay('p2', 'Push 2', 2, false, 5),
  mkDay('pl2', 'Pull 2', 2, false, 6),
  mkDay('u2', 'Upper 2', 2, false, 7),
  mkDay('abs', 'Abs', null, true, 8),
];
const slots = buildDaySlots(days);
const slot = (name) => slots.find((s) => s.name === name);

console.log('\n=== names and grouping ===');
check('rotation number stripped', baseDayName('Legs 2'), 'Legs');
check('plain names untouched', baseDayName('Push'), 'Push');
check('card order', slots.map((s) => s.name), ['Legs', 'Push', 'Pull', 'Abs', 'Upper']);
check('both weeks fold into one slot', slot('Legs').variants.map((v) => v.id), ['l1', 'l2']);
check('abs is a single-variant slot', slot('Abs').variants.length, 1);

console.log('\n=== which version a card opens ===');
const done = (entries) => new Map(entries);
check('never trained → week 1', dueVariant(slot('Legs'), done([])).id, 'l1');
check(
  'week 1 done → week 2',
  dueVariant(slot('Legs'), done([['l1', '2026-08-24T10:00:00Z']])).id,
  'l2'
);
check(
  'both done → the older one',
  dueVariant(
    slot('Legs'),
    done([
      ['l1', '2026-08-17T10:00:00Z'],
      ['l2', '2026-08-24T10:00:00Z'],
    ])
  ).id,
  'l1'
);
check(
  'slots alternate independently',
  dueVariant(slot('Upper'), done([['l1', '2026-08-24T10:00:00Z']])).id,
  'u1'
);
check(
  'sibling is the other week',
  siblingVariant(slot('Legs'), slot('Legs').variants[0]).id,
  'l2'
);
check('a single-variant slot has no sibling', siblingVariant(slot('Abs'), slot('Abs').variants[0]), null);

console.log('\n=== a plan that does not rotate ===');
const flat = buildDaySlots([
  mkDay('a', 'Push', null, false, 0),
  mkDay('b', 'Pull', null, false, 1),
  mkDay('c', 'Legs', null, false, 2),
]);
check('one slot per day, plan order kept', flat.map((s) => s.name), ['Push', 'Pull', 'Legs']);
check('due is simply that day', dueVariant(flat[0], done([])).id, 'a');

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exitCode = failures === 0 ? 0 : 1;
