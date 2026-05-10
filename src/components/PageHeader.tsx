interface Props {
  title: string;
  onBack?: () => void;
  rightAction?: React.ReactNode;
}

export function PageHeader({ title, onBack, rightAction }: Props) {
  return (
    <div className="relative flex h-11 items-center justify-center">
      {onBack && (
        <button
          onClick={onBack}
          className="absolute left-0 -ml-2 flex h-11 w-11 items-center justify-center rounded-full text-ink active:bg-line/60"
          aria-label="Back"
        >
          <BackIcon />
        </button>
      )}
      <div className="text-[17px] font-semibold leading-none tracking-[-0.02em] text-ink">
        {title}
      </div>
      {rightAction && <div className="absolute right-0 -mr-2">{rightAction}</div>}
    </div>
  );
}

function BackIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path
        d="M15 5l-7 7 7 7"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
