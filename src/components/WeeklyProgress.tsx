interface Props {
  // 7 entries, Mon-Sun. Each day's entry is an array of relative efforts
  // (0-1). One workout = one entry. Two workouts on the same day = two
  // entries that render as stacked segments with a small gap.
  bars: number[][];
  workoutsDone: number;
  workoutsTarget: number;
}

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const TRACK_HEIGHT = 56;
const SEGMENT_GAP = 3;
const EMPTY_HEIGHT = 8;
const todayIndex = (() => {
  const d = new Date().getDay(); // 0=Sun..6=Sat
  return (d + 6) % 7; // shift so 0=Mon..6=Sun
})();

export function WeeklyProgress({ bars, workoutsDone, workoutsTarget }: Props) {
  return (
    <div className="rounded-card bg-ink p-5 text-white shadow-[0_8px_24px_rgba(0,0,0,0.18)]">
      <div className="text-xs font-medium uppercase tracking-[0.12em] text-white/55">
        Weekly Progress
      </div>
      <div className="mt-1 text-2xl font-bold tracking-tight">
        {workoutsDone} of {workoutsTarget} workouts
      </div>

      <div className="mt-5 flex items-end gap-2">
        {bars.map((segments, i) => {
          const isToday = i === todayIndex;
          const hasAny = segments.length > 0;
          return (
            <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
              <div
                className="flex w-full flex-col-reverse items-stretch justify-start"
                style={{ height: `${TRACK_HEIGHT}px`, gap: `${SEGMENT_GAP}px` }}
              >
                {hasAny ? (
                  segments.map((value, si) => {
                    // Minimum 12px so any completed session is visible, even
                    // when it has zero logged volume (body-weight workouts).
                    const px = Math.max(
                      12,
                      Math.round(value * (TRACK_HEIGHT - SEGMENT_GAP * (segments.length - 1)))
                    );
                    return (
                      <div
                        key={si}
                        className={`w-full rounded-md ${isToday ? 'bg-white' : 'bg-white/55'}`}
                        style={{ height: `${px}px` }}
                      />
                    );
                  })
                ) : (
                  <div
                    className="w-full rounded-md bg-white/15"
                    style={{ height: `${EMPTY_HEIGHT}px` }}
                  />
                )}
              </div>
              <div
                className={`text-[10px] font-medium ${
                  isToday ? 'text-white' : 'text-white/45'
                }`}
              >
                {DAYS[i]}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
