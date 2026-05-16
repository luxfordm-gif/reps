import { useEffect, useRef, useState } from 'react';

interface Props {
  title: string;
  onBack?: () => void;
  rightAction?: React.ReactNode;
  large?: boolean;
}

export function PageHeader({ title, onBack, rightAction, large = true }: Props) {
  const [collapsed, setCollapsed] = useState(!large);
  const largeTitleRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    if (!large) {
      setCollapsed(true);
      return;
    }
    const el = largeTitleRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setCollapsed(!entry.isIntersecting),
      { rootMargin: '-44px 0px 0px 0px', threshold: 0 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [large]);

  const isTabHeader = !onBack && !rightAction;

  if (isTabHeader) {
    // Tab headers (Profile, Performance): the big title leads. The collapsed
    // sticky bar overlays the same row via -mt-11 so there's no ghost gap,
    // and only paints a background once the user has scrolled past the title.
    return (
      <>
        {large && (
          <h1
            ref={largeTitleRef}
            className="text-[34px] font-bold leading-tight tracking-[-0.02em] text-ink"
          >
            {title}
          </h1>
        )}
        <div
          className={`sticky top-0 z-20 -mx-5 -mt-11 transition-shadow ${
            collapsed
              ? 'bg-paper shadow-[0_1px_2px_rgba(0,0,0,0.06)] after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-line/60'
              : 'pointer-events-none'
          }`}
        >
          <div className="relative flex h-11 items-center justify-center px-5">
            <div
              className={`text-[17px] font-semibold leading-none tracking-[-0.02em] text-ink transition-opacity duration-150 ${
                collapsed ? 'opacity-100' : 'opacity-0'
              }`}
            >
              {title}
            </div>
          </div>
        </div>
      </>
    );
  }

  // Detail screens (DayView, ExerciseLogger, Plans, …): the sticky bar is
  // always visible because it carries the back button + right action. The
  // big title sits below it.
  return (
    <>
      <div
        className={`sticky top-0 z-20 -mx-5 bg-paper transition-shadow ${
          collapsed
            ? 'shadow-[0_1px_2px_rgba(0,0,0,0.06)] after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-line/60'
            : ''
        }`}
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="relative flex h-11 items-center justify-center px-5">
          {onBack && (
            <button
              onClick={onBack}
              className="absolute left-2 flex h-11 w-11 items-center justify-center rounded-full text-ink active:bg-line/60"
              aria-label="Back"
            >
              <BackIcon />
            </button>
          )}
          <div
            className={`text-[17px] font-semibold leading-none tracking-[-0.02em] text-ink transition-opacity duration-150 ${
              collapsed ? 'opacity-100' : 'opacity-0'
            }`}
          >
            {title}
          </div>
          {rightAction && <div className="absolute right-2">{rightAction}</div>}
        </div>
      </div>
      {large && (
        <h1
          ref={largeTitleRef}
          className="mt-2 text-[34px] font-bold leading-tight tracking-[-0.02em] text-ink"
        >
          {title}
        </h1>
      )}
    </>
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
