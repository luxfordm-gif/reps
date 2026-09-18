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
  onClick,
}: {
  icon: ReactNode;
  label: string;
  /** A node, not just a string, so a unit can be set smaller than its number. */
  value: ReactNode;
  hint?: string;
  onClick?: () => void;
}) {
  // Icon above the words, not beside them: at phone width two tiles share
  // ~330px, and an icon column left the label with room for "Body wei…".
  //
  // Four lines, always, in this order — and deliberately nothing else. This
  // used to take a `visual` too, so one tile carried a row of dots, its
  // neighbour a bar chart and a third nothing at all, and a grid of them read
  // as a pile of separate designs. The fix isn't to give every tile a picture,
  // it's that a stat tile doesn't have one: a number and a line of context,
  // the same shape every time. Anything that needs a chart is a card of its
  // own, full width, where a chart can be read.
  //
  // The floor height is a minimum rather than a fixed height: at the largest
  // accessibility text sizes a fixed one clips the hint.
  const body = (
    <>
      <div className="flex items-center justify-between">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-paper text-ink">
          {icon}
        </div>
        {onClick && <ChevronRight />}
      </div>
      <div className="mt-3 truncate text-sm text-ink">{label}</div>
      <div className="mt-0.5 whitespace-nowrap text-2xl font-bold leading-none tracking-tight text-ink tabular-nums">
        {value}
      </div>
      {hint && <div className="mt-1 truncate text-xs text-muted">{hint}</div>}
    </>
  );
  const cls =
    'flex h-full min-h-[156px] flex-col rounded-card bg-paper-card p-4 text-left shadow-card';
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} w-full active:bg-surface`}>
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
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      className="shrink-0 text-muted"
    >
      <path
        d="M5 3l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BarsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M4 14V9M9 14V4M14 14v-3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function BoltIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M10 2L4 10h5l-1 6 6-8h-5l1-6Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DumbbellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M6 9h6M3 7v4M5 6v6M13 6v6M15 7v4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function WaterIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M 17.00 2.00 L 16.00 3.00 L 15.00 3.00 L 15.00 4.00 L 14.00 5.00 L 14.00 7.00 L 13.00 8.00 L 13.00 11.00 L 12.00 12.00 L 11.00 12.00 L 10.00 13.00 L 10.00 17.00 L 8.00 19.00 L 8.00 20.00 L 5.00 23.00 L 5.00 24.00 L 4.00 25.00 L 4.00 27.00 L 3.00 28.00 L 3.00 36.00 L 2.00 37.00 L 2.00 39.00 L 3.00 40.00 L 3.00 42.00 L 4.00 43.00 L 4.00 45.00 L 3.00 46.00 L 3.00 49.00 L 2.00 50.00 L 2.00 77.00 L 3.00 78.00 L 3.00 80.00 L 4.00 81.00 L 4.00 82.00 L 7.00 85.00 L 8.00 85.00 L 9.00 86.00 L 11.00 86.00 L 12.00 87.00 L 13.00 86.00 L 24.00 86.00 L 25.00 87.00 L 26.00 86.00 L 39.00 86.00 L 40.00 85.00 L 41.00 85.00 L 44.00 82.00 L 44.00 81.00 L 45.00 80.00 L 45.00 78.00 L 46.00 77.00 L 46.00 49.00 L 45.00 48.00 L 45.00 46.00 L 44.00 45.00 L 44.00 43.00 L 45.00 42.00 L 45.00 28.00 L 44.00 27.00 L 44.00 25.00 L 42.00 23.00 L 42.00 22.00 L 37.00 17.00 L 37.00 13.00 L 36.00 12.00 L 35.00 12.00 L 34.00 11.00 L 34.00 5.00 L 33.00 4.00 L 33.00 3.00 L 32.00 3.00 L 31.00 2.00 Z M 9.00 45.00 L 37.00 45.00 L 38.00 46.00 L 39.00 45.00 L 41.00 47.00 L 41.00 48.00 L 42.00 49.00 L 42.00 78.00 L 37.00 83.00 L 12.00 83.00 L 11.00 82.00 L 10.00 82.00 L 7.00 79.00 L 7.00 78.00 L 6.00 77.00 L 6.00 49.00 L 7.00 48.00 L 7.00 47.00 Z M 15.00 18.00 L 33.00 18.00 L 39.00 24.00 L 39.00 25.00 L 40.00 26.00 L 40.00 27.00 L 41.00 28.00 L 41.00 30.00 L 42.00 31.00 L 42.00 39.00 L 41.00 40.00 L 41.00 41.00 L 40.00 42.00 L 9.00 42.00 L 7.00 40.00 L 7.00 39.00 L 6.00 38.00 L 6.00 32.00 L 7.00 31.00 L 7.00 28.00 L 8.00 27.00 L 8.00 26.00 L 9.00 25.00 L 9.00 24.00 Z M 18.00 7.00 L 19.00 6.00 L 30.00 6.00 L 31.00 7.00 L 31.00 11.00 L 30.00 12.00 L 18.00 12.00 L 17.00 11.00 L 17.00 9.00 L 18.00 8.00 Z"
        fill="currentColor"
        fillRule="evenodd"
        stroke="currentColor"
        strokeWidth="2.922"
        strokeLinejoin="round"
        transform="translate(4.8078,1.3000) scale(0.171111)"
      />
    </svg>
  );
}

export function StepsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M 46.00 2.00 L 43.00 5.00 L 43.00 6.00 L 41.00 8.00 L 41.00 9.00 L 40.00 10.00 L 40.00 12.00 L 37.00 15.00 L 35.00 15.00 L 34.00 16.00 L 32.00 16.00 L 31.00 17.00 L 30.00 17.00 L 29.00 16.00 L 27.00 16.00 L 26.00 15.00 L 25.00 15.00 L 23.00 13.00 L 23.00 12.00 L 19.00 8.00 L 16.00 8.00 L 15.00 9.00 L 14.00 9.00 L 12.00 11.00 L 12.00 12.00 L 10.00 14.00 L 10.00 16.00 L 9.00 17.00 L 9.00 18.00 L 8.00 19.00 L 8.00 22.00 L 7.00 23.00 L 7.00 25.00 L 6.00 26.00 L 6.00 30.00 L 5.00 31.00 L 5.00 33.00 L 4.00 34.00 L 4.00 36.00 L 3.00 37.00 L 3.00 40.00 L 2.00 41.00 L 2.00 44.00 L 3.00 45.00 L 3.00 47.00 L 4.00 48.00 L 4.00 49.00 L 5.00 50.00 L 5.00 51.00 L 8.00 54.00 L 9.00 54.00 L 10.00 55.00 L 12.00 55.00 L 13.00 56.00 L 16.00 56.00 L 17.00 57.00 L 56.00 57.00 L 57.00 58.00 L 70.00 58.00 L 71.00 59.00 L 81.00 59.00 L 82.00 58.00 L 90.00 58.00 L 91.00 57.00 L 94.00 57.00 L 95.00 56.00 L 97.00 56.00 L 98.00 55.00 L 99.00 55.00 L 100.00 54.00 L 101.00 54.00 L 103.00 52.00 L 104.00 52.00 L 106.00 50.00 L 106.00 49.00 L 107.00 48.00 L 107.00 46.00 L 108.00 45.00 L 108.00 39.00 L 107.00 38.00 L 107.00 37.00 L 106.00 36.00 L 106.00 35.00 L 104.00 33.00 L 103.00 33.00 L 102.00 32.00 L 100.00 32.00 L 99.00 31.00 L 97.00 31.00 L 96.00 30.00 L 94.00 30.00 L 93.00 29.00 L 91.00 29.00 L 90.00 28.00 L 88.00 28.00 L 87.00 27.00 L 86.00 27.00 L 85.00 26.00 L 84.00 26.00 L 83.00 25.00 L 82.00 25.00 L 81.00 24.00 L 80.00 24.00 L 79.00 23.00 L 78.00 23.00 L 76.00 21.00 L 75.00 21.00 L 73.00 19.00 L 72.00 19.00 L 69.00 16.00 L 68.00 16.00 L 66.00 14.00 L 65.00 14.00 L 62.00 11.00 L 61.00 11.00 L 57.00 7.00 L 56.00 7.00 L 51.00 2.00 Z M 102.00 46.00 L 103.00 45.00 L 104.00 46.00 L 103.00 47.00 Z M 7.00 37.00 L 8.00 36.00 L 9.00 36.00 L 11.00 38.00 L 12.00 38.00 L 13.00 39.00 L 14.00 39.00 L 15.00 40.00 L 16.00 40.00 L 17.00 41.00 L 20.00 41.00 L 21.00 42.00 L 26.00 42.00 L 27.00 43.00 L 36.00 43.00 L 37.00 44.00 L 43.00 44.00 L 44.00 45.00 L 48.00 45.00 L 49.00 46.00 L 53.00 46.00 L 54.00 47.00 L 58.00 47.00 L 59.00 48.00 L 65.00 48.00 L 66.00 49.00 L 89.00 49.00 L 90.00 48.00 L 95.00 48.00 L 96.00 47.00 L 99.00 47.00 L 100.00 46.00 L 102.00 46.00 L 103.00 47.00 L 103.00 48.00 L 100.00 51.00 L 99.00 51.00 L 98.00 52.00 L 97.00 52.00 L 96.00 53.00 L 94.00 53.00 L 93.00 54.00 L 89.00 54.00 L 88.00 55.00 L 58.00 55.00 L 57.00 54.00 L 33.00 54.00 L 32.00 53.00 L 14.00 53.00 L 13.00 52.00 L 12.00 52.00 L 11.00 51.00 L 10.00 51.00 L 8.00 49.00 L 8.00 48.00 L 7.00 47.00 L 7.00 46.00 L 6.00 45.00 L 6.00 39.00 L 7.00 38.00 Z M 48.00 6.00 L 49.00 5.00 L 54.00 10.00 L 55.00 10.00 L 56.00 11.00 L 56.00 12.00 L 54.00 14.00 L 54.00 15.00 L 52.00 17.00 L 51.00 17.00 L 49.00 19.00 L 49.00 20.00 L 48.00 21.00 L 50.00 23.00 L 51.00 22.00 L 52.00 22.00 L 59.00 15.00 L 61.00 15.00 L 63.00 17.00 L 64.00 17.00 L 66.00 19.00 L 65.00 20.00 L 64.00 20.00 L 58.00 26.00 L 58.00 28.00 L 59.00 29.00 L 60.00 29.00 L 66.00 23.00 L 67.00 23.00 L 69.00 21.00 L 70.00 21.00 L 72.00 23.00 L 73.00 23.00 L 75.00 25.00 L 73.00 27.00 L 72.00 27.00 L 67.00 32.00 L 67.00 33.00 L 68.00 34.00 L 70.00 34.00 L 72.00 32.00 L 73.00 32.00 L 78.00 27.00 L 79.00 27.00 L 80.00 28.00 L 81.00 28.00 L 82.00 29.00 L 83.00 29.00 L 84.00 30.00 L 86.00 30.00 L 87.00 31.00 L 88.00 31.00 L 89.00 32.00 L 91.00 32.00 L 92.00 33.00 L 95.00 33.00 L 96.00 34.00 L 98.00 34.00 L 99.00 35.00 L 100.00 35.00 L 101.00 36.00 L 102.00 36.00 L 104.00 38.00 L 104.00 41.00 L 103.00 42.00 L 102.00 42.00 L 101.00 43.00 L 99.00 43.00 L 98.00 44.00 L 95.00 44.00 L 94.00 45.00 L 88.00 45.00 L 87.00 46.00 L 68.00 46.00 L 67.00 45.00 L 61.00 45.00 L 60.00 44.00 L 56.00 44.00 L 55.00 43.00 L 51.00 43.00 L 50.00 42.00 L 46.00 42.00 L 45.00 41.00 L 40.00 41.00 L 39.00 40.00 L 31.00 40.00 L 30.00 39.00 L 23.00 39.00 L 22.00 38.00 L 19.00 38.00 L 18.00 37.00 L 17.00 37.00 L 16.00 36.00 L 15.00 36.00 L 14.00 35.00 L 13.00 35.00 L 12.00 34.00 L 11.00 34.00 L 9.00 32.00 L 9.00 29.00 L 10.00 28.00 L 10.00 25.00 L 11.00 24.00 L 11.00 22.00 L 12.00 21.00 L 12.00 19.00 L 13.00 18.00 L 13.00 17.00 L 14.00 16.00 L 14.00 15.00 L 15.00 14.00 L 15.00 13.00 L 16.00 12.00 L 18.00 12.00 L 21.00 15.00 L 21.00 16.00 L 23.00 18.00 L 24.00 18.00 L 25.00 19.00 L 26.00 19.00 L 27.00 20.00 L 34.00 20.00 L 35.00 19.00 L 37.00 19.00 L 39.00 17.00 L 40.00 17.00 L 41.00 16.00 L 42.00 16.00 L 43.00 15.00 L 43.00 14.00 L 44.00 13.00 L 43.00 12.00 L 44.00 11.00 L 44.00 10.00 L 45.00 9.00 L 45.00 8.00 L 47.00 6.00 Z"
        fill="currentColor"
        fillRule="evenodd"
        stroke="currentColor"
        strokeWidth="3.426"
        strokeLinejoin="round"
        transform="translate(0.9000,4.4757) scale(0.145946)"
      />
    </svg>
  );
}
