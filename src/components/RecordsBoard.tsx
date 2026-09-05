import { useMemo, useState, type ReactNode } from 'react';
import { groupByBodyPart, recordAchievedAt, type LiftRecord } from '../lib/records';
import { fromKgFor } from '../lib/units';

// Your best ever, on every movement you've logged — the body of the
// Performance tab.
//
// The point is permanence: starting a new plan resets what the logger
// pre-fills, and none of that touches what's here. "The most I've ever
// benched" should be one tap away forever. Tapping a row opens that lift's
// history underneath it, so the board is also the way into the trend chart.

type SortMode = 'bodyPart' | 'recent' | 'heaviest';

/** A record set inside this window gets a "New" flag. */
const NEW_RECORD_DAYS = 30;

interface Props {
  records: LiftRecord[];
  /** The record whose history is open, if any. */
  expanded: string | null;
  onToggle: (normalizedName: string) => void;
  /** Rendered under the expanded row. */
  renderDetail: (record: LiftRecord) => ReactNode;
}

export function RecordsBoard({ records, expanded, onToggle, renderDetail }: Props) {
  const [sort, setSort] = useState<SortMode>('bodyPart');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return records;
    return records.filter((r) => r.displayName.toLowerCase().includes(q));
  }, [records, query]);

  const newCutoff = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - NEW_RECORD_DAYS);
    return d.toISOString();
  }, []);

  const sections = useMemo(() => {
    if (sort === 'bodyPart') return groupByBodyPart(filtered);
    if (sort === 'recent') {
      const rs = [...filtered].sort((a, b) =>
        recordAchievedAt(b).localeCompare(recordAchievedAt(a))
      );
      return [{ bodyPart: 'Most recent first', records: rs }];
    }
    const rs = [...filtered].sort(
      (a, b) => (b.heaviest?.weightKg ?? -1) - (a.heaviest?.weightKg ?? -1)
    );
    return [{ bodyPart: 'Heaviest first', records: rs }];
  }, [filtered, sort]);

  const newCount = useMemo(
    () => records.filter((r) => recordAchievedAt(r) >= newCutoff).length,
    [records, newCutoff]
  );

  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
        Personal records
      </div>
      <p className="mt-1 text-sm text-muted">
        Your best ever on {records.length} {records.length === 1 ? 'movement' : 'movements'}
        {newCount > 0 && (
          <>
            {' '}
            ·{' '}
            <span className="font-semibold text-ink">{newCount} new in the last month</span>
          </>
        )}
        . Kept forever — a new plan never clears these. Tap one for its history.
      </p>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search a movement"
        aria-label="Search your records"
        className="mt-3 w-full rounded-pill border border-line bg-paper-card px-4 py-2.5 text-sm text-ink placeholder:text-muted focus:border-ink focus:outline-none"
      />

      <div className="mt-3 flex gap-1.5">
        <SortPill active={sort === 'bodyPart'} onClick={() => setSort('bodyPart')}>
          Body part
        </SortPill>
        <SortPill active={sort === 'heaviest'} onClick={() => setSort('heaviest')}>
          Heaviest
        </SortPill>
        <SortPill active={sort === 'recent'} onClick={() => setSort('recent')}>
          Recent
        </SortPill>
      </div>

      {filtered.length === 0 ? (
        <p className="mt-8 text-center text-sm text-muted">
          Nothing matches “{query.trim()}”.
        </p>
      ) : (
        <div className="mt-5 space-y-6">
          {sections.map((section) => (
            <div key={section.bodyPart}>
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                {section.bodyPart}
              </div>
              <ul className="mt-2 divide-y divide-line/60 overflow-hidden rounded-card bg-paper-card shadow-card">
                {section.records.map((r) => {
                  const open = expanded === r.normalizedName;
                  return (
                    <li key={r.normalizedName}>
                      <button
                        type="button"
                        onClick={() => onToggle(r.normalizedName)}
                        aria-expanded={open}
                        className="w-full text-left active:bg-line/30"
                      >
                        <RecordRow
                          record={r}
                          isNew={recordAchievedAt(r) >= newCutoff}
                          open={open}
                        />
                      </button>
                      {open && <div className="border-t border-line/60 px-5 pb-5 pt-1">{renderDetail(r)}</div>}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RecordRow({
  record,
  isNew,
  open,
}: {
  record: LiftRecord;
  isNew: boolean;
  open: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-ink">{record.displayName}</span>
          {isNew && (
            <span className="shrink-0 rounded-pill bg-ink px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
              New
            </span>
          )}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted">{subtitle(record)}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        <div className="text-right">
          <div className="whitespace-nowrap text-lg font-bold leading-tight tracking-tight text-ink tabular-nums">
            {headline(record)}
          </div>
          <div className="whitespace-nowrap text-[11px] text-muted tabular-nums">
            {headlineDetail(record)}
          </div>
        </div>
        <Chevron open={open} />
      </div>
    </div>
  );
}

/**
 * The one number this movement is remembered by, kept short so it can't crowd
 * the name out: the reps and the date go underneath it, not beside it.
 */
function headline(r: LiftRecord): string {
  if (r.kind === 'weighted' && r.heaviest) return formatLoad(r.heaviest.weightKg ?? 0, r.unit);
  if (r.kind === 'reps' && r.mostReps) return `${r.mostReps.reps} reps`;
  if (r.longestHold) return formatDuration(r.longestHold.holdSeconds ?? 0);
  return '–';
}

/** Under the headline: what it was done for, and when. */
function headlineDetail(r: LiftRecord): string {
  const when = formatDate(recordAchievedAt(r));
  if (r.kind === 'weighted' && r.heaviest) return `× ${r.heaviest.reps ?? 0} · ${when}`;
  return when;
}

/** The supporting line: estimated 1RM for a lift, context otherwise. */
function subtitle(r: LiftRecord): string {
  const setsLogged = `${r.totalSets} ${r.totalSets === 1 ? 'set' : 'sets'}`;
  if (r.kind === 'weighted' && r.best1RMkg > 0) {
    return `Est. 1RM ${formatLoad(r.best1RMkg, r.unit)} · ${setsLogged}`;
  }
  if (r.kind === 'reps') return `Bodyweight · ${setsLogged}`;
  if (r.kind === 'hold') return `Longest hold · ${setsLogged}`;
  return setsLogged;
}

/** Weight in the machine's own unit. Pin machines read as a pin number. */
function formatLoad(kg: number, unit: LiftRecord['unit']): string {
  const v = fromKgFor(kg, unit);
  const n = Math.round(v * 10) / 10;
  const text = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return unit === 'pin' ? `pin ${text}` : `${text} ${unit}`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

/** "28 Aug" this year, "28 Aug 2025" before that — the year only when it matters. */
function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

function SortPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-pill px-3 py-1.5 text-xs font-semibold ${
        active ? 'bg-ink text-white' : 'border border-line bg-paper-card text-muted'
      }`}
    >
      {children}
    </button>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
      aria-hidden="true"
    >
      <path
        d="M3.5 5.5L7 9l3.5-3.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
