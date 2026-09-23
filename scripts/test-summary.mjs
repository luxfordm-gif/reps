// Tests the written summaries: the line on the finish screen and the week card
// on Performance. What each says for a given set of facts, and the voice every
// template has to keep whatever the facts are.
// Usage: npm test  —  or: node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/test-summary.mjs
import { buildWeekFacts, comparisonLabel, count, mid, sessionLine, weekLine } from '../src/lib/summary.ts';

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

const kg = (n) => `${Number.isInteger(n) ? n : n.toFixed(1)} kg`;
const opts = (seed = 's1') => ({ seed, weight: kg });

const base = {
  dayName: 'Push 1',
  setsLogged: 18,
  durationMinutes: 52,
  totalKg: 6420,
  previousTotalKg: 5940,
  bests: [
    { exercise: 'Incline DB press', kg: 32.5, reps: 8, previousBestKg: 30 },
    { exercise: 'Cable fly', kg: 15, reps: 12, previousBestKg: 15 },
    { exercise: 'Dip', kg: 10, reps: 10, previousBestKg: null },
  ],
};

/** Every phrasing a template has, by trying enough seeds to land on each. */
function allLines(fn, facts) {
  const out = new Set();
  for (let i = 0; i < 200; i++) {
    const line = fn(facts, opts(`seed-${i}`));
    if (line) out.add(line);
  }
  return [...out];
}

console.log('\n=== the finish screen leads with what changed ===');
{
  const line = sessionLine(base, opts());
  ok('a new best comes first', /incline DB press/.test(line.split('. ')[0]), line);
  ok('and names the weight', line.includes('32.5 kg'), line);
  ok('volume is the second thing said', /8% more|up 8%|8% more weight/.test(line), line);
  ok('a matched best is not called new', !/cable fly/i.test(line), line);
  ok('a first attempt is not called a best', !/dip/i.test(line), line);
}
{
  const two = { ...base, bests: [base.bests[0], { exercise: 'Cable fly', kg: 17.5, reps: 10, previousBestKg: 15 }] };
  const lines = allLines(sessionLine, two);
  ok('two new bests are named together', lines.every((l) => /incline DB press/.test(l) && /cable fly/.test(l)), lines.join(' | '));
}
{
  const many = {
    ...base,
    bests: ['A', 'B', 'C', 'D'].map((n, i) => ({ exercise: `Press ${n}`, kg: 50 - i, reps: 5, previousBestKg: 40 })),
  };
  const lines = allLines(sessionLine, many);
  ok('several are counted in words', lines.every((l) => /four new bests|on four lifts/i.test(l)), lines.join(' | '));
}
{
  const first = { ...base, previousTotalKg: null, bests: base.bests.map((b) => ({ ...b, previousBestKg: null })) };
  const line = sessionLine(first, opts());
  ok('a first session says so', /first Push 1 session/i.test(line), line);
}
{
  const offline = { ...base, previousTotalKg: undefined, bests: base.bests.map((b) => ({ ...b, previousBestKg: undefined })) };
  const line = sessionLine(offline, opts());
  ok('offline, nothing is claimed that needs history', !/best|first|volume/i.test(line), line);
  ok('it falls back on what was done', /18 sets/.test(line), line);
}
{
  const lighter = { ...base, totalKg: 4000, bests: [] };
  ok('a lighter session is stated, not dressed up', /less volume|under your last/.test(sessionLine(lighter, opts())), sessionLine(lighter, opts()));
  const same = { ...base, totalKg: 6000, bests: [] };
  ok('within noise reads as level', /level with|same volume/.test(sessionLine(same, opts())), sessionLine(same, opts()));
}
eq('nothing logged, nothing said', sessionLine({ ...base, setsLogged: 0 }, opts()), null);
eq('the same session always reads the same', sessionLine(base, opts('abc')), sessionLine(base, opts('abc')));

console.log('\n=== exercise names mid-sentence ===');
eq('the first letter comes down', mid('Cable fly'), 'cable fly');
eq('an abbreviation stays up', mid('DB row'), 'DB row');
eq('so does EZ', mid('EZ bar curl'), 'EZ bar curl');
eq('a single capital letter isn’t an abbreviation', mid('T-bar row'), 't-bar row');
eq('small counts as words', [count(3), count(12), count(13)], ['three', 'twelve', '13']);

