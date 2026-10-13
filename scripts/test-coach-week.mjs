// Tests what the coach dashboard shows for a week: the figures against the
// comparison week, the day grid, the "how the body feels" score, the flags,
// and the body part and session views cut from the same data.
// Usage: npm test  —  or: node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/test-coach-week.mjs
import {
  bodyPartDetail,
  bodyPartsTrained,
  buildCoachWeek,
  feelScore,
  mondayOf,
  parseWeek,
  pctChange,
  sessionDetail,
  weeklyTrends,
} from '../src/lib/coach/coachWeek.ts';
import { summarizeWeekSets } from '../src/lib/weekSummary.ts';

let failures = 0;
function eq(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) console.log(`  ✓ ${label}`);
  else { failures += 1; console.log(`  ✗ ${label}\n      got  ${g}\n      want ${w}`); }
}
function ok(label, cond, detail = '') {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures += 1; console.log(`  ✗ ${label}${detail ? `\n      ${JSON.stringify(detail)}` : ''}`); }
}

const blank = { performance: null, energy: null, soreness: null, sleep: null, hunger: null, stress: null };
const at = (date, time = '18:00') => new Date(`${date}T${time}:00`).toISOString();

// Two weeks: Mon 14 Sep and Mon 21 Sep 2026. Push and Legs each week.
const WEEK1 = new Date('2026-09-14T00:00:00');
const WEEK2 = new Date('2026-09-21T00:00:00');
const sessions = [
  { id: 's1', completedAt: at('2026-09-14'), dayName: 'Push', checkIn: { ...blank, performance: 4, energy: 4, soreness: 2, sleep: 4, stress: 2 } },
  { id: 's2', completedAt: at('2026-09-17'), dayName: 'Legs', checkIn: { ...blank, performance: 3, soreness: 3 } },
  { id: 's3', completedAt: at('2026-09-21'), dayName: 'Push', checkIn: { ...blank, performance: 5, energy: 3, soreness: 4, sleep: 2, hunger: 5, stress: 4 } },
  { id: 's4', completedAt: at('2026-09-24'), dayName: 'Legs', checkIn: { ...blank, performance: 2, soreness: 5, stress: 5 } },
];
const set = (sessionId, date, name, bodyPart, weight, reps) => ({
  sessionId, completedAt: at(date), displayName: name, normalizedName: name.toLowerCase(), weight, reps, bodyPart,
});
const sets = [
  set('s1', '2026-09-14', 'Bench', 'Chest', 80, 8),
  set('s1', '2026-09-14', 'Bench', 'Chest', 80, 7),
  set('s2', '2026-09-17', 'Squat', 'Quads', 100, 5),
  set('s2', '2026-09-17', 'Leg press', 'Quads', 200, 10),
  set('s3', '2026-09-21', 'Bench', 'Chest', 82.5, 8),
  set('s3', '2026-09-21', 'Fly', 'Chest', 20, 12),
  set('s4', '2026-09-24', 'Squat', 'Quads', 90, 5),
  set('s4', '2026-09-24', 'Leg press', 'Quads', 400, 10), // a machine change, not a doubling
  set('s4', '2026-09-24', 'Plank', null, null, null),
];
const logs = {
  weights: [
    { recorded_on: '2026-09-14', weight_kg: 84 }, { recorded_on: '2026-09-16', weight_kg: 84 },
    { recorded_on: '2026-09-21', weight_kg: 85.5 }, { recorded_on: '2026-09-23', weight_kg: 85.5 },
  ],
  water: [{ recorded_on: '2026-09-21', count: 6 }, { recorded_on: '2026-09-22', count: 0 }, { recorded_on: '2026-09-15', count: 4 }],
  steps: [{ recorded_on: '2026-09-22', steps: 9000 }, { recorded_on: '2026-09-15', steps: 7000 }],
  sleep: [
    { recorded_on: '2026-09-21', hours: 6 }, { recorded_on: '2026-09-22', hours: 6.5 }, { recorded_on: '2026-09-23', hours: 0 },
    { recorded_on: '2026-09-15', hours: 8 },
  ],
};
const data = { sessions, sets, logs, weeklyTarget: 3, rotationWeeks: 0 };
const after = new Date('2026-10-01T12:00:00');

