import { useEffect, useMemo, useState } from 'react';
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
import { RecordsBoard } from '../components/RecordsBoard';
import {
  loadPerformanceData,
  buildExerciseHistory,
  type PerformanceData,
  type ExerciseHistoryPoint,
  type SessionSet,
} from '../lib/performanceApi';
import { loadRecords, type LiftRecord } from '../lib/recordsApi';
import {
  getBodyWeightUnit,
  fromKgFor,
  kgToStoneLb,
  type BodyWeightUnit,
  type MachineUnit,
} from '../lib/units';

// The Performance tab: body weight up top, then your personal records, with
// each lift's history a tap away underneath its record.
//
// This used to be four separate cards — most improved, an exercise picker with
// a chart, body weight, and a top-eight bests list. The records board does the
// job of three of them better: every movement, searchable, sorted how you want,
// and the chart appears where you'd look for it, under the lift it belongs to.

export function Performance() {
  const [data, setData] = useState<PerformanceData | null>(null);
  const [records, setRecords] = useState<LiftRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const bwUnit = getBodyWeightUnit();

  useEffect(() => {
    let mounted = true;
    Promise.all([loadPerformanceData(), loadRecords()])
      .then(([d, rs]) => {
        if (!mounted) return;
        setData(d);
        setRecords(rs);
      })
      .catch(() => mounted && setData(null))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, []);

  const hasAnyData = records.length > 0 || (data?.bodyWeights.length ?? 0) > 0;

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
            {data && data.bodyWeights.length > 0 && (
              <Rise index={0}>
                <BodyWeightCard rows={data.bodyWeights} bwUnit={bwUnit} />
              </Rise>
            )}

            {records.length > 0 && (
              <Rise index={1}>
                <RecordsBoard
                  records={records}
                  expanded={expanded}
                  onToggle={(n) => setExpanded((cur) => (cur === n ? null : n))}
                  renderDetail={(r) => <LiftHistory sets={data?.sets ?? []} record={r} />}
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

// --- One lift's history, under its record ---------------------------------

function LiftHistory({ sets, record }: { sets: PerformanceData['sets']; record: LiftRecord }) {
  const history = useMemo(
    () => buildExerciseHistory(sets, record.normalizedName),
    [sets, record.normalizedName]
  );
  const points = useMemo(
    () =>
      history
        .filter((p) => p.topWeightKg != null && p.repsAtTopWeight != null)
        .map((p) => ({
          label: p.date,
          weight: fromKgFor(p.topWeightKg!, record.unit), // converted to display unit
          reps: p.repsAtTopWeight!, // raw count — never converted
        })),
    [history, record.unit]
  );

  // Reps-only and hold records have no weight to chart; the list still shows
  // every session.
  if (record.kind !== 'weighted') {
    return <SessionHistoryList history={history} unit={record.unit} compact />;
  }

  return (
    <div>
      {points.length < 2 ? (
        <div className="flex h-[120px] items-center justify-center px-6 text-center text-sm text-muted">
          {points.length === 0
            ? 'No weighted sets logged for this yet.'
            : 'Just one session so far — keep logging to see the trend.'}
        </div>
      ) : (
        <DualAxisChart points={points} unitLabel={record.unit} />
      )}
      <SessionHistoryList history={history} unit={record.unit} compact />
    </div>
  );
}

// --- Chart -------------------------------------------------------------------

function DualAxisChart({
  points,
  unitLabel,
}: {
  points: { label: string; weight: number; reps: number }[];
  unitLabel: string;
}) {
  return (
    <div className="mt-4">
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={points} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
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
                ? [`${fmtNum(Number(value))} ${unitLabel}`, name]
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

// --- Session list --------------------------------------------------------------

function SessionHistoryList({
  history,
  unit,
  compact = false,
}: {
  history: ExerciseHistoryPoint[];
  unit: MachineUnit;
  /** Under a record row: tighter, and no section label. */
  compact?: boolean;
}) {
  if (history.length === 0) return null;
  const rows = [...history].reverse(); // newest first
  return (
    <div className={compact ? 'mt-3' : 'mt-7'}>
      {!compact && <SectionLabel>History</SectionLabel>}
      <ul
        className={
          compact
            ? 'divide-y divide-line/60'
            : 'mt-3 divide-y divide-line overflow-hidden rounded-card bg-paper-card shadow-card'
        }
      >
        {rows.map((p) => (
          <li key={p.date} className={compact ? 'py-3' : 'px-5 py-3.5'}>
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
                  1RM {fmtNum(fromKgFor(p.bestEst1RMkg, unit))} {unit}
                </span>
              )}
            </div>
            <div className="mt-1 text-sm text-muted tabular-nums">
              {formatSets(p.sets, unit)}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatSets(sets: SessionSet[], unit: MachineUnit): string {
  if (sets.length === 0) return 'No sets';
  return sets
    .map((s) => {
      const w = s.weightKg != null ? `${fmtNum(fromKgFor(s.weightKg, unit))}${unit}` : '—';
      const r = s.reps != null ? `${s.reps}` : '—'; // reps raw
      return `${w} × ${r}`;
    })
    .join(', ');
}

// --- Body weight ---------------------------------------------------------------

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
            <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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

// --- States --------------------------------------------------------------------

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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{children}</div>
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
