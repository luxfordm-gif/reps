// Tests for repairing an import on the review screen: the parser keeping rows
// it found before any day, the lenient guess from an unreadable line, position
// renumbering after edits, and what blocks a save.
// Usage: npm test  —  or: node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/test-repair.mjs
import { parseTrainingPlan } from '../src/lib/parseTrainingPlan.ts';
import {
  buildExercise,
  guessDraftFromText,
  newDay,
  normalizePositions,
  normalizeTempo,
  planProblems,
  splitUnparsed,
  withUids,
} from '../src/lib/planRepair.ts';

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

const HDR = 'BODY PART EXERCISE TOTAL SETS RANGE REP TEMPO NOTES';

console.log('\n=== a day title the parser has never seen is still read ===');
{
  // "DAY 1 - CHEST" is in no list of day names, and no column header follows it
  // to give it away structurally. Layout recognition takes it as a day anyway,
  // because two exercise rows sit directly beneath it. Its rows used to be
  // surfaced as orphans for the user to re-key by hand.
  const r = parseTrainingPlan(`
WEEKS VOLUME
CHEST 7
DAY 1 - CHEST
CHEST FLAT BENCH PRESS 3 8-10 2 0 1 0
CHEST INCLINE DB PRESS 3 10-12 2 0 1 0
PUSH
${HDR}
SHOULDERS LATERAL RAISE 3 12-15 2 0 1 0
`);
  check('both titles become days', r.days.map((d) => d.name), ['Day 1 - Chest', 'Push']);
  check('with their rows under them', r.days.map((d) => d.exercises.length), [2, 1]);
  check(
    'the body part is read off the front even with no header row',
    r.days[0].exercises.map((e) => `${e.bodyPart}/${e.name}`),
    ['Chest/Flat bench press', 'Chest/Incline DB press']
  );
  check('and a trailing tempo is a tempo, not a note', r.days[0].exercises[0].tempo, '2-0-1-0');
  check('nothing is left unread', r.unparsedLines, []);
}
{
  // Rows with no day header anywhere still can't be filed, so they stay
  // rescuable rather than being invented a day.
  const r = parseTrainingPlan(`
Barbell Bench Press 4 8-10 90s
Incline Dumbbell Press 4 10-12 90s
`);
  check('rows under no day at all are kept', r.unparsedLines, [
    '[No day] Barbell Bench Press 4 8-10 90s',
    '[No day] Incline Dumbbell Press 4 10-12 90s',
  ]);
}
{
  const r = parseTrainingPlan(`
WEEKS VOLUME
CHEST 7
BACK 15
PUSH
${HDR}
SHOULDERS LATERAL RAISE 3 12-15 2 0 1 0
`);
  check('a volume table is not mistaken for orphan rows', r.unparsedLines, []);
}

console.log('\n=== a row missing a column is read, not surfaced for repair ===');
{
  const r = parseTrainingPlan(`
PUSH
${HDR}
CHEST FLAT BENCH PRESS 3 8-10 2 0 1 0
CHEST CABLE FLY 3 12-15
1 X 8-10 REPS / 1 12-15 REPS BACK OFF
Optional intensifier for set 3 slow eccentric
`);
  const ex = r.days[0].exercises;
  // The cable fly has no tempo. That used to fail the row outright; a blank
  // trimming column is now just a blank column.
  check('both rows are rows', ex.map((e) => e.name), ['Flat bench press', 'Cable fly']);
  check('the complete row keeps its tempo', ex[0].tempo, '2-0-1-0');
  check('the incomplete one has none', ex[1].tempo, null);
  check('and nothing needs repairing', r.unparsedLines, []);
  check(
    'note continuations attach to the row they follow',
    ex[1].notes,
    '1 X 8-10 reps / 1 12-15 reps back off optional intensifier for set 3 slow eccentric'
  );
}

console.log('\n=== splitting an unparsed line ===');
check('day tag', splitUnparsed('[Legs 1] QUADS ADDUCTOR 2 6-8'), {
  dayName: 'Legs 1',
  text: 'QUADS ADDUCTOR 2 6-8',
  raw: '[Legs 1] QUADS ADDUCTOR 2 6-8',
});
check('no-day tag reads as null', splitUnparsed('[No day] CHEST FLY 3 12').dayName, null);

