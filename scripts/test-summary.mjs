// Tests the written summaries: the line on the finish screen and the week card
// on Performance. What each says for a given set of facts, and the voice every
// template has to keep whatever the facts are.
// Usage: npm test  —  or: node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/test-summary.mjs
import { buildCoachSummary, weekRange } from '../src/lib/coachSummary.ts';
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

console.log('\nCoach summary (copied from Profile)');
{
  const week = (start, sessions, bests) => {
    const weekStart = new Date(start);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    return {
      weekStart, weekEnd, workoutsDone: sessions.length, totalVolume: 0, totalSets: 0,
      sessions: sessions.map(([trainingDayName, completedAt]) => ({ trainingDayName, completedAt })),
      byBodyPart: [],
      exerciseBests: bests.map(([displayName, w, r]) => ({
        normalizedName: displayName.toLowerCase(), displayName, bodyPart: null,
        topWeightKg: w, topReps: r, bestE1RMkg: r <= 1 ? w : w * (1 + r / 30),
      })),
    };
  };
  const cur = week('2026-09-21T00:00:00', [['Push', '2026-09-21T18:00:00'], ['Pull', '2026-09-23T18:00:00'], ['Legs', '2026-09-25T18:00:00']],
    [['Squat', 100, 8], ['Bench press', 82.5, 5], ['Row', 60, 10], ['Curl', 15, 10]]);
  const last = week('2026-09-14T00:00:00', [['Push', '2026-09-14T18:00:00'], ['Pull', '2026-09-16T18:00:00']],
    [['Squat', 100, 5], ['Bench press', 80, 5], ['Row', 60, 10], ['Curl', 16, 10]]);
  const two = week('2026-09-07T00:00:00', [['Legs', '2026-09-07T18:00:00']], [['Squat', 90, 5]]);

  eq('week range in one month', weekRange(new Date('2026-09-21T00:00:00')), '21–27 September');
  eq('week range across a month end', weekRange(new Date('2026-09-28T00:00:00')), '28 September – 4 October');

  const text = buildCoachSummary({ name: 'Matt Luxford', current: cur, lastWeek: last, weight: kg });
  const lines = text.trim().split('\n');
  eq('opens with first name and the week', lines[0], "Matt's week, 21–27 September");
  eq('says how often, and on which days', lines[2], 'Matt trained 3 times: Push (Mon), Pull (Wed), Legs (Fri).');
  eq('compares the count with last week', lines[3], 'Up from 2 last week.');
  eq('averages strength across the repeated lifts', lines[4], 'Strength up 1% on last week (estimated 1RM, same lifts).');
  eq('top lifts, biggest gain first, only the ones that went up',
    lines.slice(6),
    ['Top lifts vs last week', '• Squat: 100 kg × 5 → 100 kg × 8 (+9%)', '• Bench press: 80 kg × 5 → 82.5 kg × 5 (+3%)']);
  ok('no comparison with 2 weeks ago on a plan that repeats weekly', !text.includes('2 weeks ago'));
  ok('plain text, no markdown', !/[*#]/.test(text), text);

  const rotating = buildCoachSummary({
    name: null, current: cur, lastWeek: last, rotation: { weeksBack: 2, week: two }, weight: kg,
  });
  ok('a two-week plan also compares with 2 weeks ago', rotating.includes('Strength up 1% on last week and up 21% on 2 weeks ago'), rotating);
  ok('…and lists its top lifts', rotating.includes('Top lifts vs 2 weeks ago\n• Squat: 90 kg × 5 → 100 kg × 8 (+21%)'), rotating);
  ok('no name reads as a plain heading', rotating.startsWith('Training week, 21–27 September\n\nTrained 3 times'), rotating);

  const first = buildCoachSummary({ name: 'Sam', current: cur, lastWeek: null, weight: kg });
  ok('first week says there is nothing to compare against', first.includes('First week logged, so nothing to compare against yet.'), first);
  ok('…and gives best sets instead', first.includes('Best sets\n• Squat: 100 kg × 8'), first);
  ok('…with no strength line', !first.includes('Strength'), first);

  const flat = buildCoachSummary({ name: 'Sam', current: week('2026-09-21T00:00:00', [['Push', '2026-09-22T18:00:00']], [['Curl', 15, 10]]), lastWeek: last, weight: kg });
  ok('once, and down on last week', flat.includes('Sam trained once: Push (Tue).\nDown from 2 last week.'), flat);
  ok('a lift that dropped is reported as down', flat.includes('Strength down 6% on last week'), flat);
  ok('nothing up is said plainly', flat.includes('• Nothing up on the same lifts — held steady.'), flat);
}


// ---- The end-of-workout check-in and its weekly export (lib/checkin) ----
import {
  buildCheckInExport,
  flagsLine,
  isCheckInComplete,
  isCheckInEmpty,
  normaliseCheckIn,
  ratingsLine,
} from '../src/lib/checkin.ts';

console.log('\ncheck-in');
{
  const full = normaliseCheckIn({ performance: 6, energy: 5, soreness: 3, sleep: 4, flags: ['stressed', 'stomach'] });
  eq('ratings line names every answered question in order', ratingsLine(full), 'Session 6 · Energy 5 · Soreness 3 · Sleep 4');
  eq('flags line reads as one sentence fragment', flagsLine(full), 'Stressed, upset stomach');
  ok('all four answered counts as complete', isCheckInComplete(full));

  const partial = normaliseCheckIn({ performance: 7, sleep: 2 });
  eq('a skipped question is left out, not shown as blank', ratingsLine(partial), 'Session 7 · Sleep 2');
  ok('a partial check-in is neither empty nor complete', !isCheckInEmpty(partial) && !isCheckInComplete(partial));
  eq('no flags gives no line', flagsLine(partial), null);

  const junk = normaliseCheckIn({ performance: 9, energy: 0, soreness: 4.4, sleep: '5', flags: ['ill', 'bogus', 'ill'] });
  eq('out-of-range and non-numeric ratings are dropped', [junk.performance, junk.energy, junk.sleep], [null, null, null]);
  eq('a fractional rating rounds to the sheet scale', junk.soreness, 4);
  eq('unknown and repeated flags are dropped', junk.flags, ['ill']);
  ok('nothing at all is empty', isCheckInEmpty(normaliseCheckIn(null)));
  eq('empty ratings give no line', ratingsLine(normaliseCheckIn(null)), null);

  const now = new Date('2026-10-11T18:00:00Z');
  const rows = [
    { completedAt: '2026-10-06T17:30:00Z', dayName: 'Upper', checkIn: full, note: null },
    { completedAt: '2026-10-07T17:30:00Z', dayName: 'Lower', checkIn: normaliseCheckIn(null), note: null },
    { completedAt: '2026-10-08T17:30:00Z', dayName: 'Push', checkIn: partial, note: '  Felt the bench groove come back. ' },
  ];
  const text = buildCheckInExport(rows, now);
  eq(
    'export is one block per session with something to say',
    text,
    [
      'Check-ins for coach',
      'Week ending 11 October 2026',
      'Ratings are 1 to 7. Soreness: 1 fresh, 7 wrecked.',
      '',
      'Upper, Tue 6 Oct',
      'Session 6 · Energy 5 · Soreness 3 · Sleep 4',
      'Stressed, upset stomach',
      '',
      'Push, Thu 8 Oct',
      'Session 7 · Sleep 2',
      'Felt the bench groove come back.',
      '',
    ].join('\n')
  );
  ok('export has no markdown', !/[*_#]/.test(text));
  eq('a week with nothing answered exports nothing', buildCheckInExport([rows[1]], now), null);
  const noteOnly = { completedAt: '2026-10-09T17:30:00Z', dayName: 'Legs', checkIn: normaliseCheckIn(null), note: 'Knee niggle' };
  ok('a note from an older build still exports', buildCheckInExport([noteOnly], now).includes('Knee niggle'));
}

console.log(failures === 0 ? '\nAll summary tests passed.' : `\n${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
