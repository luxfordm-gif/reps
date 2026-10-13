// Tests what the coach dashboard shows for a week: the figures against the
// comparison week, the day grid, the "how the body feels" score, the flags,
// and the body part and session views cut from the same data.
// Usage: npm test  —  or: node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/test-coach-week.mjs
import {
  bodyPartDetail,
  bodyPartsTrained,
  buildCoachWeek,
  compareSessions,
  liftHistory,
  lookBackOptions,
  liftSessionNames,
  topSet,
  topSetChangePct,
  feelScore,
  mondayOf,
  parseWeek,
  pctChange,
  sessionDetail,
  weeklyTrends,
} from '../src/lib/coach/coachWeek.ts';
import { summarizeWeekSets } from '../src/lib/weekSummary.ts';
import { demoAthleteData } from '../src/lib/coach/demoData.ts';

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

console.log('best sets');
eq('the heaviest set, most reps breaking a tie', topSet([{ weight: 80, reps: 8 }, { weight: 82.5, reps: 5 }, { weight: 82.5, reps: 6 }]), { weightKg: 82.5, reps: 6 });
eq('no weighted set, no best set', topSet([{ weight: null, reps: null }, { weight: null, reps: 12 }]), null);
eq('more weight, same reps', Math.round(topSetChangePct({ weightKg: 80, reps: 8 }, { weightKg: 82.5, reps: 8 }) * 10) / 10, 3.1);
eq('more reps, same weight', topSetChangePct({ weightKg: 28, reps: 10 }, { weightKg: 28, reps: 12 }), 20);
eq('the same set is no change', topSetChangePct({ weightKg: 45, reps: 10 }, { weightKg: 45, reps: 10 }), 0);

console.log('lifts, against the same session last time');
const [push, legs] = w.sessionLifts;
eq('one entry per session this week, in order', w.sessionLifts.map((x) => [x.dayName, x.previous?.sessionId]), [['Push', 's1'], ['Legs', 's2']]);
eq('bench: last time and this time', [push.lifts[0].previous, push.lifts[0].current], [{ weightKg: 80, reps: 8 }, { weightKg: 82.5, reps: 8 }]);
eq('bench up 3%', Math.round(push.lifts[0].pct * 1000) / 1000, 3.125);
eq('a lift new to the session has nothing to compare with', [push.lifts[1].displayName, push.lifts[1].previous, push.lifts[1].pct], ['Fly', null, null]);
eq('squat down 10%', legs.lifts.find((l) => l.normalizedName === 'squat').pct, -10);
eq('a doubled leg press is a machine change, not compared', [legs.lifts.find((l) => l.normalizedName === 'leg press').suspect, legs.lifts.find((l) => l.normalizedName === 'leg press').pct], [true, null]);
eq('a plank has no best set', legs.lifts.find((l) => l.normalizedName === 'plank').current, null);
eq('each session averages its own lifts', [push.averagePct, legs.averagePct], [3.125, -10]);
ok('the week averages every lift, the slip left out', Math.abs(w.strengthPct - ((3.125 + -10) / 2)) < 0.01, w.strengthPct);

