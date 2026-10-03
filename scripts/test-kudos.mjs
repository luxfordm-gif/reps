// Tests the card under the sets on the exercise screen: which improvement it
// leads with, and what it says underneath.
// Usage: npm test  —  or: node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/test-kudos.mjs
import { buildKudos } from '../src/lib/kudos.ts';

let failures = 0;
function eq(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) console.log(`  ✓ ${label}`);
  else { failures += 1; console.log(`  ✗ ${label}\n      got  ${g}\n      want ${w}`); }
}
function ok(label, cond, detail = '') {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures += 1; console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`); }
}

const now = (rows) => rows.map(([weight, reps], i) => ({
  setIndex: i + 1, dropIndex: 0, weight: String(weight), reps: String(reps), completed: true,
}));
const last = (rows) => rows.map(([weight, reps], i) => ({ set_index: i + 1, drop_index: 0, weight, reps }));
const kudos = (thisRows, lastRows, repRange = '6-8', seed = 's1') =>
  buildKudos({ thisSets: now(thisRows), lastSets: last(lastRows), repRange, seed });

console.log('\nheavier top set and more reps on another set');
{
  const k = kudos([[47.5, 5], [40, 10]], [[45, 8], [40, 8]]);
  ok('leads with the weight', k.headline.includes('2.5 kg'), k.headline);
  eq('names the set that gained reps', k.detail, 'Also +2 reps on set 2.');
}
{
  const k = kudos([[50, 6], [45, 9], [40, 11]], [[47.5, 8], [45, 8], [40, 10]]);
  eq('adds up gains across sets', k.detail, 'Also +2 reps across 2 sets.');
}

console.log('\nheavier top set, reps only dropped');
{
  const k = kudos([[47.5, 5], [40, 8]], [[45, 8], [40, 8]]);
  ok('softens the drop', /reps|Reps/.test(k.detail ?? '') && !k.detail.startsWith('Also'), k.detail);
}

console.log('\nreps up at the same weight');
{
  const k = kudos([[40, 8], [40, 10]], [[40, 8], [40, 8]]);
  ok('leads with the reps', k.headline.includes('2'), k.headline);
  eq('names the set', k.detail, 'Extra reps on set 2.');
}

console.log('\nmore reps on a lighter set is not a rep gain');
{
  const k = kudos([[40, 8], [35, 10]], [[40, 8], [40, 8]]);
  ok('does not claim extra reps', !/rep/i.test(k.headline), k.headline);
}

if (failures) { console.log(`\n${failures} failing`); process.exit(1); }
console.log('\nall passing');
