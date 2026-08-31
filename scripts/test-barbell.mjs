// Tests for the barbell calculator's maths: what a loaded bar weighs, and what
// tapping a plate, a chip, or a plate already on the bar does to the stack.
// Usage: npm test  —  or: node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/test-barbell.mjs
import {
  addPlate,
  groupPlates,
  removeOneOfSize,
  removePlateAt,
  setQuantityOfSize,
  totalKg,
} from '../src/lib/barbell.ts';

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

console.log('\n=== what the bar weighs ===');
check('a bare bar is just the bar', totalKg(20, []), { oneSide: 0, total: 20 });
check('plates count on both sides', totalKg(20, [20, 10]), { oneSide: 30, total: 80 });
check('no bar means plates only', totalKg(0, [25, 25]), { oneSide: 50, total: 100 });
check('half plates keep their halves', totalKg(20, [1.25, 0.5]), {
  oneSide: 1.75,
  total: 23.5,
});
// A 25kg Olympic bar under 25/20/20/2.5 a side — the load in the walkthrough.
check('the worked example', totalKg(25, [25, 20, 20, 2.5]), {
  oneSide: 67.5,
  total: 160,
});

console.log('\n=== adding plates ===');
check('first plate', addPlate([], 20), [20]);
check('heaviest sits innermost whatever the tap order', addPlate(addPlate([10], 25), 20), [
  25, 20, 10,
]);
check('duplicates are kept, not merged', addPlate([20], 20), [20, 20]);
check('adding does not mutate the original', (() => {
  const before = [20];
  addPlate(before, 10);
  return before;
})(), [20]);

console.log('\n=== removing by position on the bar ===');
check('takes the plate you tapped', removePlateAt([25, 20, 20, 2.5], 0), [20, 20, 2.5]);
check('an inner duplicate leaves the other', removePlateAt([20, 20], 1), [20]);
check('an index past the end changes nothing', removePlateAt([20, 10], 5), [20, 10]);
// Regression: tapping one plate must not clear every plate of that size.
check('removes one plate, not every plate of that size', removePlateAt([20, 20, 20], 0), [
  20, 20,
]);

console.log('\n=== removing by size (tapping a chip) ===');
check('drops a single plate of that size', removeOneOfSize([25, 20, 20], 20), [25, 20]);
check('a size that is not loaded is a no-op', removeOneOfSize([25], 10), [25]);
check('the last of a size empties it', removeOneOfSize([5], 5), []);

console.log('\n=== setting a quantity ===');
check('raises a count', setQuantityOfSize([25], 20, 3), [25, 20, 20, 20]);
check('lowers a count', setQuantityOfSize([20, 20, 20], 20, 1), [20]);
check('zero clears that size and keeps the rest', setQuantityOfSize([25, 20, 20], 20, 0), [25]);
check('the result stays heaviest first', setQuantityOfSize([10], 25, 2), [25, 25, 10]);

console.log('\n=== the chip list ===');
check('counts each size, heaviest first', groupPlates([20, 25, 20, 2.5]), [
  { kg: 25, count: 1 },
  { kg: 20, count: 2 },
  { kg: 2.5, count: 1 },
]);
check('an empty bar lists nothing', groupPlates([]), []);

console.log('\n=== the walkthrough, tap by tap ===');
// Mirrors the six taps the calculator was screenshotted through, against a
// 25kg Olympic bar.
let plates = [];
plates = addPlate(plates, 25);
check('tap 25', totalKg(25, plates).total, 75);
plates = addPlate(plates, 20);
check('tap 20', totalKg(25, plates).total, 115);
plates = addPlate(plates, 20);
check('tap 20 again', totalKg(25, plates).total, 155);
check('  chip reads 20 x 2', groupPlates(plates)[1], { kg: 20, count: 2 });
plates = addPlate(plates, 2.5);
check('tap 2.5', totalKg(25, plates).total, 160);
plates = removePlateAt(plates, 0);
check('tap the 25 on the bar', totalKg(25, plates).total, 110);
check('  leaving 20 x 2 and 2.5 x 1', groupPlates(plates), [
  { kg: 20, count: 2 },
  { kg: 2.5, count: 1 },
]);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exitCode = failures === 0 ? 0 : 1;