console.log('dates');
eq('a week param names its Monday', parseWeek('2026-09-24')?.getDate(), 21);
eq('a bad week param is null', parseWeek('next week'), null);
eq('Monday of a Sunday is six days back', mondayOf(new Date('2026-09-27T10:00:00')).getDate(), 21);

console.log('the week against the one before');
const w = buildCoachWeek(data, WEEK2, 'last', after);
eq('workouts this week and last', w.workouts, { current: 2, previous: 2 });
eq('sets counted, unweighted ones included', w.sets, { current: 5, previous: 4 });
eq('volume is weight × reps', w.volumeKg.current, 82.5 * 8 + 20 * 12 + 90 * 5 + 400 * 10);
eq('body weight averages the days logged', w.weightKg, { current: 85.5, previous: 84 });
eq('a water zero is a tap taken back, not a day', w.water.current, 6);
eq('a sleep zero is a real night and counts', w.sleepHours.current, (6 + 6.5 + 0) / 3);
eq('steps with nothing the week before', w.steps, { current: 9000, previous: 7000 });
eq('percentage change', Math.round(pctChange(w.weightKg) * 100) / 100, 1.79);
eq('no change without a base', pctChange({ current: 3, previous: 0 }), null);

console.log('day grid');
eq('seven days from Monday', w.days.map((d) => d.date), ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27']);
eq('a training day carries its session', w.days[0].sessions.map((s) => [s.dayName, s.setCount]), [['Push', 2]]);
eq('a rest day has none', w.days[1].sessions.length, 0);
eq('daily logs land on their day', [w.days[1].water, w.days[1].steps, w.days[1].sleepHours], [null, 9000, 6.5]);

console.log('how the body feels');
eq('soreness and stress turn round, hunger is left out', feelScore({ ...blank, performance: 5, energy: 3, soreness: 4, sleep: 2, hunger: 5, stress: 4 }), (5 + 3 + 2 + 2 + 2) / 5);
eq('nothing answered is no score', feelScore(blank), null);
eq('each question averages the sessions that answered it', [w.feel.ratings.performance.current, w.feel.ratings.energy.current], [3.5, 3]);
eq('and last week beside it', w.feel.ratings.soreness.previous, 2.5);
eq('check-ins counted', w.feel.checkIns, 2);

console.log('lifts');
eq('lifts in both weeks, slips kept apart', w.lifts.map((c) => c.cur.normalizedName), ['bench', 'squat']);
eq('the slip is named', w.suspectLifts.map((c) => c.cur.normalizedName), ['leg press']);
eq('a lift new this week', w.newLifts.map((e) => e.normalizedName), ['fly']);
ok('strength average leaves the slip out', w.strengthPct != null && Math.abs(w.strengthPct - ((3.125 + -10) / 2)) < 0.01, w.strengthPct);

console.log('body parts');
eq('every part in either week, this week first', w.bodyParts.map((b) => b.bodyPart), ['Quads', 'Chest', 'Other']);
eq('sets against last week', w.bodyParts.find((b) => b.bodyPart === 'Chest').sets, { current: 2, previous: 2 });
ok('chest strength from bench alone', Math.abs(w.bodyParts.find((b) => b.bodyPart === 'Chest').strengthPct - 3.125) < 0.01);

console.log('flags');
eq('flags in order of how pressing', w.flags.map((f) => f.key), ['missed', 'sleep', 'soreness', 'stress', 'down', 'weight', 'suspect']);
eq('missed sessions read as done of target', w.flags[0].text, '2 of 3 sessions done');
eq('one lift down is named', w.flags.find((f) => f.key === 'down').text, 'Squat down 10%');
const midWeek = buildCoachWeek(data, WEEK2, 'last', new Date('2026-09-23T12:00:00'));
ok('a week still going is not flagged for missed sessions', !midWeek.flags.some((f) => f.key === 'missed'));
ok('…and says it is not complete', midWeek.complete === false);
eq('…and is set against last week only as far as Wednesday noon', [midWeek.workouts.previous, midWeek.sets.previous], [1, 2]);
eq('…daily logs too: Monday to Wednesday of each', midWeek.sleepHours.previous, 8);
const calm = buildCoachWeek({ ...data, logs: { ...logs, sleep: [] } }, WEEK1, 'last', after);
eq('a calm week with nothing before it raises only the shortfall', calm.flags.map((f) => f.key), ['missed']);

const withAbs = buildCoachWeek({ ...data, referenceDayNames: ['Legs'] }, WEEK2, 'last', after);
eq('a reference day is on the grid but not counted', [withAbs.workouts.current, withAbs.days[3].sessions.length], [1, 1]);

console.log('empty comparison week');
eq('first week has zeros to compare against', [calm.workouts.previous, calm.lifts.length, calm.newLifts.length], [0, 0, 3]);
eq('no strength change without a comparison', calm.strengthPct, null);

console.log('rotation');
const rot = buildCoachWeek({ ...data, rotationWeeks: 2 }, WEEK2, 'rotation', after);
eq('compares with the same week last rotation', [rot.comparisonWeeksBack, rot.comparisonStart.getDate()], [2, 7]);
const noRot = buildCoachWeek(data, WEEK2, 'rotation', after);
eq('a plan with no rotation falls back to last week', noRot.comparisonWeeksBack, 1);

console.log('trends and drill-downs');
const trends = weeklyTrends(data, WEEK2, 3);
eq('weeks oldest first', trends.map((t) => [t.weekStart, t.workouts]), [['2026-09-07', 0], ['2026-09-14', 2], ['2026-09-21', 2]]);
eq('parts by sets logged, ties by name', bodyPartsTrained(data), ['Chest', 'Quads', 'Other']);
const quads = bodyPartDetail(data, 'Quads', WEEK2, 2);
eq('a part week by week', quads.weeks.map((x) => [x.sets, x.best?.exercise]), [[2, 'Leg press'], [2, 'Leg press']]);
eq('its lifts with their history, latest trained first', quads.exercises.map((e) => [e.displayName, e.history.length]), [['Leg press', 2], ['Squat', 2]]);
const detail = sessionDetail(data, 's3');
eq('a session grouped by lift', detail.exercises.map((e) => [e.displayName, e.sets.length]), [['Bench', 1], ['Fly', 1]]);
eq('an unknown session is null', sessionDetail(data, 'nope'), null);

console.log('week totals (summarizeWeekSets)');
const summary = summarizeWeekSets(WEEK2, [{ id: 'a', completed_at: at('2026-09-21'), trainingDayName: 'Push' }], [
  { session_id: 'a', exercise_display_name: 'Bench', exercise_normalized_name: 'bench', weight: 80, reps: 5, bodyPart: ' Chest ' },
  { session_id: 'a', exercise_display_name: 'Bench', exercise_normalized_name: 'bench', weight: 70, reps: 12, bodyPart: 'Chest' },
  { session_id: 'a', exercise_display_name: 'Plank', exercise_normalized_name: 'plank', weight: null, reps: null, bodyPart: null },
]);
eq('body parts trimmed, missing ones as Other', summary.byBodyPart.map((b) => [b.bodyPart, b.setCount]), [['Chest', 2], ['Other', 1]]);
eq('best set by estimated 1RM, not by weight', [summary.exerciseBests[0].topWeightKg, summary.exerciseBests[0].topReps], [70, 12]);
eq('week end is seven days on', summary.weekEnd.getDate(), 28);
eq('nothing logged is an empty week', summarizeWeekSets(WEEK2, [], []).workoutsDone, 0);

console.log(failures === 0 ? '\nAll coach week tests passed.' : `\n${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
