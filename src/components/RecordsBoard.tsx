import { useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { groupByBodyPart, recordAchievedAt, type LiftRecord } from '../lib/records';
import { fromKgFor } from '../lib/units';
import ExerciseName from './ExerciseName';

// Every movement you've ever logged — the library behind the Performance
// tab's "See all".
//
// The point is permanence: starting a new plan resets what the logger
// pre-fills, and none of that touches what's here. "The most I've ever
// benched" should be one tap away forever. Tapping a row opens that lift's
// own screen, so the board is also the way into the trend chart.
//
// It is a reference work, so it is organised like one: sectioned by body
// part with a jump bar across the top, a search, and three other orders to
// ask for. The Performance tab used to open onto this, which was the wrong
// landing — a report answers a question, an index waits for one.

type SortMode = 'bodyPart' | 'improved' | 'latest' | 'heaviest';

const SORTS: { key: SortMode; label: string }[] = [
  { key: 'bodyPart', label: 'Body part' },
  { key: 'improved', label: 'Top increased' },
  { key: 'latest', label: 'Latest' },
  { key: 'heaviest', label: 'Heaviest' },
];

/** The "no body part chosen" sentinel, kept out of the real body-part names. */
const ALL = '__all__';

/** A record set inside this window gets a "New" flag. */
const NEW_RECORD_DAYS = 30;

interface Props {
  records: LiftRecord[];
  /** Open a movement's own screen. */
  onSelect: (normalizedName: string) => void;
  /**
   * Recent change in estimated 1RM per movement, for the "Top increased"
   * order. Passed in rather than computed here: the Performance tab has
   * already worked it out for its movers list, and a second pass over every
   * set ever logged to sort a list would be wasteful. Movements missing from
   * the map sort last — no reading is not a reading of zero.
   */
  improvement?: Map<string, number>;
  /**
   * How many separate days each movement has been trained on. Orders a body
   * part's list by how much of your training it accounts for, and holds back
   * the movements with a single session behind them. Omit it and nothing is
   * hidden or reordered.
   */
  sessions?: Map<string, number>;
}

export function RecordsBoard({ records, onSelect, improvement, sessions }: Props) {
  const [sort, setSort] = useState<SortMode>('bodyPart');
  const [bodyPart, setBodyPart] = useState<string>(ALL);
  const [query, setQuery] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  // Body parts the reader has opened. Everything starts shut: a hundred
  // records over ten body parts is a page you scroll past rather than read,
  // and as an index of ten headings it fits on one screen.
  const [openParts, setOpenParts] = useState<Set<string>>(() => new Set());
  const [showSingles, setShowSingles] = useState(false);

  const searching = query.trim().length > 0;

  /** Movements with one session behind them, which are held back by default. */
  const singles = useMemo(() => {
    if (!sessions) return new Set<string>();
    return new Set(
      records.filter((r) => sessions.get(r.normalizedName) === 1).map((r) => r.normalizedName),
    );
  }, [records, sessions]);

  function toggle(part: string) {
    setOpenParts((prev) => {
      const next = new Set(prev);
      if (next.has(part)) next.delete(part);
      else next.add(part);
      return next;
    });
  }

  /** Every body part present, in the order the sections would appear. */
  const bodyParts = useMemo(
    () => groupByBodyPart(records).map((g) => g.bodyPart),
    [records],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return records.filter((r) => {
      if (bodyPart !== ALL && (r.bodyPart?.trim() || 'Other') !== bodyPart) return false;
      // A search is a question about one movement, so it looks everywhere —
      // including at the one-off you're trying to remember the name of.
      if (!q && !showSingles && singles.has(r.normalizedName)) return false;
      return !q || r.displayName.toLowerCase().includes(q);
    });
  }, [records, query, bodyPart, showSingles, singles]);

  const filtersOn = sort !== 'bodyPart' || bodyPart !== ALL;

  const newCutoff = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - NEW_RECORD_DAYS);
    return d.toISOString();
  }, []);

  const sections = useMemo(() => {
    if (sort === 'bodyPart') {
      // Within a body part, most-trained first. Heaviest-first put a calf
      // raise above a row because the plates say so; what you want at the top
      // of Back is the movement Back actually consists of. Ties break on the
      // heaviest lift, then the name, so the order is stable.
      const often = (r: LiftRecord) => sessions?.get(r.normalizedName) ?? 0;
      return groupByBodyPart(filtered).map((g) => ({
        ...g,
        records: [...g.records].sort(
          (a, b) =>
            often(b) - often(a) ||
            (b.heaviest?.weightKg ?? -1) - (a.heaviest?.weightKg ?? -1) ||
            a.displayName.localeCompare(b.displayName),
        ),
      }));
    }
    if (sort === 'latest') {
      // lastLoggedAt, not recordAchievedAt: "what did I train most recently"
      // is a different and more useful question than "which record did I set
      // most recently", and it's the one this pill is named after.
      const rs = [...filtered].sort((a, b) => b.lastLoggedAt.localeCompare(a.lastLoggedAt));
      return [{ bodyPart: 'Trained most recently', records: rs }];
    }
    if (sort === 'improved') {
      const score = (r: LiftRecord) => improvement?.get(r.normalizedName) ?? -Infinity;
      const rs = [...filtered].sort(
        (a, b) => score(b) - score(a) || a.displayName.localeCompare(b.displayName),
      );
      return [{ bodyPart: 'Biggest gains', records: rs }];
    }
    const rs = [...filtered].sort(
      (a, b) => (b.heaviest?.weightKg ?? -1) - (a.heaviest?.weightKg ?? -1),
    );
    return [{ bodyPart: 'Heaviest first', records: rs }];
  }, [filtered, sort, improvement, sessions]);

  const newCount = useMemo(
    () => records.filter((r) => recordAchievedAt(r) >= newCutoff).length,
    [records, newCutoff],
  );

  return (
    <div>
      {/* Two figures rather than a paragraph. The old copy explained that
          records are kept across plans before the reader had reached a single
          record — true, but not what they came here for. */}
      <p className="text-sm text-muted">
        <span className="font-semibold text-ink">{records.length}</span> all-time{' '}
        {records.length === 1 ? 'record' : 'records'}
        {newCount > 0 && (
          <>
            {' · '}
            <span className="font-semibold text-ink">{newCount}</span> set this month
          </>
        )}
      </p>

      {/* Search and one button. This carried two rows of pills — four sort
          options, then a chip per body part — which is eleven controls above
          the first record on a phone. The orders and the body parts are the
          same kind of choice, so they belong in the same place, and that
          place is behind a control rather than in front of the content. */}
      <div className="mt-3 flex items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a movement"
          aria-label="Search your records"
          className="min-w-0 flex-1 rounded-pill border border-line bg-paper-card px-4 py-2.5 text-sm text-ink placeholder:text-muted focus:border-ink focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-label="Sort and filter"
          aria-haspopup="dialog"
          className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border active:bg-pressed ${
            filtersOn ? 'border-ink bg-ink text-white' : 'border-line bg-paper-card text-ink'
          }`}
        >
          <FilterIcon />
        </button>
      </div>

      {/* What's on, when anything is — so a filtered list never looks like an
          empty one, and can be undone without opening the sheet again. */}
      {filtersOn && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {bodyPart !== ALL && (
            <FilterChip onClear={() => setBodyPart(ALL)}>{bodyPart}</FilterChip>
          )}
          {sort !== 'bodyPart' && (
            <FilterChip onClear={() => setSort('bodyPart')}>
              {SORTS.find((o) => o.key === sort)?.label}
            </FilterChip>
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="mt-8 text-center text-sm text-muted">Nothing matches “{query.trim()}”.</p>
      ) : (
        <div className="mt-5 space-y-3">
          {sections.map((section) => {
            // Only the body-part view collapses. The other orders are one
            // list under a heading that names the order, and a collapsed
            // "Heaviest first" is a page with nothing on it.
            const collapsible = sort === 'bodyPart';
            const open = !collapsible || searching || openParts.has(section.bodyPart);
            return (
              <div key={section.bodyPart}>
                {collapsible ? (
                  <button
                    type="button"
                    onClick={() => toggle(section.bodyPart)}
                    aria-expanded={open}
                    className="flex w-full items-center gap-2 rounded-panel px-1 py-2.5 text-left active:bg-surface"
                  >
                    <Chevron open={open} />
                    <span className="flex-1 truncate text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                      {section.bodyPart}
                    </span>
                    <span className="text-xs font-semibold text-muted tabular-nums">
                      {section.records.length}
                    </span>
                  </button>
                ) : (
                  <div className="px-1 py-2.5 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                    {section.bodyPart}
                  </div>
                )}
                {open && (
                  <ul className="mt-1 divide-y divide-line/60 overflow-hidden rounded-card bg-paper-card shadow-card">
                    {section.records.map((r) => (
                      <li key={r.normalizedName}>
                        <button
                          type="button"
                          onClick={() => onSelect(r.normalizedName)}
                          className="w-full text-left active:bg-surface"
                        >
                          <RecordRow record={r} isNew={recordAchievedAt(r) >= newCutoff} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Held-back movements are said out loud and can be let back in. A
          record that silently isn't there is worse than a short list. */}
      {!searching && singles.size > 0 && (
        <button
          type="button"
          onClick={() => setShowSingles((v) => !v)}
          className="mt-5 w-full text-center text-sm text-muted active:text-ink"
        >
          {showSingles
            ? 'Hide the ones trained once'
            : `${singles.size} trained once · show`}
        </button>
      )}

      {/* Portalled to the body. The sheet is fixed and z-50, which ought to
          clear the tab bar's z-40 — but the screen sits inside App's
          `.tab-fade` wrapper, and an element with a filling opacity animation
          keeps a stacking context, which traps the z-50 inside it. The bar,
          a sibling of that wrapper, then paints over the sheet. Escaping to
          the body sidesteps it, and keeps sidestepping it if anything above
          this ever gains a transform. */}
      {sheetOpen &&
        createPortal(
          <FilterSheet
            sort={sort}
            onSort={setSort}
            bodyPart={bodyPart}
            bodyParts={bodyParts}
            onBodyPart={setBodyPart}
            onClose={() => setSheetOpen(false)}
          />,
          document.body,
        )}
    </div>
  );
}

/**
 * Sort and body part, in one sheet.
 *
 * Both are "show me a different slice of the same list", so they're one
 * decision made in one place. It closes on a choice rather than needing an
 * Apply: there's nothing here that's wrong until confirmed, and the list
 * behind it is the confirmation.
 */
function FilterSheet({
  sort,
  onSort,
  bodyPart,
  bodyParts,
  onBodyPart,
  onClose,
}: {
  sort: SortMode;
  onSort: (s: SortMode) => void;
  bodyPart: string;
  bodyParts: string[];
  onBodyPart: (b: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="backdrop-in fixed inset-0 z-50 flex items-end justify-center bg-ink/50 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Sort and filter"
    >
      <div
        className="sheet-in max-h-[80vh] w-full max-w-md overflow-y-auto rounded-t-card bg-paper-card p-6"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold tracking-tight text-ink">Sort and filter</h2>

        <div className="mt-5 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
          Order
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SORTS.map((o) => (
            <SortPill
              key={o.key}
              active={sort === o.key}
              onClick={() => {
                onSort(o.key);
                onClose();
              }}
            >
              {o.label}
            </SortPill>
          ))}
        </div>

        {bodyParts.length > 1 && (
          <>
            <div className="mt-6 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
              Body part
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <SortPill
                active={bodyPart === ALL}
                onClick={() => {
                  onBodyPart(ALL);
                  onClose();
                }}
              >
                All
              </SortPill>
              {bodyParts.map((b) => (
                <SortPill
                  key={b}
                  active={bodyPart === b}
                  onClick={() => {
                    onBodyPart(b);
                    onClose();
                  }}
                >
                  {b}
                </SortPill>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** What's currently narrowing the list, and the way to stop it. */
function FilterChip({ children, onClear }: { children: ReactNode; onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={onClear}
      className="flex items-center gap-1.5 rounded-pill bg-ink px-3 py-1.5 text-xs font-semibold text-white active:bg-ink-soft"
    >
      {children}
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
        <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
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
      aria-hidden="true"
      className={`shrink-0 text-muted transition-transform duration-pop ease-snap ${
        open ? 'rotate-90' : ''
      }`}
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

function FilterIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M2.5 4.5h13M4.5 9h9M7 13.5h4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function RecordRow({ record, isNew }: { record: LiftRecord; isNew: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-ink">
            <ExerciseName name={record.displayName} variant="inline" />
          </span>
          {isNew && (
            <span className="shrink-0 rounded-pill bg-ink px-1.5 py-0.5 text-label font-bold uppercase tracking-wider text-white">
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
          <div className="whitespace-nowrap text-caption text-muted tabular-nums">
            {headlineDetail(record)}
          </div>
        </div>
        <ChevronRight />
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

function ChevronRight() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className="shrink-0 text-muted"
    >
      <path
        d="M6 3.5L10.5 8 6 12.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
