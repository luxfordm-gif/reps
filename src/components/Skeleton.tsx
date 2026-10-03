/**
 * The shape of a list that hasn't arrived yet.
 *
 * Five screens answered a slow fetch with the word "Loading…" in grey, which
 * on one bar of signal sits there for ten seconds looking like the screen has
 * given up. Home, Performance and the end-of-workout recap already draw the
 * outline of what's coming instead; these are that outline for the list
 * screens, so the rows land in the space held for them rather than replacing
 * a line of text and shoving everything under it down.
 *
 * A pulse, not a spinner: a fade is allowed under reduced motion (see
 * index.css), and it says "still coming" without a part that spins.
 */

function Bar({ className }: { className: string }) {
  return <div className={`rounded-pill bg-line/70 ${className}`} />;
}

/** One card of divided rows — the history lists, the machines list. */
export function SkeletonRows({ rows = 4, className = '' }: { rows?: number; className?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={`animate-pulse divide-y divide-line overflow-hidden rounded-card bg-paper-card shadow-card ${className}`}
    >
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center justify-between px-5 py-4">
          <div>
            <Bar className="h-3.5 w-28" />
            <Bar className="mt-2 h-3 w-20" />
          </div>
          <Bar className="h-5 w-12" />
        </div>
      ))}
    </div>
  );
}

/**
 * Stacked cards, each a title over a line of detail — the workout history,
 * the plans list. `tall` adds the eyebrow and button a plan card carries.
 */
export function SkeletonCards({
  count = 3,
  tall = false,
  className = '',
}: {
  count?: number;
  tall?: boolean;
  className?: string;
}) {
  return (
    <div role="status" aria-label="Loading" className={`animate-pulse space-y-3 ${className}`}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-card bg-paper-card shadow-card">
          <div className={tall ? 'p-5' : 'px-5 py-4'}>
            {tall && <Bar className="mb-2.5 h-2.5 w-24" />}
            <Bar className="h-4 w-36" />
            <Bar className="mt-2 h-3 w-48" />
            {tall && <Bar className="mt-5 h-10 w-full" />}
          </div>
        </div>
      ))}
    </div>
  );
}
