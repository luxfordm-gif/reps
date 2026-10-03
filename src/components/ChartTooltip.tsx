import type { ChartNote } from '../lib/chartTheme';

/**
 * The tooltip, passed as `content` to a recharts <Tooltip>.
 *
 * Dark, like the pills and the tab bar, so it reads as the app's own rather
 * than the library's. Recharts clones the element with `active` and `payload`
 * filled in; the functions turn the point under the finger into words.
 */
export function ChartTooltip<P>({
  active,
  payload,
  title,
  value,
  note,
}: {
  active?: boolean;
  payload?: { payload: P }[];
  /** The line above the number — usually the date. */
  title: (point: P) => string;
  /** The number, with its unit. */
  value: (point: P) => string;
  /** An optional third line: a change since last time, say. */
  note?: (point: P) => ChartNote | null;
}) {
  const point = payload?.[0]?.payload;
  if (!active || point == null) return null;
  const n = note?.(point) ?? null;
  return (
    <div className="rounded-control bg-ink px-3 py-2 shadow-lift">
      <div className="text-caption text-white/60">{title(point)}</div>
      <div className="mt-0.5 text-sm font-bold text-white tabular-nums">{value(point)}</div>
      {n && (
        <div
          className={`text-caption font-semibold tabular-nums ${
            n.tone === 'good'
              ? 'text-good-bright'
              : n.tone === 'bad'
                ? 'text-danger-bright'
                : 'text-white/60'
          }`}
        >
          {n.text}
        </div>
      )}
    </div>
  );
}
