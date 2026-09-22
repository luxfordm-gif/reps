// Tests the day-name → photo lookup: which spellings of a training day find
// their picture, and which correctly fall back to a letter tile.
// Usage: npm test  —  or: node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/test-day-images.mjs
import { imageForDay } from '../src/lib/dayImages.ts';

let failures = 0;
function has(label, dayName) {
  const got = imageForDay(dayName);
  if (got) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}\n      "${dayName}" found no photo`);
  }
}
function same(label, a, b) {
  const x = imageForDay(a);
  const y = imageForDay(b);
  if (x && x === y) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}\n      "${a}" and "${b}" gave ${x} / ${y}`);
  }
}
function none(label, dayName) {
  if (imageForDay(dayName) === null) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}\n      "${dayName}" unexpectedly matched`);
  }
}

console.log('\n=== every day in the library ===');
for (const day of [
  'Legs', 'Chest', 'Back', 'Shoulders', 'Arms',
  'Abs', 'Upper', 'Lower', 'Push', 'Pull', 'Full Body', 'Mobility',
]) {
  has(day, day);
}

console.log('\n=== however it was typed ===');
same('lower case', 'legs', 'Legs');
same('shouting', 'LEGS', 'Legs');
same('stray spaces', '  Legs  ', 'Legs');
has('a rotating day', 'Legs 2');
has('a rotating day with no space', 'Legs2');
same('rotation number ignored', 'Legs 2', 'Legs');
same('week numbers on other days too', 'Push 3', 'Push');

console.log('\n=== the same day by another name ===');
same('core is abs', 'Core', 'Abs');
same('abs / core, spaced', 'Abs / Core', 'Abs');
same('abs/core, unspaced', 'Abs/Core', 'Abs');
same('biceps live on arms day', 'Biceps', 'Arms');
same('triceps too', 'Triceps', 'Arms');
same('delts are shoulders', 'Delts', 'Shoulders');
same('upper body', 'Upper Body', 'Upper');
same('lower body', 'Lower Body', 'Lower');
same('hyphenated full-body', 'Full-Body', 'Full Body');
same('run-together fullbody', 'Fullbody', 'Full Body');
same('leg day', 'Leg Day', 'Legs');
same('stretching is mobility', 'Stretching', 'Mobility');
same('so is a stretch day', 'Stretch', 'Mobility');
same('and flexibility', 'Flexibility', 'Mobility');
same('active recovery', 'Active Recovery', 'Mobility');
same('yoga', 'Yoga', 'Mobility');

console.log('\n=== two muscle groups in one heading ===');
// The day this came from: a letter tile where the back photo should have been.
same('back / rear delt takes the back photo', 'Back / Rear Delt', 'Back');
same('unspaced too', 'Back/Rear Delt', 'Back');
same('chest + triceps is a chest day', 'Chest + Triceps', 'Chest');
same('legs and abs is a leg day', 'Legs and Abs', 'Legs');
same('comma separated', 'Shoulders, Arms', 'Shoulders');
same('the first half we know wins', 'Quads / Calves', 'Legs');
// Neither half is a day we have a photo for, so it still falls back.
none('neither half known', 'Cardio / Conditioning');

console.log('\n=== and the ones we still have no picture for ===');
none('a day name we have never seen', 'Cardio');
// A rest day is not a stretching session — better a letter than a wrong photo.
none('a rest day is not mobility', 'Rest Day');
none('empty', '');
none('a number on its own', '3');

console.log(failures === 0 ? '\nAll passed.\n' : `\n${failures} failed.\n`);
process.exit(failures === 0 ? 0 : 1);
