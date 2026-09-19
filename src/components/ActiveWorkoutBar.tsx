import { imageForDay } from '../lib/dayImages';
import { useElapsedLabel } from '../lib/elapsed';
import { haptics } from '../lib/haptics';
import type { ActiveSessionContext } from '../lib/sessionsApi';

/**
 * Everything the docked bar needs to stand in for the workout in progress.
 *
 * `resume` is handed over rather than rebuilt here because working out where
 * to drop someone back into a session needs the plan — which day, and which
 * exercise they last logged — and Home is the screen that already holds it.
 * One place decides where "resume" goes; the bar only has to call it.
 */
export interface ActiveWorkoutInfo {
  context: ActiveSessionContext;
  /** The exercise they last logged a set on — where they left off. */
  exerciseName: string | null;
  resume: () => void;
}

interface Props {
  info: ActiveWorkoutInfo;
  /** Opens the end-workout dialog: save it, discard it, or keep going. */
  onEnd: () => void;
}

/**
 * The workout in progress, docked above the tab bar.
 *
 * Home already shows a workout in progress as a full card, but that card
 * scrolls away, and it was the only place in the app that knew a session was
 * open at all — walk to Performance or Profile and the running timer simply
 * ceased to exist. This is the answer to that: it sits over the tab bar on
 * every tab, so a session can never be lost behind a screen, and it carries
 * the two things you'd go looking for — how long you've been at it, and what
 * you were last on.
 *
 * It does not carry a bare bin. A workout is up to an hour of logging, and an
 * "undo this" button placed a thumb's width from the control you're actually
 * aiming for is how that hour gets thrown away. End opens the dialog the
 * logger uses, which offers saving it first.
 */
export function ActiveWorkoutBar({ info, onEnd }: Props) {
  const { context, exerciseName, resume } = info;
  const label = useElapsedLabel(context.startedAt);
  const image = imageForDay(context.trainingDayName);

  return (
    <div className="mx-auto mb-2 flex h-14 max-w-md items-center gap-1 rounded-pill bg-ink p-2 shadow-lift">
      <button
        onClick={() => {
          haptics.tap();
          resume();
        }}
        className="pressable flex min-w-0 flex-1 items-center gap-2.5 rounded-pill pr-1 text-left"
      >
        {image ? (
          <img
            src={image}
            alt=""
            aria-hidden
            className="h-10 w-10 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15 text-base font-bold text-white">
            {context.trainingDayName[0]}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-sm font-semibold text-white">
            <span className="live-dot h-1.5 w-1.5 shrink-0 rounded-full bg-[#4ADE80]" />
            <span className="truncate">{context.trainingDayName}</span>
            <span className="shrink-0 font-mono tabular-nums text-white/70">{label}</span>
          </span>
          <span className="mt-0.5 block truncate text-caption text-white/55">
            {exerciseName ?? 'Tap to pick up where you left off'}
          </span>
        </span>
      </button>
      <button
        onClick={() => {
          haptics.tap();
          onEnd();
        }}
        className="pressable h-10 shrink-0 rounded-pill bg-white/15 px-4 text-xs font-semibold text-white active:bg-white/25"
      >
        End
      </button>
    </div>
  );
}
