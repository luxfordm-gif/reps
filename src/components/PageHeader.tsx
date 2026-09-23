import { useEffect, useRef, useState } from 'react';

interface Props {
  title: string;
  onBack?: () => void;
  rightAction?: React.ReactNode;
  large?: boolean;
  // Optional element rendered flush below the header row, inside the sticky
  // wrapper. When provided, the 1px under-header divider is suppressed
  // because the slot is expected to provide its own visual seam.
  bottomSlot?: React.ReactNode;
}

export function PageHeader({ title, onBack, rightAction, large = true, bottomSlot }: Props) {
  const [collapsed, setCollapsed] = useState(!large);
  const largeTitleRef = useRef<HTMLHeadingElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);

  // Whether the large title has slid up behind the bar.
  //
  // This was an IntersectionObserver against a hard-coded `-44px` root
  // margin, and it had two faults. The observer reports once when you call
  // observe(), so on a screen whose content was still settling — fonts
  // loading, a long list measuring itself — that single reading could catch
  // the title before it had been laid out, latch collapsed, and leave the
  // small title sitting on top of the large one until something scrolled.
  // And 44 was the bar's height only where the status-bar inset was zero;
  // anywhere else the threshold was in the wrong place.
  //
  // Measuring the bar and reading the title's own position on each scroll is
  // both deterministic and self-correcting: whatever the layout does after
  // mount, the next frame puts it right.
  useEffect(() => {
    if (!large) {
      setCollapsed(true);
      return;
    }
    let frame = 0;
    const measure = () => {
      frame = 0;
      const el = largeTitleRef.current;
      if (!el) return;
      const barHeight = barRef.current?.getBoundingClientRect().height ?? 44;
      setCollapsed(el.getBoundingClientRect().bottom <= barHeight);
    };
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(measure);
    };
    measure();
    // A second pass once layout has settled, for the case the first reading
    // was taken too early.
    schedule();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
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
            className="text-display font-bold leading-tight tracking-title text-ink"
          >
            {title}
          </h1>
        )}
        <div
          className={`sticky top-0 z-20 -mx-5 -mt-11 transition-shadow ${
            collapsed
              ? 'bg-paper shadow-hairline after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-surface-strong'
              : 'pointer-events-none'
          }`}
        >
          <div className="relative flex h-11 items-center justify-center px-5">
            <div
              className={`text-nav font-semibold leading-none tracking-title text-ink transition-opacity duration-pop ease-snap ${
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
  const detailShadow = collapsed ? 'shadow-hairline' : '';
  const detailDivider =
    collapsed && !bottomSlot
      ? 'after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-surface-strong'
      : '';
  return (
    <>
      <div
        ref={barRef}
        className={`sticky top-0 z-20 -mx-5 bg-paper transition-shadow ${detailShadow} ${detailDivider}`}
        // The safe-area inset belongs here and nowhere else: the bar is what
        // sits under the status bar. Screens that also padded their own
        // container by it ended up with the gap twice over.
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="relative flex h-11 items-center justify-center px-5">
          {onBack && (
            <button
              onClick={onBack}
              className="pressable absolute left-2 flex h-11 w-11 items-center justify-center rounded-full text-ink active:bg-surface-strong"
              aria-label="Back"
            >
              <BackIcon />
            </button>
          )}
          <div
            className={`text-nav font-semibold leading-none tracking-title text-ink transition-opacity duration-pop ease-snap ${
              collapsed ? 'opacity-100' : 'opacity-0'
            }`}
          >
            {title}
          </div>
          {rightAction && <div className="absolute right-2">{rightAction}</div>}
        </div>
        {bottomSlot}
      </div>
      {large && (
        <h1
          ref={largeTitleRef}
          className="mt-1 text-display font-bold leading-tight tracking-title text-ink"
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