console.log('\n=== guessing an exercise from a line the parser rejected ===');
{
  const g = guessDraftFromText('QUADS ADDUCTOR 2 6-8');
  check('body part', g.bodyPart, 'Quads');
  check('name', g.name, 'Adductor');
  check('sets', g.totalSets, 2);
  check('reps', g.repRange, '6-8');
  check('no tempo → null', g.tempo, null);
}
{
  const g = guessDraftFromText('FLAT BENCH PRESS 3 8-10 2 0 1 0');
  check('no body part column', g.bodyPart, '');
  check('name without body part', g.name, 'Flat bench press');
  check('tempo with spaces', g.tempo, '2-0-1-0');
}
{
  const g = guessDraftFromText('GLUTES/HAMS BELT SQUAT RDL 2 6-8 2-1-1-0 Set 2: cluster set');
  check('slash body part', g.bodyPart, 'Glutes/hams');
  check('hyphenated tempo', g.tempo, '2-1-1-0');
  check('the rest is notes', g.notes, 'Set 2: cluster set');
}
{
  const g = guessDraftFromText('SEATED ROW 4 Failure');
  check('failure rep range', g.repRange, 'Failure');
  check('sets still read', g.totalSets, 4);
}
{
  const g = guessDraftFromText('Some coach note with no numbers');
  check('a plain sentence is all name', g.name, 'Some coach note with no numbers');
  check('and no sets', g.totalSets, null);
}

console.log('\n=== tempo normalisation ===');
check('spaces', normalizeTempo('2 0 1 0'), '2-0-1-0');
check('digits only', normalizeTempo('2010'), '2-0-1-0');
check('already hyphenated', normalizeTempo('2-0-1-0'), '2-0-1-0');
check('empty → null', normalizeTempo(''), null);
check('free text passes through', normalizeTempo('slow'), 'slow');

console.log('\n=== building an exercise from a draft ===');
{
  const e = buildExercise({
    bodyPart: 'Chest',
    name: 'Incline bench press',
    totalSets: 3,
    repRange: '8-10',
    tempo: '2010',
    notes: 'Dropset on the last set',
  });
  check('gets an identity', typeof e.uid, 'string');
  check('normalised name', e.normalizedName, 'incline bench press');
  check('tempo normalised', e.tempo, '2-0-1-0');
  check('scheme detected from notes', e.setScheme, 'dropset');
  check('tempo present → not uncertain', e.tempoUncertain, false);
}
{
  const base = buildExercise({ bodyPart: 'Back', name: 'Lat pulldown', totalSets: 3, repRange: '10', tempo: null, notes: '' });
  base.normalizedName = 'confirmed identity';
  base.supersetGroup = 4;
  const same = buildExercise({ ...base, notes: 'Slow eccentric' }, base);
  check('same name keeps a confirmed identity', same.normalizedName, 'confirmed identity');
  check('and its superset group', same.supersetGroup, 4);
  check('and its uid', same.uid, base.uid);
  const renamed = buildExercise({ ...base, name: 'Neutral grip pulldown' }, base);
  check('a new name is a new identity', renamed.normalizedName, 'neutral grip pulldown');
}

console.log('\n=== positions after edits ===');
{
  const plan = withUids(parseTrainingPlan(`
PUSH
${HDR}
CHEST FLAT BENCH PRESS 3 8-10 2 0 1 0
CHEST INCLINE DB PRESS 3 10-12 2 0 1 0
SHOULDERS LATERAL RAISE 3 12-15 2 0 1 0
`));
  check('every exercise has a uid', plan.days[0].exercises.every((e) => typeof e.uid === 'string'), true);
  check('withUids is idempotent', withUids(plan).days[0].exercises.map((e) => e.uid), plan.days[0].exercises.map((e) => e.uid));
  // Delete the middle row and add a day in front.
  const edited = {
    ...plan,
    days: [newDay('Legs', 1, 99), { ...plan.days[0], exercises: plan.days[0].exercises.filter((_, i) => i !== 1) }],
  };
  const fixed = normalizePositions(edited);
  check('days renumbered', fixed.days.map((d) => d.position), [0, 1]);
  check('exercises renumbered contiguously', fixed.days[1].exercises.map((e) => e.position), [0, 1]);
}

console.log('\n=== what blocks a save ===');
{
  check('no days', planProblems({ days: [], warnings: [], unparsedLines: [] }), [
    'No training days. Add a day, or upload a different PDF.',
  ]);
  const empty = { days: [newDay('Legs', null, 0)], warnings: [], unparsedLines: [] };
  check('an empty day', planProblems(empty), ['"Legs" has no exercises — add some or remove the day.']);
  const ok = withUids(parseTrainingPlan(`
PUSH
${HDR}
CHEST FLAT BENCH PRESS 3 8-10 2 0 1 0
`));
  check('a real plan is fine', planProblems(ok), []);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
