// One week of training added up: sessions, sets and volume, by body part and
// by lift. Pure — the weekly coach copy and the coach dashboard both total a
// week through here, so the two can't disagree about what a week held.

export interface BodyPartStats {
  bodyPart: string;
  volume: number;
  setCount: number;
  sessionCount: number;
  topSet: { exercise: string; weight: number; reps: number } | null;
}

export interface WeeklySessionRef {
  trainingDayName: string;
  completedAt: string;
}

/** The single best set (by estimated 1RM) logged for one exercise in a week. */
export interface ExerciseWeekBest {
  normalizedName: string;
  displayName: string;
  bodyPart: string | null;
  /** Weight (kg) and reps of the set that produced the best estimated 1RM. */
  topWeightKg: number;
  topReps: number;
  /** Epley estimated 1RM (kg) of that set — used to rank week-over-week gains. */
  bestE1RMkg: number;
}

export interface WeeklyWorkoutSummary {
  weekStart: Date;
  weekEnd: Date;
  workoutsDone: number;
  totalVolume: number;
  totalSets: number;
  sessions: WeeklySessionRef[];
  byBodyPart: BodyPartStats[];
  /** Best set per exercise this week, for per-exercise progress comparisons. */
  exerciseBests: ExerciseWeekBest[];
}

/** Epley estimated one-rep max. Single reps return the lifted weight unchanged. */
function epley1RM(weight: number, reps: number): number {
  if (reps <= 1) return weight;
  return weight * (1 + reps / 30);
}

/** A finished session as the week summary needs it. */
export interface WeekSessionRow {
  id: string;
  completed_at: string;
  trainingDayName: string;
}

/** A logged set as the week summary needs it. */
export interface WeekSetRow {
  session_id: string;
  exercise_display_name: string;
  exercise_normalized_name: string;
  weight: number | null;
  reps: number | null;
  bodyPart: string | null;
}

/** One week's sessions and sets totalled, by body part and by lift. Pure, so
 *  the athlete's copy and the coach's dashboard add up the same way. */
export function summarizeWeekSets(
  weekStart: Date,
  sessions: WeekSessionRow[],
  setRows: WeekSetRow[],
): WeeklyWorkoutSummary {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const sessionRefs: WeeklySessionRef[] = sessions.map((s) => ({
    trainingDayName: s.trainingDayName,
    completedAt: s.completed_at,
  }));

  const groups = new Map<
    string,
    {
      volume: number;
      setCount: number;
      sessions: Set<string>;
      topSet: { exercise: string; weight: number; reps: number } | null;
    }
  >();
  // Best set per exercise (by estimated 1RM), keyed by normalized name.
  const exGroups = new Map<string, ExerciseWeekBest>();
  let totalVolume = 0;
  let totalSets = 0;
  for (const r of setRows) {
    const named = r.bodyPart?.trim() ? r.bodyPart.trim() : null;
    const bodyPart = named ?? 'Other';
    let group = groups.get(bodyPart);
    if (!group) {
      group = { volume: 0, setCount: 0, sessions: new Set(), topSet: null };
      groups.set(bodyPart, group);
    }
    group.setCount += 1;
    group.sessions.add(r.session_id);
    totalSets += 1;
    if (r.weight != null && r.reps != null) {
      const v = r.weight * r.reps;
      group.volume += v;
      totalVolume += v;
      if (!group.topSet || r.weight > group.topSet.weight) {
        group.topSet = {
          exercise: r.exercise_display_name,
          weight: r.weight,
          reps: r.reps,
        };
      }
      const e = epley1RM(r.weight, r.reps);
      const ex = exGroups.get(r.exercise_normalized_name);
      if (!ex || e > ex.bestE1RMkg) {
        exGroups.set(r.exercise_normalized_name, {
          normalizedName: r.exercise_normalized_name,
          displayName: r.exercise_display_name,
          bodyPart: named,
          topWeightKg: r.weight,
          topReps: r.reps,
          bestE1RMkg: e,
        });
      }
    }
  }

  const byBodyPart: BodyPartStats[] = [...groups.entries()]
    .map(([bodyPart, g]) => ({
      bodyPart,
      volume: g.volume,
      setCount: g.setCount,
      sessionCount: g.sessions.size,
      topSet: g.topSet,
    }))
    .sort((a, b) => b.volume - a.volume || b.setCount - a.setCount);

  const exerciseBests = [...exGroups.values()].sort((a, b) => b.bestE1RMkg - a.bestE1RMkg);

  return {
    weekStart,
    weekEnd,
    workoutsDone: sessions.length,
    totalVolume,
    totalSets,
    sessions: sessionRefs,
    byBodyPart,
    exerciseBests,
  };
}
