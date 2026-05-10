interface Props {
  // 7 numbers, Mon-Sun, each 0-1 representing relative effort
  bars: number[];
  workoutsDone: number;
  workoutsTarget: number;
}

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
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
        {bars.map((value, i) => {
          const height = Math.max(8, Math.round(value * 56));
          const isToday = i === todayIndex;
          return (
            <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
              <div className="flex h-14 w-full items-end">
                <div
                  className={`w-full rounded-md ${
                    isToday ? 'bg-white' : value > 0 ? 'bg-white/55' : 'bg-white/15'
                  }`}
                  style={{ height: `${height}px` }}
                />
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
