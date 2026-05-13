import { useEffect, useState } from 'react';

interface Props {
  title: string;
  onBack?: () => void;
  rightAction?: React.ReactNode;
}

export function PageHeader({ title, onBack, rightAction }: Props) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 4);
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div
      className={`sticky top-0 z-20 -mx-5 bg-paper transition-shadow ${
        scrolled ? 'shadow-[0_1px_2px_rgba(0,0,0,0.06)] after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-line/60' : ''
      }`}
    >
      <div className="relative flex h-11 items-center justify-center px-5">
        {onBack && (
          <button
            onClick={onBack}
            className="absolute left-3 flex h-11 w-11 items-center justify-center rounded-full text-ink active:bg-line/60"
            aria-label="Back"
          >
            <BackIcon />
          </button>
        )}
        <div className="text-[17px] font-semibold leading-none tracking-[-0.02em] text-ink">
          {title}
        </div>
        {rightAction && <div className="absolute right-3">{rightAction}</div>}
      </div>
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
