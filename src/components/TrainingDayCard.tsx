interface Props {
  name: string;
  bodyParts: string;
  exerciseCount: number;
  accent: string;
  isNext?: boolean;
  done?: boolean;
  onClick?: () => void;
}

export function TrainingDayCard({
  name,
  bodyParts,
  exerciseCount,
  accent,
  isNext,
  done,
  onClick,
}: Props) {
  return (
    <button
      onClick={onClick}
      className={`group relative flex w-full items-center gap-4 rounded-card p-5 text-left transition-transform active:scale-[0.99] ${
        isNext
          ? 'bg-ink text-white shadow-[0_8px_24px_rgba(0,0,0,0.18)]'
          : 'bg-paper-card text-ink shadow-card'
      } ${done && !isNext ? 'opacity-70' : ''}`}
    >
      {isNext && (
        <span className="absolute -top-2 left-5 rounded-pill bg-white px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink shadow-card">
          Up next
        </span>
      )}
      <div
        className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${
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
      <div className="min-w-0 flex-1">
        <div className="text-xl font-bold tracking-tight">{name}</div>
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
