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
          className="absolute left-0 flex h-9 w-9 items-center justify-center rounded-full active:bg-line"
          aria-label="Back"
        >
          <BackIcon />
        </button>
      )}
      <div className="text-base font-semibold text-ink">{title}</div>
      {rightAction && <div className="absolute right-0">{rightAction}</div>}
    </div>
  );
}

function BackIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <path
        d="M14 4l-7 7 7 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