console.log('\n=== the week card ===');
const week = {
  which: 'this',
  weekStart: '2026-09-14',
  workouts: 3,
  target: 4,
  streak: 0,
  weekIndex: 2,
  comparison: {
    weekIndex: 2,
    weeksBack: 2,
    workouts: 3,
    previousWorkouts: 3,
    volumeKg: 11200,
    previousVolumeKg: 10000,
    topMover: { name: 'Bench press', deltaKg: 2.5, currentKg: 82.5, currentReps: 6, previousReps: 6 },
    lifts: 6,
    heavier: 4,
    lighter: 1,
  },
};
{
  const line = weekLine(week, opts());
  ok('the count comes first', /^Three (of four workouts so far|workouts of four done)/.test(line), line);
  ok('volume against the same rotation week', line.includes('12%') && line.includes('the last time you ran week 2'), line);
  ok('then the lift that moved most', /bench press/i.test(line) && line.includes('2.5 kg'), line);
  eq('the header says what it’s against', comparisonLabel(week), 'vs week 2 last time');
}
{
  const behind = { ...week, comparison: { ...week.comparison, workouts: 2 } };
  ok('a week still behind on workouts isn’t compared on volume', !/volume/.test(weekLine(behind, opts())), weekLine(behind, opts()));
}
{
  const flat = { ...week, weekIndex: null, comparison: { ...week.comparison, weekIndex: null, weeksBack: 1 } };
  eq('a plan that doesn’t rotate compares with last week', comparisonLabel(flat), 'vs last week');
  ok('and says so', weekLine(flat, opts()).includes('last week'), weekLine(flat, opts()));
  const last = { ...flat, which: 'last' };
  eq('last week is against the week before', comparisonLabel(last), 'vs the week before');
  ok('and is introduced as last week', weekLine(last, opts()).startsWith('Last week: three'), weekLine(last, opts()));
}
{
  const done = { ...week, workouts: 4, streak: 5, comparison: { ...week.comparison, topMover: null } };
  ok('a full week says every workout was done', /All four workouts done|Every workout done, 4 of 4/.test(weekLine(done, opts())), weekLine(done, opts()));
  ok('with no mover, the streak is next', /five weeks/i.test(weekLine(done, opts())), weekLine(done, opts()));
}
{
  const reps = { ...week, comparison: { ...week.comparison, topMover: { name: 'Pull up', deltaKg: 0, currentKg: 0, currentReps: 10, previousReps: 8 } } };
  ok('a gain in reps at the same weight is put in reps', /two more reps/.test(weekLine(reps, opts())), weekLine(reps, opts()));
}
{
  const first = { ...week, comparison: null };
  ok('the first time through a rotation week says so', /first time through week 2/.test(weekLine(first, opts())), weekLine(first, opts()));
  eq('with nothing to compare, no header label', comparisonLabel(first), null);
}
eq('an empty week has no line', weekLine({ ...week, workouts: 0 }, opts()), null);
{
  const one = { ...week, workouts: 1, comparison: { ...week.comparison, workouts: 1, topMover: null, heavier: 0, lighter: 0, lifts: 2 } };
  ok('one workout is one workout', allLines(weekLine, one).every((l) => !/One workouts/.test(l)), allLines(weekLine, one).join(' | '));
  ok('mid-week, lifts aren’t said to have held', allLines(weekLine, one).every((l) => !/held/.test(l)), allLines(weekLine, one).join(' | '));
  const heldWeek = { ...week, which: 'last', comparison: { ...week.comparison, topMover: null, heavier: 0, lighter: 0, lifts: 5 } };
  ok('a finished week where nothing moved says they held', /held where they were/.test(weekLine(heldWeek, opts())), weekLine(heldWeek, opts()));
}

