import { imageForDay } from '../lib/dayImages';

interface Props {
  name: string;
  bodyParts: string;
  exerciseCount: number;
  accent: string;
  // Small pill after the title — "Week 2" on a rotating day, "Home" on the abs
  // reference card.
  tag?: string | null;
  isNext?: boolean;
  done?: boolean;
  onClick?: () => void;
  /**
   * Start the workout directly, skipping the day overview. Renders a Start
   * pill under the content row — only the Home hero passes this. Buttons can't
   * nest, so its presence turns the card root into a div.
   */
  onStart?: () => void;
}

export function TrainingDayCard({
  name,
  bodyParts,
  exerciseCount,
  accent,
  tag,
  isNext,
  done,
  onClick,
  onStart,
}: Props) {
  const surface = isNext
    ? 'bg-ink text-white shadow-[0_8px_24px_rgba(0,0,0,0.18)]'
    : 'bg-paper-card text-ink shadow-card';

  const badge = isNext ? (
    <span className="absolute -top-2 left-5 rounded-pill bg-white px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink shadow-card">
      Up next
    </span>
  ) : null;

  // Days with a photo show it in the square tile; the rest keep the accent
  // square with the day's initial. Completed days dim the photo behind the tick.
  const image = imageForDay(name);
  const tile = image ? (
    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl">
      <img src={image} alt="" aria-hidden className="h-full w-full object-cover" />
      {done && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/55">
          <DoneCheck inverted />
        </span>
      )}
    </div>
  ) : (
    <div
      className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-xl ${
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
              className={`rounded-pill px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${
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
        <span className="font-medium">{exerciseCount}</span>
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

  // Buttons can't nest, so a card with a Start pill hosts two separate ones:
  // the row (overview) and the pill (straight into the first exercise).
  if (onStart) {
    return (
      <div className={`relative rounded-card p-5 ${surface}`}>
        {badge}
        <button
          onClick={onClick}
          className="group flex w-full items-center gap-4 text-left transition-transform duration-150 active:scale-[0.99]"
        >
          {row}
        </button>
        <button
          onClick={onStart}
          className={`mt-4 w-full rounded-pill py-3 text-sm font-semibold transition-transform duration-150 active:scale-[0.97] ${
            isNext ? 'bg-white text-ink' : 'bg-ink text-white'
          }`}
        >
          Start workout
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={onClick}
      className={`group relative flex w-full items-center gap-4 rounded-card p-5 text-left transition-transform active:scale-[0.99] ${surface} ${
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
