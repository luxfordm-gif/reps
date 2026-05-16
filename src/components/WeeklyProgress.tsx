import { useMemo, useState } from 'react';
import type { WeekSessionBreakdown } from '../lib/sessionsApi';

interface Props {
  // 7 entries, Mon-Sun. Each day's entry is an array of relative efforts
  // (0-1). One workout = one entry. Two workouts on the same day = two
  // entries that render as stacked segments with a small gap.
  bars: number[][];
  // 7 entries, Mon-Sun. Per-session breakdown for the popover. Same length
  // and order as `bars`.
  dayDetails: WeekSessionBreakdown[][];
  workoutsDone: number;
  workoutsTarget: number;
  planWeek?: number | null;
}

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const FULL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TRACK_HEIGHT = 56;
const SEGMENT_GAP = 3;
const EMPTY_HEIGHT = 8;
const todayIndex = (() => {
  const d = new Date().getDay(); // 0=Sun..6=Sat
  return (d + 6) % 7; // shift so 0=Mon..6=Sun
})();

export function WeeklyProgress({
  bars,
  dayDetails,
  workoutsDone,
  workoutsTarget,
  planWeek,
}: Props) {
  // Default to the most recent completed day this week so the popover
  // always has something to show and the card has a stable height.
  const latestIdx = useMemo(() => {
    for (let i = bars.length - 1; i >= 0; i--) {
      if (bars[i].length > 0) return i;
    }
    return null;
  }, [bars]);

  // Track only the user's explicit pick; fall back to the latest completed
  // day so newly-finished workouts auto-anchor the popover.
  const [userPicked, setUserPicked] = useState<number | null>(null);
  const selected = userPicked ?? latestIdx;
  const selectedDetails =
    selected != null ? dayDetails[selected] ?? [] : [];

  return (
    <div className="rounded-card bg-ink p-5 text-white shadow-[0_8px_24px_rgba(0,0,0,0.18)]">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-medium uppercase tracking-[0.12em] text-white/55">
          Weekly Progress
        </div>
        {planWeek != null && (
          <div className="text-xs font-medium uppercase tracking-[0.12em] text-white/55">
            Week {planWeek}
          </div>
        )}
      </div>
      <div className="mt-1 text-2xl font-bold tracking-tight">
        {workoutsDone} of {workoutsTarget} workouts
      </div>

      <div className="mt-5 flex items-end gap-2">
        {bars.map((segments, i) => {
          const isToday = i === todayIndex;
          const hasAny = segments.length > 0;
          const isSelected = selected === i;
          const onClick = () => {
            if (!hasAny) return;
            // Persistent popover: tapping the active bar keeps it selected.
            setUserPicked(i);
          };
          return (
            <button
              type="button"
              key={i}
              onClick={onClick}
              disabled={!hasAny}
              aria-label={`${FULL_DAYS[i]} workouts`}
              aria-pressed={isSelected}
              className="flex flex-1 flex-col items-center gap-1.5 disabled:cursor-default"
            >
              <div
                className="flex w-full flex-col-reverse items-stretch justify-start"
                style={{ height: `${TRACK_HEIGHT}px`, gap: `${SEGMENT_GAP}px` }}
              >
                {hasAny ? (
                  segments.map((value, si) => {
                    const px = Math.max(
                      12,
                      Math.round(value * (TRACK_HEIGHT - SEGMENT_GAP * (segments.length - 1)))
                    );
                    const bg = isSelected
                      ? 'bg-white'
                      : isToday
                        ? 'bg-white'
                        : 'bg-white/55';
                    return (
                      <div
                        key={si}
                        className={`w-full rounded-md ${bg}`}
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
                  isSelected || isToday ? 'text-white' : 'text-white/45'
                }`}
              >
                {DAYS[i]}
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-4 min-h-[3.25rem] rounded-xl bg-white/10 px-3.5 py-2.5 text-xs text-white">
        {selected != null && selectedDetails.length > 0 ? (
          <>
            <div className="font-semibold uppercase tracking-[0.12em] text-white/60">
              {FULL_DAYS[selected]}
            </div>
            <ul className="mt-1 space-y-0.5">
              {selectedDetails.map((s, i) => (
                <li key={i}>
                  <span className="font-semibold">{s.trainingDayName}</span>
                  {s.bodyParts.length > 0 && (
                    <span className="text-white/70"> — {s.bodyParts.join(', ')}</span>
                  )}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="text-white/55">No workouts logged yet this week.</div>
        )}
      </div>
    </div>
  );
}
