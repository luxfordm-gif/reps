import { imageForDay } from '../lib/dayImages';

interface Props {
  name: string;
  // Usually the day's body parts; the active-workout card passes its timer.
  bodyParts: React.ReactNode;
  // Omitted by the active-workout card, which has a timer to show instead.
  exerciseCount?: number | null;
  // Which exercise of the day you're on, 1-based. Given, the count reads
  // "2-8" with the 2 bright and the total dimmed, so the card says where you
  // are in the day rather than only how long the day is. The active-workout
  // card is the one that knows this; everywhere else it's left off.
  exercisePosition?: number | null;
  accent: string;
  // Small pill after the title — "Week 2" on a rotating day, "Home" on the abs
  // reference card.
  tag?: string | null;
  isNext?: boolean;
  // Pill above a dark card. Defaults to "Up next"; the active-workout card
  // labels itself instead.
  badgeLabel?: string;
  done?: boolean;
  onClick?: () => void;
}

export function TrainingDayCard({
  name,
  bodyParts,
  exerciseCount,
  exercisePosition,
  accent,
  tag,
  isNext,
  badgeLabel = 'Up next',
  done,
  onClick,
}: Props) {
  const surface = isNext
    ? 'bg-ink text-white shadow-lift'
    : 'bg-paper-card text-ink shadow-card';

  const badge = isNext ? (
    <span className="absolute -top-2 left-5 rounded-pill bg-white px-2 py-0.5 text-label font-semibold uppercase tracking-eyebrow text-ink shadow-card">
      {badgeLabel}
    </span>
  ) : null;

  // Days with a photo show it in the square tile; the rest keep the accent
  // square with the day's initial. Completed days dim the photo behind the tick.
  const image = imageForDay(name);
  const tile = image ? (
    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-control">
      <img src={image} alt="" aria-hidden className="h-full w-full object-cover" />
      {done && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/55">
          <DoneCheck inverted />
        </span>
      )}
    </div>
  ) : (
    <div
      className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-control ${
        isNext ? 'bg-white/15' : accent
      }`}
    >
      {done ? (
        <DoneCheck inverted={!!isNext} />
      ) : (
        <span className={`text-xl font-bold ${isNext ? 'text-white' : 'text-ink'}`}>
          {name[0]}
        </span>
      )}
    </div>
  );

  const row = (
    <>
      {tile}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold tracking-tight">{name}</span>
          {tag && (
            <span
              className={`rounded-pill px-2 py-0.5 text-label font-semibold uppercase tracking-eyebrow ${
                isNext ? 'bg-white/15 text-white/90' : 'bg-line text-muted'
              }`}
            >
              {tag}
            </span>
          )}
        </div>
        <div
          className={`mt-0.5 truncate text-sm ${
            isNext ? 'text-white/65' : 'text-muted'
          }`}
        >
          {bodyParts}
        </div>
      </div>
      <div
        className={`flex items-center gap-1 text-sm ${
          isNext ? 'text-white/65' : 'text-muted'
        }`}
      >
        {exerciseCount != null && (
          <span className="font-medium">
            {exercisePosition != null ? (
              <>
                <span className={isNext ? 'text-white' : 'text-ink'}>{exercisePosition}</span>
                {`-${exerciseCount}`}
              </>
            ) : (
              exerciseCount
            )}
          </span>
        )}
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path
            d="M6 4L10 8L6 12"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </>
  );

  return (
    <button
      onClick={onClick}
      className={`pressable group relative flex w-full items-center gap-4 rounded-card p-5 text-left transition-transform ${surface} ${
        done && !isNext ? 'opacity-70' : ''
      }`}
    >
      {badge}
      {row}
    </button>
  );
}

function DoneCheck({ inverted }: { inverted: boolean }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 22 22"
      fill="none"
      aria-label="Completed this week"
      className={inverted ? 'text-white' : 'text-ink'}
    >
      <path
        d="M5 11.5l4 4 8-9"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