console.log('a two-week rotation');
{
  const rot = (id, date, dayName) => ({ id, completedAt: at(date), dayName, checkIn: blank });
  const rs = [rot('a1', '2026-09-07', 'Push 1'), rot('b1', '2026-09-14', 'Push 2'), rot('a2', '2026-09-21', 'Push 1')];
  const rsets = [
    set('a1', '2026-09-07', 'Bench', 'Chest', 80, 8),
    set('b1', '2026-09-14', 'Bench', 'Chest', 70, 12),
    set('a2', '2026-09-21', 'Bench', 'Chest', 82.5, 8),
  ];
  const [cmp] = compareSessions({ ...data, sessions: rs, sets: rsets }, [rs[2]]);
  eq('Push 1 is set against the last Push 1, two weeks back, not last week\'s Push 2', [cmp.previous.sessionId, cmp.lifts[0].previous], ['a1', { weightKg: 80, reps: 8 }]);
  const rdata = { ...data, sessions: rs, sets: rsets };
  eq('a lift\'s sessions, most recent first', liftSessionNames(rdata, 'bench'), ['Push 1', 'Push 2']);
  eq('its history in one session skips the other', liftHistory(rdata, 'bench', 'Push 1').map((p) => p.top.weightKg), [80, 82.5]);
  eq('and across both, every time', liftHistory(rdata, 'bench').length, 3);
  // Push 1 on a two-week rotation, every other week from 7 Sep to 19 Oct.
  const p1 = ['2026-09-07', '2026-09-21', '2026-10-05', '2026-10-19'].map((d, i) => rot(`p${i}`, d, 'Push 1'));
  const p1sets = p1.map((x, i) => set(x.id, x.completedAt.slice(0, 10), 'Bench', 'Chest', 80 + 2.5 * i, 8));
  const pdata = { ...data, sessions: [...p1, rs[1]], sets: [...p1sets, rsets[1]] };
  const latest = p1[3];
  const backTo = (lb, start) => compareSessions(pdata, [latest], lb, start)[0].previous?.sessionId ?? null;
  eq('last time: two weeks back', backTo(undefined), 'p2');
  eq('four weeks back', backTo(4), 'p1');
  eq('six weeks back', backTo(6), 'p0');
  eq('further back than it was done: nothing', backTo(10), null);
  eq('start of the plan: the first on this plan', backTo('start', at('2026-09-15')), 'p1');
  eq('…without a plan date, the first ever', backTo('start'), 'p0');
  eq('a whole rotation at a time, as far as the plan goes', lookBackOptions(2, at('2026-09-07'), new Date('2026-10-19T00:00:00')), [2, 4, 6]);
  eq('a week at a time on a plan that doesn\'t rotate', lookBackOptions(0, at('2026-09-21'), new Date('2026-10-19T00:00:00')), [1, 2, 3, 4]);
  eq('at least one choice on a brand new plan', lookBackOptions(2, at('2026-10-19'), new Date('2026-10-19T00:00:00')), [2]);
}

console.log('body parts');
eq('every part in either week, this week first', w.bodyParts.map((b) => b.bodyPart), ['Quads', 'Chest', 'Other']);
eq('sets against last week', w.bodyParts.find((b) => b.bodyPart === 'Chest').sets, { current: 2, previous: 2 });
ok('chest from bench alone: fly was new', Math.abs(w.bodyParts.find((b) => b.bodyPart === 'Chest').strengthPct - 3.125) < 0.01);

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
eq('first week: zeros to compare against, every lift new', [calm.workouts.previous, calm.sessionLifts.every((x) => x.previous == null && x.lifts.every((l) => l.pct == null))], [0, true]);
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
eq('its lifts with their history, latest trained first', quads.exercises.map((e) => [e.displayName, e.dayName, e.history.length]), [['Leg press', 'Legs', 2], ['Squat', 'Legs', 2]]);
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

console.log('sample athlete (/coach/demo)');
{
  // A Thursday evening, so the current week has a few sessions in it.
  const now = new Date('2026-10-15T20:00:00');
  const demo = demoAthleteData(now);
  const again = demoAthleteData(now);
  eq('the same every time', JSON.stringify(demo.sets.slice(0, 5)), JSON.stringify(again.sets.slice(0, 5)));
  ok('nothing logged in the future', [...demo.sessions.map((x) => x.completedAt), ...demo.sets.map((x) => x.completedAt)].every((t) => new Date(t) <= now));
  const last = buildCoachWeek(demo, new Date('2026-10-05T00:00:00'), 'last', now);
  eq('last week: three of four, one missed on purpose', [last.workouts.current, last.target], [3, 4]);
  ok('…with short sleep and soreness flagged', ['missed', 'sleep', 'soreness'].every((k) => last.flags.some((f) => f.key === k)), last.flags);
  const week = buildCoachWeek(demo, new Date('2026-10-12T00:00:00'), 'last', now);
  ok('this week: squat is flagged as down', week.flags.some((f) => f.key === 'down' && f.text.includes('Back squat')), week.flags);
  const first = last.sessionLifts[0];
  eq('on its two-week rotation, a session is set against the same one two weeks back', [first.dayName, (new Date(first.completedAt) - new Date(first.previous.completedAt)) / 86400000], ['Push 2', 14]);
  eq('twelve weeks of trends with work in every one', weeklyTrends(demo, new Date('2026-10-12T00:00:00'), 12).every((t) => t.workouts > 0), true);
}

console.log(failures === 0 ? '\nAll coach week tests passed.' : `\n${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
