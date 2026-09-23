// Tying an uploaded row to a machine already in the history: exact names,
// misspellings, near misses, and the ones that should stay strangers.
// Usage: npm test  —  or: node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/test-machine-match.mjs
import {
  carriesHistory,
  computeMatch,
  isAnswerable,
} from '../src/lib/machineMatch.ts';
import { normalizeExerciseName } from '../src/lib/normalizeExerciseName.ts';
import { filterExercisesByQuery } from '../src/lib/exerciseSearch.ts';

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

const machine = (name, setCount = 10) => ({
  name,
  normalizedName: normalizeExerciseName(name),
  setCount,
});
const row = (name) => ({ name, normalizedName: normalizeExerciseName(name) });

const HISTORY = [
  machine('Deadlift', 40),
  machine('Barbell bench press', 30),
  machine('Incline dumbbell press', 20),
  machine('Seated cable row', 15),
  machine('Leg press', 25),
  machine('Prime pec deck fly', 12),
];

console.log('\n=== a name already on record needs no asking ===');
{
  const m = computeMatch(row('Deadlift'), HISTORY);
  check('kind', m.kind, 'exact');
  check('settled straight away', m.decision, 'same');
  check('and carries its history', carriesHistory(m), true);
  check('casing and spacing are not a difference', computeMatch(row('  DEADLIFT  '), HISTORY).kind, 'exact');
}

console.log('\n=== a misspelling is caught, not treated as a new machine ===');
{
  // This is the case word overlap cannot see: "dedlift" and "deadlift" share no
  // whole word, so the old matcher scored them zero and silently started the
  // machine from scratch.
  const m = computeMatch(row('Dedlift'), HISTORY);
  check('kind', m.kind, 'typo');
  check('points at the right machine', m.candidate?.name, 'Deadlift');
  check('but waits to be told', m.decision, 'pending');
  check('so it carries nothing yet', carriesHistory(m), false);
  check('and it is a question we put to the user', isAnswerable(m), true);
}
{
  const m = computeMatch(row('Barbel benche press'), HISTORY);
  check('two typos in one name still match', m.kind, 'typo');
  check('candidate', m.candidate?.name, 'Barbell bench press');
}
{
  const m = computeMatch(row('Leg pres'), HISTORY);
  check('a dropped letter', m.kind, 'typo');
  check('candidate', m.candidate?.name, 'Leg press');
}

console.log('\n=== answering is what carries the history ===');
{
  const m = computeMatch(row('Dedlift'), HISTORY);
  check('confirmed', carriesHistory({ ...m, decision: 'same' }), true);
  check('rejected', carriesHistory({ ...m, decision: 'different' }), false);
  // An unanswered question must not quietly adopt the other machine's numbers.
  check('left unanswered', carriesHistory(m), false);
}

console.log('\n=== a near miss is a question, not a correction ===');
{
  const m = computeMatch(row('Incline DB press'), HISTORY);
  check('kind', m.kind, 'fuzzy');
  check('candidate', m.candidate?.name, 'Incline dumbbell press');
  check('pending', m.decision, 'pending');
}
{
  // One name inside another: likelier than not the same machine, but the plan's
  // wording may be deliberate, so it is asked rather than corrected.
  const m = computeMatch(row('Cable row'), HISTORY);
  check('a shorter form of a name on record', m.kind, 'fuzzy');
  check('candidate', m.candidate?.name, 'Seated cable row');
}

console.log('\n=== different machines stay different ===');
{
  check('leg curl is not leg press', computeMatch(row('Leg curl'), HISTORY).kind, 'none');
  check('nor is a machine nobody has trained', computeMatch(row('Hack squat'), HISTORY).kind, 'none');
  check('no history, nothing to match', computeMatch(row('Deadlift'), []).kind, 'none');
}
{
  // A gym-brand machine keeps its brand: matching it to the generic name would
  // merge two machines that load completely differently.
  const m = computeMatch(row('Pec deck'), HISTORY);
  check('a brand machine is not the generic one', m.kind !== 'exact', true);
  check('and nothing is decided for the user', m.decision, 'pending');
}

console.log('\n=== the better-used machine wins a tie ===');
{
  const tied = [machine('Cable fly high', 2), machine('Cable fly low', 30)];
  const m = computeMatch(row('Cable fly seated'), tied);
  check('kind', m.kind, 'fuzzy');
  check('candidate', m.candidate?.name, 'Cable fly low');
}

console.log('\n=== searching the list of machines ===');
{
  const names = HISTORY.map((m) => m.name);
  const search = (q) => filterExercisesByQuery(names, q, (n) => n);
  check('an empty search keeps the whole list', search('   ').length, names.length);
  check('matches part of a name, any case', search('BENCH'), ['Barbell bench press']);
  check('every word counts, in any order', search('press incline'), ['Incline dumbbell press']);
  check('a shared word finds each machine', search('press'), [
    'Barbell bench press',
    'Incline dumbbell press',
    'Leg press',
  ]);
  check('extra spaces are ignored', search('  leg   press '), ['Leg press']);
  check('nothing matches, nothing shown', search('squat'), []);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
if (failures > 0) process.exit(1);
