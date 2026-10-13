// Twelve weeks of made-up training, for /coach/demo — the dashboard as it
// looks with a real athlete's history behind it, before anyone has one.
//
// A push / pull / legs / upper plan on a two-week rotation — Push 1 one
// week, Push 2 (lighter, more reps) the next — four sessions a week, lifts
// creeping up about one percent a week, body weight drifting down. The last fortnight is
// rougher on purpose — a missed session, short sleep, higher soreness and
// stress, squat down — so the flags have something to show. Seeded, so the
// page reads the same on every visit; dated from `now`, so it's always recent.

import type { AthleteData } from './coachApi';
import type { CoachSession, CoachSet } from './coachWeek';
import { addDays, dayKey, mondayOf } from './coachWeek';

const PLAN: Record<string, [name: string, bodyPart: string, kg: number, reps: number][]> = {
  Push: [
    ['Bench press', 'Chest', 70, 8],
    ['Incline dumbbell press', 'Chest', 26, 10],
    ['Shoulder press', 'Shoulders', 40, 10],
    ['Triceps pushdown', 'Triceps', 30, 12],
  ],
  Pull: [
    ['Lat pulldown', 'Back', 60, 10],
    ['Seated row', 'Back', 55, 10],
    ['Rear delt fly', 'Rear delts', 10, 15],
    ['Biceps curl', 'Biceps', 14, 12],
  ],
  Legs: [
    ['Back squat', 'Quads', 90, 6],
    ['Romanian deadlift', 'Glutes/hams', 80, 8],
    ['Leg press', 'Quads', 160, 10],
    ['Calf raise', 'Calves', 60, 12],
  ],
  Upper: [
    ['Bench press', 'Chest', 70, 8],
    ['Lat pulldown', 'Back', 60, 10],
    ['Lateral raise', 'Shoulders', 8, 15],
  ],
};

/** Which day of the week (0 = Monday) each session falls on. */
const SCHEDULE: [number, string][] = [
  [0, 'Push'],
  [1, 'Pull'],
  [3, 'Legs'],
  [5, 'Upper'],
];

const WEEKS = 12;

export const DEMO_ATHLETE_ID = 'demo';
export const DEMO_NAME = 'Sample athlete';

export function demoAthleteData(now: Date = new Date()): AthleteData {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const half = (n: number) => Math.round(n * 2) / 2;
  const thisMonday = mondayOf(now);

  const sessions: CoachSession[] = [];
  const sets: CoachSet[] = [];
  const weights: AthleteData['logs']['weights'] = [];
  const water: AthleteData['logs']['water'] = [];
  const steps: AthleteData['logs']['steps'] = [];
  const sleep: AthleteData['logs']['sleep'] = [];
  let n = 0;

  for (let w = WEEKS - 1; w >= 0; w--) {
    const monday = addDays(thisMonday, -7 * w);
    const progress = (WEEKS - 1 - w) * 0.012;
    // The last fortnight: tired, under-slept and a bit beaten up.
    const rough = w <= 1;

    // Week 1 and week 2 of the rotation alternate, ending on whichever lands now.
    const variant = w % 2 === 0 ? 1 : 2;
    for (const [dow, base] of SCHEDULE) {
      const at = addDays(monday, dow);
      at.setHours(18, 0, 0, 0);
      if (at > now) continue;
      if (w === 1 && base === 'Upper') continue;
      if (w === 5 && base === 'Pull') continue;
      const dayName = `${base} ${variant}`;
      const id = `demo-session-${++n}`;
      sessions.push({
        id,
        completedAt: at.toISOString(),
        dayName,
        checkIn: {
          performance: rough ? 3 : rnd() > 0.6 ? 5 : 4,
          energy: rough ? (rnd() > 0.5 ? 3 : 2) : 4,
          soreness: rough ? 4 : rnd() > 0.7 ? 3 : 2,
          sleep: rough ? 2 : 4,
          hunger: 3,
          stress: rough ? 4 : 2,
        },
      });
      PLAN[base].forEach(([name, bodyPart, start, plannedReps], i) => {
        // Week 2 of the rotation: lighter, for more reps.
        const load = variant === 2 ? start * 0.85 : start;
        const reps = variant === 2 ? plannedReps + 2 : plannedReps;
        let kg = half(load * (1 + progress));
        // One lift going the wrong way, so the "down" flag shows.
        if (name === 'Back squat' && w === 0) kg = half(load * (1 + progress - 0.08));
        for (let s = 0; s < 3; s++) {
          sets.push({
            sessionId: id,
            completedAt: new Date(at.getTime() + (i * 3 + s) * 180_000).toISOString(),
            displayName: name,
            normalizedName: name.toLowerCase(),
            weight: kg,
            reps: reps - s,
            bodyPart,
          });
        }
      });
    }

    for (let d = 0; d < 7; d++) {
      const day = addDays(monday, d);
      day.setHours(8);
      if (day > now) continue;
      const key = dayKey(day);
      if (d % 2 === 0) {
        weights.push({ recorded_on: key, weight_kg: Math.round((86 - (WEEKS - 1 - w) * 0.18 + rnd() * 0.4) * 10) / 10 });
      }
      water.push({ recorded_on: key, count: 5 + Math.round(rnd() * 3) });
      steps.push({ recorded_on: key, steps: 6500 + Math.round(rnd() * 5000) });
      sleep.push({ recorded_on: key, hours: half((rough ? 5.5 : 7) + rnd() * 1.5) });
    }
  }

  return {
    sessions,
    sets,
    logs: { weights, water, steps, sleep },
    weeklyTarget: SCHEDULE.length,
    rotationWeeks: 2,
    referenceDayNames: [],
    plan: { name: 'Hypertrophy block 2', activatedAt: addDays(thisMonday, -7 * 9).toISOString() },
    machineUnits: new Map(),
  };
}
