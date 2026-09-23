// Tying an uploaded row to a machine already in the history: exact names,
// misspellings, near misses, and the ones that should stay strangers.
// Usage: npm test  —  or: node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/test-machine-match.mjs
import {
  carriesHistory,
  computeMatch,
  isAnswerable,
} from '../src/lib/machineMatch.ts';
import { normalizeExerciseName } from '../src/lib/normalizeExerciseName.ts';
import {
  composeName,
  editedName,
  exerciseKey,
  rememberBrands,
  resetCustomBrands,
  splitBrand,
} from '../src/lib/exerciseBrand.ts';
import { parseTrainingPlan } from '../src/lib/parseTrainingPlan.ts';
import { FORMAT_A_TEXT } from './fixtures/plans/trainer-formats.mjs';
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

console.log('\n=== a machine brand, split from the movement ===');
{
  check('brand first', splitBrand('Prime pec deck fly'), { movement: 'Pec deck fly', brand: 'Prime' });
  check('brand last', splitBrand('Reverse pec deck prime'), { movement: 'Reverse pec deck', brand: 'Prime' });
  check(
    'a two-word brand at the end',
    splitBrand('Single arm underhand row machine hammer strength'),
    { movement: 'Single arm underhand row machine', brand: 'Hammer Strength' },
  );
  check('"hammer" alone is a curl, not a brand', splitBrand('Rope hammer curl').brand, null);
  check('nor at the start', splitBrand('Hammer curl').brand, null);
  check('a brand inside a word is not a brand', splitBrand('Primer press').brand, null);
  check('a brand on its own stays a name', splitBrand('Prime'), { movement: 'Prime', brand: null });
  check('no brand, name unchanged', splitBrand('Lat pulldown'), { movement: 'Lat pulldown', brand: null });

  check('joined with the brand first', composeName('Chest press', 'Prime'), 'Prime chest press');
  check('a blank brand leaves the movement', composeName('Chest press', '  '), 'Chest press');
  check('capitals in an abbreviation survive', composeName('EZ bar curl', 'Cybex'), 'Cybex EZ bar curl');
  check('the key carries the brand', exerciseKey('Chest press', 'Prime'), 'prime chest press');
  check(
    'and so a branded machine never takes the generic one\'s key',
    exerciseKey('Chest press', 'Prime') === exerciseKey('Chest press', ''),
    false,
  );

  check(
    'an untouched edit keeps a brand-last name as it was',
    editedName('Reverse pec deck prime', 'Reverse pec deck', 'Prime'),
    'Reverse pec deck prime',
  );
  check(
    'a changed brand is put on the front',
    editedName('Reverse pec deck prime', 'Reverse pec deck', 'Cybex'),
    'Cybex reverse pec deck',
  );
  check('adding a brand to a plain name', editedName('Chest press', 'Chest press', 'Prime'), 'Prime chest press');
  check('clearing the movement leaves nothing', editedName('Chest press', ' ', 'Prime'), '');

  check('an unknown brand stays in the name', splitBrand('Kraftwerk chest press').brand, null);
  rememberBrands(['Kraftwerk']);
  check('until it has been typed as one', splitBrand('Kraftwerk chest press'), {
    movement: 'Chest press',
    brand: 'Kraftwerk',
  });
  resetCustomBrands();
}

console.log('\n=== the machine catalogue ===');
{
  check('an old American line shows with its maker', splitBrand('Cybex eagle leg extension'), {
    movement: 'Leg extension',
    brand: 'Cybex Eagle',
  });
  check('a line at the end too', splitBrand('Seated row nautilus nitro'), {
    movement: 'Seated row',
    brand: 'Nautilus Nitro',
  });
  check('an alias is shown as the maker writes it', splitBrand('Bodymaster pec deck').brand, 'Body Masters');
  check('as is a two-word maker', splitBrand('Flex fitness chest press').brand, 'Flex Fitness');
  check('"Flex" on the front is the maker', splitBrand('Flex leg curl').brand, 'Flex Fitness');
  check('but not at the end, where it is a word', splitBrand('Hip flex').brand, null);
  check(
    'a word after the maker that is not a line stays in the movement',
    splitBrand('Nautilus one arm row'),
    { movement: 'One arm row', brand: 'Nautilus' },
  );
  check('the plate-loaded brand hardcore gyms buy', splitBrand('Arsenal reloaded hack squat'), {
    movement: 'Hack squat',
    brand: 'Arsenal Strength Reloaded',
  });
  check('a cardio name is the exercise, not a brand', splitBrand('Assault bike').brand, null);
  check('a brand after a comma', splitBrand('Cable shoulder press, Nautilus'), {
    movement: 'Cable shoulder press',
    brand: 'Nautilus',
  });
  check('even a front-only maker, when the comma sets it off', splitBrand('Cable shoulder press, flex'), {
    movement: 'Cable shoulder press',
    brand: 'Flex Fitness',
  });
  check('a brand before a comma', splitBrand('Flex, Dip machine'), {
    movement: 'Dip machine',
    brand: 'Flex Fitness',
  });
  check('a note after a comma stays in the movement', splitBrand('JM press, smith machine').brand, null);
  check('a comma note after a brand at the front', splitBrand('Hammer strength incline, plate'), {
    movement: 'Incline, plate',
    brand: 'Hammer Strength',
  });
  check('the Dorian Yates row', splitBrand('Hammer strength dy underhand row'), {
    movement: 'Underhand row',
    brand: 'Hammer Strength DY',
  });
  check('an original Cybex', splitBrand('Cybex og leg press'), { movement: 'Leg press', brand: 'Cybex OG' });
  check('a maker in the middle', splitBrand('Incline gymleco lying fly machine'), {
    movement: 'Incline lying fly machine',
    brand: 'Gymleco',
  });
  check('makers from a real coach\'s plan', [
    splitBrand('Teca lateral raise'),
    splitBrand('Mfg high wide row'),
    splitBrand('Granite weighted hyperextension'),
  ], [
    { movement: 'Lateral raise', brand: 'Teca' },
    { movement: 'High wide row', brand: 'MFG' },
    { movement: 'Weighted hyperextension', brand: 'Granite' },
  ]);
  check('a brand in the middle of the name', splitBrand('Single arm hammer strength pulldown'), {
    movement: 'Single arm pulldown',
    brand: 'Hammer Strength',
  });
  check('with its line', splitBrand('Seated cybex eagle leg curl'), {
    movement: 'Seated leg curl',
    brand: 'Cybex Eagle',
  });
  check('a front-only maker is not taken from the middle', splitBrand('Hip flex stretch').brand, null);
  check('"hammer" in the middle is still a curl', splitBrand('Cable hammer curl').brand, null);
  check('a pendulum squat is a movement', splitBrand('Pendulum squat').brand, null);
}
{
  // A real coach's plan: brands at either end, and a rope hammer curl.
  const parsed = parseTrainingPlan(FORMAT_A_TEXT).days.flatMap((d) => d.exercises);
  const byKey = new Map(parsed.map((e) => [e.normalizedName, e]));
  const split = (key) => splitBrand(byKey.get(key)?.name ?? '');
  check('a parsed brand-first name splits', split('prime pec deck fly'), {
    movement: 'Pec deck fly',
    brand: 'Prime',
  });
  check('a parsed brand-last name splits', split('reverse pec deck prime'), {
    movement: 'Reverse pec deck',
    brand: 'Prime',
  });
  check('the parsed key still carries the brand', byKey.has('prime pec deck fly'), true);
  check('the rope hammer curl has no brand', split('rope hammer curl').brand, null);
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
