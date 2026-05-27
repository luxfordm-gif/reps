import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
import { PageHeader } from '../components/PageHeader';
import {
  loadPerformanceData,
  buildWeeklySeries,
  type PerformanceData,
  type TrendMetric,
  type MostImproved,
  type PersonalRecord,
} from '../lib/performanceApi';
import {
  getLiftWeightUnit,
  getBodyWeightUnit,
  fromKgFor,
  kgToLb,
  kgToStoneLb,
  type LiftWeightUnit,
  type BodyWeightUnit,
} from '../lib/units';

const METRICS: { id: TrendMetric; label: string }[] = [
  { id: 'est1rm', label: '1RM' },
  { id: 'volume', label: 'Volume' },
  { id: 'reps', label: 'Reps' },
  { id: 'bodyweight', label: 'Weight' },
];

export function Performance() {
  const [data, setData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [metric, setMetric] = useState<TrendMetric>('est1rm');
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
        // A new lifter with only body-weight logs lands on a useful default.
        if (d.exerciseOptions.length === 0 && d.bodyWeights.length > 0) {
          setMetric('bodyweight');
        }
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
                <MostImprovedHero mi={data!.mostImproved} liftUnit={liftUnit} />
              </Rise>
            )}

            <Rise index={1}>
              <TrendChartCard
                data={data!}
                metric={metric}
                onMetric={setMetric}
                exercise={exercise}
                onExercise={setExercise}
                liftUnit={liftUnit}
                bwUnit={bwUnit}
              />
            </Rise>

            {data!.allTimeBests.length > 0 && (
              <Rise index={2}>
                <AllTimeBestsBoard bests={data!.allTimeBests} liftUnit={liftUnit} />
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

function MostImprovedHero({ mi, liftUnit }: { mi: MostImproved; liftUnit: LiftWeightUnit }) {
  const target = fromKgFor(mi.toKg, liftUnit);
  const counted = useCountUp(target);
  const deltaDisplay = fromKgFor(mi.deltaKg, liftUnit);

  const spark = mi.sparkline.map((p) => ({ v: fromKgFor(p.value, liftUnit) }));

  return (
    <div className="rounded-card bg-ink p-5 text-white shadow-[0_8px_24px_rgba(0,0,0,0.18)]">
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
    </div>
  );
}

// --- Trend chart ---------------------------------------------------------

function TrendChartCard({
  data,
  metric,
  onMetric,
  exercise,
  onExercise,
  liftUnit,
  bwUnit,
}: {
  data: PerformanceData;
  metric: TrendMetric;
  onMetric: (m: TrendMetric) => void;
  exercise: string | null;
  onExercise: (n: string) => void;
  liftUnit: LiftWeightUnit;
  bwUnit: BodyWeightUnit;
}) {
  const perExercise = metric === 'est1rm' || metric === 'reps';

  const chartData = useMemo(() => {
    if (metric === 'bodyweight') {
      return [...data.bodyWeights].reverse().map((r) => ({
        label: r.recorded_on,
        value: bwUnit === 'kg' ? r.weight_kg : toDecimalStones(r.weight_kg),
        kg: r.weight_kg,
      }));
    }
    const series = buildWeeklySeries(data.sets, metric, {
      normalizedName: perExercise ? exercise ?? undefined : undefined,
    });
    return series.map((p) => ({
      label: p.weekStart,
      value: displayMetric(p.value, metric, liftUnit),
      kg: p.value,
    }));
  }, [data, metric, exercise, perExercise, liftUnit, bwUnit]);

  const unitLabel =
    metric === 'reps'
      ? 'reps'
      : metric === 'volume'
        ? `${liftUnit}·reps`
        : metric === 'bodyweight'
          ? bwUnit
          : liftUnit;

  const fromZero = metric === 'volume' || metric === 'reps';

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <SectionLabel>Trend</SectionLabel>
        {perExercise && data.exerciseOptions.length > 0 && (
          <ExerciseSelect value={exercise} options={data.exerciseOptions} onChange={onExercise} />
        )}
      </div>

      <div className="mt-3 rounded-card bg-paper-card p-4 shadow-card">
        <MetricToggle metric={metric} onChange={onMetric} />

        {chartData.length < 2 ? (
          <div className="flex h-[180px] items-center justify-center px-6 text-center text-sm text-muted">
            Not enough data yet — keep logging to see your trend.
          </div>
        ) : (
          <div className="mt-4">
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={chartData} margin={{ top: 10, right: 8, bottom: 0, left: -12 }}>
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
                  domain={fromZero ? [0, 'dataMax'] : ['dataMin - 1', 'dataMax + 1']}
                  tickFormatter={compactAxis}
                />
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: '1px solid #E5E5EA', fontSize: 12 }}
                  formatter={(v) => [`${fmtNum(Number(v))} ${unitLabel}`, metricName(metric)]}
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
          </div>
        )}
      </div>
    </div>
  );
}

function MetricToggle({
  metric,
  onChange,
}: {
  metric: TrendMetric;
  onChange: (m: TrendMetric) => void;
}) {
  return (
    <div className="flex w-full rounded-pill bg-line p-0.5">
      {METRICS.map((m) => (
        <button
          key={m.id}
          onClick={() => onChange(m.id)}
          className={`flex-1 rounded-pill py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
            metric === m.id ? 'bg-ink text-white' : 'text-muted'
          }`}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

function ExerciseSelect({
  value,
  options,
  onChange,
}: {
  value: string | null;
  options: PerformanceData['exerciseOptions'];
  onChange: (n: string) => void;
}) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className="max-w-[55%] truncate rounded-pill bg-line px-3 py-1 text-xs font-semibold text-ink focus:outline-none"
    >
      {options.map((o) => (
        <option key={o.normalizedName} value={o.normalizedName}>
          {o.displayName}
        </option>
      ))}
    </select>
  );
}

// --- All-time bests ------------------------------------------------------

function AllTimeBestsBoard({
  bests,
  liftUnit,
}: {
  bests: PersonalRecord[];
  liftUnit: LiftWeightUnit;
}) {
  return (
    <div>
      <SectionLabel>All-time bests</SectionLabel>
      <ul className="mt-3 divide-y divide-line overflow-hidden rounded-card bg-paper-card shadow-card">
        {bests.map((r) => (
          <li key={r.normalizedName} className="flex items-center justify-between gap-3 px-5 py-4">
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

function displayMetric(kg: number, metric: TrendMetric, liftUnit: LiftWeightUnit): number {
  if (metric === 'reps') return kg;
  if (metric === 'volume') return liftUnit === 'lb' ? kgToLb(kg) : kg;
  // est1rm
  return fromKgFor(kg, liftUnit);
}

function metricName(metric: TrendMetric): string {
  switch (metric) {
    case 'est1rm':
      return 'Est. 1RM';
    case 'volume':
      return 'Volume';
    case 'reps':
      return 'Reps';
    case 'bodyweight':
      return 'Body weight';
  }
}

function fmtNum(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function compactAxis(n: number): string {
  if (Math.abs(n) >= 1000) {
    const k = n / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
  }
  return String(Math.round(n));
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
