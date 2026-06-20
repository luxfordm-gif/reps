import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from 'recharts';
import { PageHeader } from '../components/PageHeader';
import {
  loadPerformanceData,
  buildExerciseHistory,
  type PerformanceData,
  type ExerciseOption,
  type ExerciseHistoryPoint,
  type SessionSet,
  type MostImproved,
  type PersonalRecord,
} from '../lib/performanceApi';
import { findCloseMatch } from '../lib/stringSimilarity';
import {
  getLiftWeightUnit,
  getBodyWeightUnit,
  fromKgFor,
  kgToStoneLb,
  type LiftWeightUnit,
  type BodyWeightUnit,
} from '../lib/units';

export function Performance() {
  const [data, setData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [exercise, setExercise] = useState<string | null>(null);

  const liftUnit = getLiftWeightUnit();
  const bwUnit = getBodyWeightUnit();

  useEffect(() => {
    let mounted = true;
    loadPerformanceData()
      .then((d) => {
        if (!mounted) return;
        setData(d);
        setExercise(d.topExerciseNormalized);
      })
      .catch(() => mounted && setData(null))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, []);

  const hasAnyData = !!data && (data.sets.length > 0 || data.bodyWeights.length > 0);

  return (
    <div className="min-h-screen bg-paper pb-28">
      <style>{`@keyframes reps-rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}`}</style>
      <div
        className="mx-auto max-w-md px-5"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 44px)' }}
      >
        <PageHeader title="Performance" />

        {loading ? (
          <LoadingState />
        ) : !hasAnyData ? (
          <EmptyState />
        ) : (
          <div className="mt-2">
            {data!.mostImproved && (
              <Rise index={0}>
                <MostImprovedHero
                  mi={data!.mostImproved}
                  liftUnit={liftUnit}
                  onPick={setExercise}
                />
              </Rise>
            )}

            {data!.exerciseOptions.length > 0 && (
              <Rise index={1}>
                <ExerciseHistoryCard
                  data={data!}
                  exercise={exercise}
                  onExercise={setExercise}
                  liftUnit={liftUnit}
                />
              </Rise>
            )}

            {data!.bodyWeights.length > 0 && (
              <Rise index={2}>
                <BodyWeightCard rows={data!.bodyWeights} bwUnit={bwUnit} />
              </Rise>
            )}

            {data!.allTimeBests.length > 0 && (
              <Rise index={3}>
                <AllTimeBestsBoard
                  bests={data!.allTimeBests}
                  liftUnit={liftUnit}
                  onPick={setExercise}
                />
              </Rise>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Rise({ index, children }: { index: number; children: React.ReactNode }) {
  return (
    <div
      className="mt-7 first:mt-6"
      style={{ animation: 'reps-rise 420ms ease-out both', animationDelay: `${index * 70}ms` }}
    >
      {children}
    </div>
  );
}

// --- Most improved -------------------------------------------------------

function MostImprovedHero({
  mi,
  liftUnit,
  onPick,
}: {
  mi: MostImproved;
  liftUnit: LiftWeightUnit;
  onPick: (n: string) => void;
}) {
  const target = fromKgFor(mi.toKg, liftUnit);
  const counted = useCountUp(target);
  const deltaDisplay = fromKgFor(mi.deltaKg, liftUnit);

  const spark = mi.sparkline.map((p) => ({ v: fromKgFor(p.value, liftUnit) }));

  return (
    <button
      type="button"
      onClick={() => onPick(mi.normalizedName)}
      className="w-full rounded-card bg-ink p-5 text-left text-white shadow-[0_8px_24px_rgba(0,0,0,0.18)]"
    >
      <div className="text-xs font-semibold uppercase tracking-[0.12em] text-white/55">
        Most improved this month
      </div>
      <div className="mt-3 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="truncate text-lg font-semibold leading-tight">{mi.displayName}</div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-[40px] font-bold leading-none tracking-tight tabular-nums">
              {fmtNum(counted)}
            </span>
            <span className="text-base font-medium text-white/60">{liftUnit}</span>
          </div>
          <div className="mt-1.5 text-xs text-white/55">estimated 1RM</div>
        </div>
        {spark.length >= 2 && (
          <div className="h-12 w-28 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={spark} margin={{ top: 6, right: 2, bottom: 2, left: 2 }}>
                <Line
                  type="monotone"
                  dataKey="v"
                  stroke="#FFFFFF"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive
                  animationDuration={900}
                  animationEasing="ease-out"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
      <div className="mt-4 inline-flex items-center gap-1.5 rounded-pill bg-white/12 px-3 py-1 text-sm font-semibold">
        <ArrowUp />
        <span className="tabular-nums">
          +{fmtNum(deltaDisplay)} {liftUnit}
        </span>
        <span className="text-white/55">·</span>
        <span className="tabular-nums text-white/80">+{Math.round(mi.deltaPct)}%</span>
      </div>
    </button>
  );
}

// --- Exercise history ----------------------------------------------------

function ExerciseHistoryCard({
  data,
  exercise,
  onExercise,
  liftUnit,
}: {
  data: PerformanceData;
  exercise: string | null;
  onExercise: (n: string) => void;
  liftUnit: LiftWeightUnit;
}) {
  const history = useMemo(
    () => (exercise ? buildExerciseHistory(data.sets, exercise) : []),
    [data.sets, exercise]
  );

  const points = useMemo(
    () =>
      history
        .filter((p) => p.topWeightKg != null && p.repsAtTopWeight != null)
        .map((p) => ({
          label: p.date,
          weight: fromKgFor(p.topWeightKg!, liftUnit), // converted to display unit
          reps: p.repsAtTopWeight!, // raw count — never converted
        })),
    [history, liftUnit]
  );

  return (
    <div>
      <SectionLabel>Exercise history</SectionLabel>

      <div className="mt-3 rounded-card bg-paper-card p-4 shadow-card">
        <ExerciseCombobox value={exercise} options={data.exerciseOptions} onChange={onExercise} />

        {points.length < 2 ? (
          <div className="mt-4 flex h-[180px] items-center justify-center px-6 text-center text-sm text-muted">
            {points.length === 0
              ? 'No logged sets for this exercise yet.'
              : 'Just one session so far — keep logging to see your trend.'}
          </div>
        ) : (
          <DualAxisChart points={points} liftUnit={liftUnit} />
        )}
      </div>

      <SessionHistoryList history={history} liftUnit={liftUnit} />
    </div>
  );
}

function DualAxisChart({
  points,
  liftUnit,
}: {
  points: { label: string; weight: number; reps: number }[];
  liftUnit: LiftWeightUnit;
}) {
  return (
    <div className="mt-4">
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={points} margin={{ top: 8, right: 4, bottom: 0, left: -16 }}>
          <XAxis
            dataKey="label"
            tick={{ fill: '#8E8E93', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            minTickGap={24}
            tickFormatter={(d) =>
              new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
            }
          />
          <YAxis
            yAxisId="w"
            width={36}
            tick={{ fill: '#0A0A0A', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            domain={['dataMin - 2', 'dataMax + 2']}
            tickFormatter={(n) => String(Math.round(n))}
          />
          <YAxis
            yAxisId="r"
            orientation="right"
            width={28}
            tick={{ fill: '#9CA3AF', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
            domain={[0, 'dataMax + 1']}
          />
          <Tooltip
            contentStyle={{ borderRadius: 12, border: '1px solid #E5E5EA', fontSize: 12 }}
            labelFormatter={(d) =>
              new Date(d).toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })
            }
            formatter={(value, name) =>
              name === 'Top weight'
                ? [`${fmtNum(Number(value))} ${liftUnit}`, name]
                : [`${value} reps`, name]
            }
          />
          <Legend
            verticalAlign="top"
            height={24}
            iconType="plainline"
            wrapperStyle={{ fontSize: 11, color: '#8E8E93' }}
          />
          <Line
            yAxisId="w"
            name="Top weight"
            type="monotone"
            dataKey="weight"
            stroke="#0A0A0A"
            strokeWidth={2}
            dot={{ r: 2.5, fill: '#0A0A0A' }}
            activeDot={{ r: 4 }}
            isAnimationActive
            animationDuration={900}
            animationEasing="ease-out"
          />
          <Line
            yAxisId="r"
            name="Reps"
            type="monotone"
            dataKey="reps"
            stroke="#9CA3AF"
            strokeWidth={2}
            strokeDasharray="4 3"
            dot={{ r: 2, fill: '#9CA3AF' }}
            activeDot={{ r: 3.5 }}
            isAnimationActive
            animationDuration={900}
            animationEasing="ease-out"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function SessionHistoryList({
  history,
  liftUnit,
}: {
  history: ExerciseHistoryPoint[];
  liftUnit: LiftWeightUnit;
}) {
  if (history.length === 0) return null;
  const rows = [...history].reverse(); // newest first
  return (
    <div className="mt-7">
      <SectionLabel>History</SectionLabel>
      <ul className="mt-3 divide-y divide-line overflow-hidden rounded-card bg-paper-card shadow-card">
        {rows.map((p) => (
          <li key={p.date} className="px-5 py-3.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-semibold text-ink">
                {new Date(p.at).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </span>
              {p.bestEst1RMkg != null && (
                <span className="shrink-0 text-xs text-muted tabular-nums">
                  1RM {fmtNum(fromKgFor(p.bestEst1RMkg, liftUnit))} {liftUnit}
                </span>
              )}
            </div>
            <div className="mt-1 text-sm text-muted tabular-nums">
              {formatSets(p.sets, liftUnit)}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatSets(sets: SessionSet[], liftUnit: LiftWeightUnit): string {
  if (sets.length === 0) return 'No sets';
  return sets
    .map((s) => {
      const w = s.weightKg != null ? `${fmtNum(fromKgFor(s.weightKg, liftUnit))}${liftUnit}` : '—';
      const r = s.reps != null ? `${s.reps}` : '—'; // reps raw
      return `${w} × ${r}`;
    })
    .join(', ');
}

function ExerciseCombobox({
  value,
  options,
  onChange,
}: {
  value: string | null;
  options: ExerciseOption[];
  onChange: (n: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.normalizedName === value);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    const direct = options.filter((o) => o.displayName.toLowerCase().includes(q));
    if (direct.length > 0) return direct;
    const close = findCloseMatch(
      query,
      options.map((o) => ({ name: o.displayName, normalizedName: o.normalizedName }))
    );
    return close ? options.filter((o) => o.normalizedName === close.normalizedName) : [];
  }, [query, options]);

  function close() {
    setOpen(false);
    setQuery('');
  }

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  function pick(n: string) {
    onChange(n);
    close();
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        className="flex w-full items-center justify-between gap-2 rounded-pill bg-line px-4 py-2 text-left"
      >
        <span className="truncate text-sm font-semibold text-ink">
          {selected?.displayName ?? 'Select an exercise'}
        </span>
        <Chevron open={open} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-10 mt-2 overflow-hidden rounded-card bg-paper-card shadow-card ring-1 ring-line">
          <div className="border-b border-line p-2">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') close();
                if (e.key === 'Enter' && results[0]) pick(results[0].normalizedName);
              }}
              placeholder="Search exercises…"
              className="w-full rounded-pill bg-paper px-3 py-1.5 text-sm text-ink placeholder:text-muted focus:outline-none"
            />
          </div>
          <ul className="max-h-64 overflow-auto py-1">
            {results.length === 0 ? (
              <li className="px-4 py-3 text-sm text-muted">No matches</li>
            ) : (
              results.map((o) => (
                <li key={o.normalizedName}>
                  <button
                    type="button"
                    onClick={() => pick(o.normalizedName)}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm ${
                      o.normalizedName === value
                        ? 'font-semibold text-ink'
                        : 'font-medium text-ink'
                    }`}
                  >
                    <span className="truncate">{o.displayName}</span>
                    <span className="shrink-0 text-xs text-muted tabular-nums">{o.setCount}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

// --- Body weight ---------------------------------------------------------

function BodyWeightCard({
  rows,
  bwUnit,
}: {
  rows: PerformanceData['bodyWeights'];
  bwUnit: BodyWeightUnit;
}) {
  const points = useMemo(
    () =>
      [...rows].reverse().map((r) => ({
        label: r.recorded_on,
        value: bwUnit === 'kg' ? r.weight_kg : toDecimalStones(r.weight_kg),
      })),
    [rows, bwUnit]
  );

  return (
    <div>
      <SectionLabel>Body weight</SectionLabel>
      <div className="mt-3 rounded-card bg-paper-card p-4 shadow-card">
        {points.length < 2 ? (
          <div className="flex h-[140px] items-center justify-center px-6 text-center text-sm text-muted">
            Log your body weight on more days to see the trend.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
              <XAxis
                dataKey="label"
                tick={{ fill: '#8E8E93', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                minTickGap={24}
                tickFormatter={(d) =>
                  new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                }
              />
              <YAxis
                tick={{ fill: '#8E8E93', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={40}
                domain={['dataMin - 1', 'dataMax + 1']}
                tickFormatter={(n) => fmtNum(Number(n))}
              />
              <Tooltip
                contentStyle={{ borderRadius: 12, border: '1px solid #E5E5EA', fontSize: 12 }}
                formatter={(v) => [`${fmtNum(Number(v))} ${bwUnit}`, 'Body weight']}
                labelFormatter={(d) =>
                  new Date(d).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })
                }
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#0A0A0A"
                strokeWidth={2}
                dot={{ r: 2.5, fill: '#0A0A0A' }}
                activeDot={{ r: 4 }}
                isAnimationActive
                animationDuration={900}
                animationEasing="ease-out"
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// --- All-time bests ------------------------------------------------------

function AllTimeBestsBoard({
  bests,
  liftUnit,
  onPick,
}: {
  bests: PersonalRecord[];
  liftUnit: LiftWeightUnit;
  onPick: (n: string) => void;
}) {
  return (
    <div>
      <SectionLabel>All-time bests</SectionLabel>
      <ul className="mt-3 divide-y divide-line overflow-hidden rounded-card bg-paper-card shadow-card">
        {bests.map((r) => (
          <li key={r.normalizedName}>
            <button
              type="button"
              onClick={() => onPick(r.normalizedName)}
              className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-ink">{r.displayName}</div>
                <div className="mt-0.5 text-xs text-muted">
                  1RM {fmtNum(fromKgFor(r.best1RMkg, liftUnit))} {liftUnit} ·{' '}
                  {new Date(r.achievedAt).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-base font-bold tracking-tight text-ink tabular-nums">
                  {fmtNum(fromKgFor(r.bestWeightKg, liftUnit))} {liftUnit}
                </div>
                <div className="text-xs text-muted">× {r.bestWeightReps}</div>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- States --------------------------------------------------------------

function LoadingState() {
  return (
    <div className="mt-6 space-y-7">
      <div className="h-28 animate-pulse rounded-card bg-paper-card shadow-card" />
      <div className="h-[232px] animate-pulse rounded-card bg-paper-card shadow-card" />
      <div className="h-40 animate-pulse rounded-card bg-paper-card shadow-card" />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mt-12 rounded-card bg-paper-card p-8 text-center shadow-card">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-paper text-muted">
        <svg width="24" height="24" viewBox="0 0 22 22" fill="none">
          <path
            d="M3 17l5-5 4 4 7-8"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <p className="mt-4 text-sm font-semibold text-ink">No progress to show yet</p>
      <p className="mt-1 text-sm text-muted">
        Log your first workout to start tracking PRs, estimated 1RM, and your strength trend.
      </p>
    </div>
  );
}

// --- Helpers -------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{children}</div>
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

function ArrowUp() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M7 11V3M7 3L3.5 6.5M7 3l3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function toDecimalStones(kg: number): number {
  const { stones, pounds } = kgToStoneLb(kg);
  return stones + pounds / 14;
}

function fmtNum(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function useCountUp(target: number, durationMs = 900): number {
  const [val, setVal] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const from = fromRef.current;
    let raf = 0;
    let start = 0;
    const step = (ts: number) => {
      if (!start) start = ts;
      const t = Math.min(1, (ts - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = from + (target - from) * eased;
      setVal(next);
      if (t < 1) raf = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return val;
}
