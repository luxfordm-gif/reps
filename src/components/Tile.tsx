import type { ReactNode } from 'react';

// The dashboard tile, shared by the Performance tab and the workout-complete
// screen: a round icon chip, a short label, one big number, and a hint under
// it. Both are "how did that go?" surfaces, so they read as one system — the
// numbers you see at the end of a session look the same as the numbers you
// come back to on the Performance tab.

export function Tile({
  icon,
  label,
  value,
  hint,
  visual,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  /** A node, not just a string, so a unit can be set smaller than its number. */
  value: ReactNode;
  hint?: string;
  visual?: ReactNode;
  onClick?: () => void;
}) {
  // Icon above the words, not beside them: at phone width two tiles share
  // ~330px, and an icon column left the label with room for "Body wei…".
  const body = (
    <>
      <div className="flex items-center justify-between">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-paper text-ink">
          {icon}
        </div>
        {onClick && <ChevronRight />}
      </div>
      <div className="mt-3 truncate text-sm text-ink">{label}</div>
      <div className="mt-0.5 whitespace-nowrap text-[26px] font-bold leading-none tracking-tight text-ink tabular-nums">
        {value}
      </div>
      {hint && <div className="mt-1 truncate text-xs text-muted">{hint}</div>}
      {visual && <div className="mt-3">{visual}</div>}
    </>
  );
  const cls = 'rounded-card bg-paper-card p-4 shadow-card';
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} w-full text-left active:bg-line/30`}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** The unit that trails a tile value, sized to sit under it rather than shout. */
export function TileUnit({ children }: { children: ReactNode }) {
  return <span className="ml-1 text-base font-semibold text-muted">{children}</span>;
}

export function ChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="shrink-0 text-muted">
      <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BarsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M4 14V9M9 14V4M14 14v-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function BoltIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M10 2L4 10h5l-1 6 6-8h-5l1-6Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export function DumbbellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M6 9h6M3 7v4M5 6v6M13 6v6M15 7v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