console.log('\n=== gathering a week from the log ===');
{
  // A Thursday. This week is Mon 14th (0–3 days ago), last week 4–10, two back 11–17.
  const NOW = new Date('2026-09-17T18:00:00');
  const at = (d) => new Date(NOW.getTime() - d * 86400000).toISOString();
  const on = (d, w) => ({ completed_at: at(d), plan_id: 'ppl', week_index: w });
  const set = (name, weight, reps, d) => ({ normalizedName: name, displayName: name, weight, reps, completedAt: at(d) });
  const sessions = [on(1, 2), on(2, 2), on(5, 1), on(6, 1), on(12, 2), on(13, 2)];
  const sets = [set('Bench press', 82.5, 6, 1), set('Bench press', 80, 6, 12), set('Squat', 100, 5, 5)];

  const facts = buildWeekFacts({ sets, sessions, planId: 'ppl', target: 4, streak: 3, now: NOW });
  eq('this week, with two done', [facts.which, facts.workouts, facts.weekStart], ['this', 2, '2026-09-14']);
  eq('compared with the last week 2', [facts.comparison.weekIndex, facts.comparison.weeksBack], [2, 2]);
  eq('bench moved 2.5 kg', facts.comparison.topMover.deltaKg, 2.5);
  eq('a week short of target claims no streak yet', facts.streak, 0);

  const monday = new Date('2026-09-14T08:00:00');
  const early = buildWeekFacts({ sets, sessions: sessions.filter((s) => s.completed_at < at(3)), planId: 'ppl', target: 2, streak: 3, now: monday });
  eq('before anything this week, it describes last week', [early.which, early.workouts, early.weekIndex], ['last', 2, 1]);
  eq('last week hit its target, so the streak stands', early.streak, 3);

  eq('nothing in either week, no card', buildWeekFacts({ sets: [], sessions: [on(12, 2)], planId: 'ppl', target: 4, streak: 0, now: NOW }), null);
}

console.log('\n=== every template keeps the voice ===');
{
  const BANNED = /crush|smash|beast|momentum|clearly|standout|peak|journey|unlock|amazing|incredible|!/i;
  const sessionCases = [
    base,
    { ...base, bests: [] },
    { ...base, totalKg: 4000, bests: [] },
    { ...base, previousTotalKg: null },
    { ...base, previousTotalKg: undefined, bests: [] },
    { ...base, durationMinutes: null, previousTotalKg: undefined, bests: [] },
    { ...base, bests: [base.bests[0], { exercise: 'Cable fly', kg: 17.5, reps: 1, previousBestKg: 15 }] },
  ];
  const weekCases = [
    week,
    { ...week, which: 'last' },
    { ...week, workouts: 4, streak: 6, comparison: { ...week.comparison, topMover: null } },
    { ...week, comparison: { ...week.comparison, topMover: null, heavier: 0, lighter: 0, volumeKg: 9000 } },
    { ...week, workouts: 1, comparison: { ...week.comparison, workouts: 1, topMover: null } },
    { ...week, comparison: null, weekIndex: null },
    { ...week, target: 0, workouts: 1 },
  ];
  const lines = [
    ...sessionCases.flatMap((f) => allLines(sessionLine, f)),
    ...weekCases.flatMap((f) => allLines(weekLine, f)),
  ];
  const sentences = (l) => (l.match(/[.?!](\s|$)/g) ?? []).length;
  ok(`${lines.length} lines, none longer than two sentences`, lines.every((l) => sentences(l) <= 2), lines.find((l) => sentences(l) > 2));
  ok('none with an exclamation mark or hype word', lines.every((l) => !BANNED.test(l)), lines.find((l) => BANNED.test(l)));
  ok('each starts with a capital', lines.every((l) => /^[A-Z0-9]/.test(l)), lines.find((l) => !/^[A-Z0-9]/.test(l)));
  ok('each ends with a full stop', lines.every((l) => l.endsWith('.')), lines.find((l) => !l.endsWith('.')));
  ok('no template left unfilled', lines.every((l) => !/undefined|null|NaN|\{|\}/.test(l)), lines.find((l) => /undefined|null|NaN|\{|\}/.test(l)));
  ok('short enough to read at a glance', lines.every((l) => l.length <= 200), lines.find((l) => l.length > 200));
}

console.log(failures === 0 ? '\nAll summary tests passed.' : `\n${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
