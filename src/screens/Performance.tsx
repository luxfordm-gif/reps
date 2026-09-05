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
  buildWeeklySeries,
  type PerformanceData,
  type ExerciseHistoryPoint,
  type SessionSet,
} from '../lib/performanceApi';
import { loadRecords, type LiftRecord } from '../lib/recordsApi';
import { getActivePlan, weeksOnPlan, type FullPlan } from '../lib/plansApi';
import { buildDaySlots } from '../lib/daySlots';
import {
  getThisWeekSummary,
  listCompletedSessions,
  type CompletedSessionSummary,
  type WeekSummary,
} from '../lib/sessionsApi';
import {
  bodyWeightRange,
  computeConsistency,
  computeMostImproved,
  computeOverallStrength,
  computeWorkoutsPerWeek,
  newRecordCount,
  summarizeBodyWeight,
  weekDots,
} from '../lib/dashboard';
import {
  getBodyWeightUnit,
  getLiftWeightUnit,
  fromKgFor,
  kgToStoneLb,
  formatStoneLb,
  type BodyWeightUnit,
  type MachineUnit,
} from '../lib/units';

// The Performance tab.
//
// A dashboard first: where you are on the plan, what's changed this month,
// body weight, how consistently you've turned up, and whether you're getting
// stronger — each as a tile with one number and the picture behind it. Every
// figure comes from lib/dashboard.ts, which says "not enough data" rather than
// invent a number. "View all" on the records tile opens the full records board,
// which is where a lift's history lives.

type View = 'dashboard' | 'records';
type BwRange = 84 | 182 | 365;

interface Loaded {
  perf: PerformanceData;
  records: LiftRecord[];
  plan: FullPlan | null;
  sessions: CompletedSessionSummary[];
  week: WeekSummary;
}

const EMPTY_WEEK: WeekSummary = {
  workoutsDone: 0,
  bars: [[], [], [], [], [], [], []],
  dayDetails: [[], [], [], [], [], [], []],
};

/** Each source fails on its own; one missing table must not blank the tab. */
async function loadAll(): Promise<Loaded> {
  const [perf, records, plan, sessions, week] = await Promise.all([
    loadPerformanceData().catch(() => ({ sets: [], bodyWeights: [] })),
    loadRecords().catch(() => []),
    getActivePlan().catch(() => null),
    listCompletedSessions().catch(() => []),
    getThisWeekSummary().catch(() => EMPTY_WEEK),
  ]);
  return { perf, records, plan, sessions, week };
}

export function Performance() {
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('dashboard');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [bwRange, setBwRange] = useState<BwRange>(84);
  const bwUnit = getBodyWeightUnit();
  const liftUnit = getLiftWeightUnit();

  useEffect(() => {
    let mounted = true;
    loadAll()
      .then((d) => mounted && setData(d))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, []);

  const derived = useMemo(() => {
    if (!data) return null;
    const { perf, records, plan, sessions, week } = data;
    const activatedAt = plan?.activated_at ?? null;
    const slots = plan ? buildDaySlots(plan.training_days) : [];
    // The gym days per week: what Home counts towards the weekly target.
    const weeklyTarget = slots.filter(
      (s) => s.name !== 'Abs' && !s.variants.every((v) => v.reference_only === true)
    ).length;
    const mostImproved = computeMostImproved(perf.sets);
    return {
      weeklyTarget,
      consistency: computeConsistency(sessions, activatedAt, weeklyTarget),
      perWeek: computeWorkoutsPerWeek(sessions, activatedAt),
      strength: computeOverallStrength(perf.sets, activatedAt),
      mostImproved,
      mostImprovedSeries: mostImproved
        ? buildWeeklySeries(perf.sets, 'est1rm', { normalizedName: mostImproved.normalizedName })
        : [],
      bodyWeight: summarizeBodyWeight(perf.bodyWeights, activatedAt),
      newPrs: newRecordCount(records),
      dots: weekDots(week.bars),
      topRecords: records.filter((r) => r.kind === 'weighted').slice(0, 3),
    };
  }, [data]);

  const hasAnyData =
    !!data &&
    (data.records.length > 0 || data.perf.bodyWeights.length > 0 || data.sessions.length > 0 || !!data.plan);

  if (view === 'records' && data) {
    return (
      <div className="min-h-screen bg-paper pb-28">
        <div
          className="mx-auto max-w-md px-5"
          style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0px)' }}
        >
          <PageHeader title="All-time records" onBack={() => setView('dashboard')} />
          <div className="mt-4">
            <RecordsBoard
              records={data.records}
              expanded={expanded}
              onToggle={(n) => setExpanded((cur) => (cur === n ? null : n))}
              renderDetail={(r) => <LiftHistory sets={data.perf.sets} record={r} />}
            />
          </div>
        </div>
      </div>
    );
  }

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
        ) : !hasAnyData || !data || !derived ? (
          <EmptyState />
        ) : (
          <div className="mt-2 space-y-3">
            <Rise index={0}>
              <PlanHero
                plan={data.plan}
                done={data.week.workoutsDone}
                target={derived.weeklyTarget}
              />
            </Rise>

            <Rise index={1}>
              <div className="grid grid-cols-2 gap-3">
                <Tile
                  icon={<BarsIcon />}
                  label="New PRs"
                  value={String(derived.newPrs)}
                  hint="this month"
                  onClick={() => setView('records')}
                />
                <Tile
                  icon={<ScaleIcon />}
                  label="Body weight"
                  value={derived.bodyWeight ? formatBw(derived.bodyWeight.latestKg, bwUnit) : '–'}
                  hint={
                    derived.bodyWeight?.deltaKg != null
                      ? `${derived.bodyWeight.deltaKg > 0 ? '↑' : derived.bodyWeight.deltaKg < 0 ? '↓' : '·'} ${formatBwDelta(
                          Math.abs(derived.bodyWeight.deltaKg),
                          bwUnit
                        )} ${derived.bodyWeight.since === 'plan' ? 'this plan' : 'overall'}`
                      : 'no change yet'
                  }
                />
              </div>
            </Rise>

            {data.perf.bodyWeights.length > 0 && (
              <Rise index={2}>
                <BodyWeightCard
                  rows={bodyWeightRange(data.perf.bodyWeights, bwRange).slice().reverse()}
                  bwUnit={bwUnit}
                  controls={
                    <div className="flex rounded-pill bg-line/60 p-0.5">
                      {([84, 182, 365] as BwRange[]).map((r) => (
                        <button
                          key={r}
                          onClick={() => setBwRange(r)}
                          className={`rounded-pill px-2.5 py-1 text-[11px] font-semibold ${
                            bwRange === r ? 'bg-ink text-white' : 'text-muted'
                          }`}
                        >
                          {r === 84 ? '12w' : r === 182 ? '6m' : '1y'}
                        </button>
                      ))}
                    </div>
                  }
                />
              </Rise>
            )}

            <Rise index={3}>
              <div className="grid grid-cols-2 gap-3">
                <Tile
                  icon={<CalendarIcon />}
                  label="Consistency"
                  value={derived.consistency.pct != null ? `${derived.consistency.pct}%` : '–'}
                  hint={
                    derived.consistency.pct != null
                      ? `${derived.consistency.done} of ${derived.consistency.planned} planned`
                      : 'needs an active plan'
                  }
                  visual={<DotRow dots={derived.dots} />}
                />
                <Tile
                  icon={<BoltIcon />}
                  label="Workouts / week"
                  value={derived.perWeek.average != null ? String(derived.perWeek.average) : '–'}
                  hint={derived.perWeek.average != null ? 'avg on this plan' : 'nothing logged yet'}
                  visual={<MiniBars values={derived.perWeek.weekly} />}
                />
              </div>
            </Rise>

            <Rise index={4}>
              <StrengthCard strength={derived.strength} />
            </Rise>

            {derived.mostImproved && (
              <Rise index={5}>
                <MostImprovedCard
                  mi={derived.mostImproved}
                  series={derived.mostImprovedSeries.map((p) => p.value)}
                  unit={liftUnit}
                />
              </Rise>
            )}

            {derived.topRecords.length > 0 && (
              <Rise index={6}>
                <TopRecords records={derived.topRecords} onViewAll={() => setView('records')} />
              </Rise>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Tiles ---------------------------------------------------------------------------

function PlanHero({ plan, done, target }: { plan: FullPlan | null; done: number; target: number }) {
  if (!plan) {
    return (
      <div className="rounded-card bg-ink p-5 text-white shadow-card">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/60">
          Current plan
        </div>
        <div className="mt-1 text-xl font-bold tracking-tight">No active plan</div>
        <div className="mt-0.5 text-sm text-white/70">Upload one from your profile to start tracking.</div>
      </div>
    );
  }
  const week = weeksOnPlan(plan.activated_at);
  const pct = target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0;
  return (
    <div className="rounded-card bg-ink p-5 text-white shadow-card">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/60">
            Current plan
          </div>
          <div className="mt-1 text-[34px] font-bold leading-none tracking-tight">Week {week}</div>
          <div className="mt-2 text-sm text-white/70">
            {week === 1 ? 'First week on plan' : `${week} weeks on plan`}
          </div>
          <div className="truncate text-sm text-white/70">{plan.name}</div>
        </div>
        {target > 0 && (
          <div className="w-32 shrink-0 pt-1 text-right">
            <div className="text-sm font-semibold tabular-nums">
              {done} of {target} this week
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-pill bg-white/20">
              <div className="h-full rounded-pill bg-white" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Tile({
  icon,
  label,
  value,
  hint,
  visual,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  visual?: React.ReactNode;
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
      <div className="mt-1 truncate text-xs text-muted">{hint}</div>
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

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const TODAY_IDX = (new Date().getDay() + 6) % 7;

function DotRow({ dots }: { dots: boolean[] }) {
  return (
    <div className="flex justify-between">
      {dots.map((on, i) => (
        <div key={i} className="flex flex-col items-center gap-1">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              on ? 'bg-ink' : i > TODAY_IDX ? 'bg-line/60' : 'bg-line'
            }`}
          />
          <span className="text-[10px] text-muted">{DAY_LETTERS[i]}</span>
        </div>
      ))}
    </div>
  );
}

function MiniBars({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex h-8 items-end gap-1">
      {values.map((v, i) => (
        <div
          key={i}
          className={`flex-1 rounded-sm ${i === values.length - 1 ? 'bg-ink' : 'bg-ink/25'}`}
          style={{ height: `${Math.max(8, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

/** A small line with a soft fill under it. Values only; no axes. */
function Sparkline({ values, stroke, fill }: { values: number[]; stroke: string; fill: string }) {
  if (values.length < 2) return null;
  const w = 100;
  const h = 40;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * w,
    h - 4 - ((v - min) / span) * (h - 8),
  ]);
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${w},${h} L0,${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-full w-full" aria-hidden="true">
      <path d={area} fill={fill} />
      <path d={line} fill="none" stroke={stroke} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={1.6} fill={stroke} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}

function StrengthCard({ strength }: { strength: ReturnType<typeof computeOverallStrength> }) {
  const hint =
    strength.reason === 'no_plan'
      ? 'Needs an active plan'
      : strength.reason === 'too_early'
        ? 'Shows after four weeks on the plan'
        : strength.reason === 'too_few_lifts'
          ? 'Needs three lifts trained early and recently'
          : 'since starting this plan';
  return (
    <div className="rounded-card bg-paper-card p-4 shadow-card">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-paper text-ink">
          <DumbbellIcon />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm text-ink">Overall strength</div>
          <div className="mt-0.5 text-[26px] font-bold leading-none tracking-tight text-ink tabular-nums">
            {strength.pct != null ? `${strength.pct > 0 ? '+' : ''}${fmtNum(strength.pct)}%` : 'Not enough data yet'}
          </div>
          <div className="mt-1 text-xs text-muted">{hint}</div>
        </div>
        {strength.series.length >= 2 && (
          <div className="h-12 w-28 shrink-0">
            <Sparkline values={strength.series.map((p) => p.pct)} stroke="#0A0A0A" fill="rgba(10,10,10,0.08)" />
          </div>
        )}
      </div>
    </div>
  );
}

function MostImprovedCard({
  mi,
  series,
  unit,
}: {
  mi: NonNullable<ReturnType<typeof computeMostImproved>>;
  series: number[];
  unit: MachineUnit;
}) {
  return (
    <div className="rounded-card bg-ink p-5 text-white shadow-card">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/60">
        Most improved this month
      </div>
      <div className="mt-2 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold">{mi.displayName}</div>
          <div className="mt-1 text-[34px] font-bold leading-none tracking-tight tabular-nums">
            {fmtNum(fromKgFor(mi.toKg, unit))}
            <span className="ml-1 text-base font-semibold text-white/70">{unit}</span>
          </div>
          <div className="mt-1 text-xs text-white/60">estimated 1RM</div>
          <div className="mt-2 text-sm font-semibold tabular-nums">
            ↑ +{fmtNum(fromKgFor(mi.deltaKg, unit))} {unit} · +{fmtNum(mi.deltaPct)}%
          </div>
        </div>
        {series.length >= 2 && (
          <div className="h-16 w-32 shrink-0">
            <Sparkline values={series} stroke="#FFFFFF" fill="rgba(255,255,255,0.12)" />
          </div>
        )}
      </div>
    </div>
  );
}

function TopRecords({ records, onViewAll }: { records: LiftRecord[]; onViewAll: () => void }) {
  return (
    <div className="rounded-card bg-paper-card shadow-card">
      <div className="flex items-center justify-between px-5 pt-4">
        <div className="text-base font-bold tracking-tight text-ink">All-time records</div>
        <button
          type="button"
          onClick={onViewAll}
          className="flex items-center gap-1 text-sm text-muted active:text-ink"
        >
          View all <ChevronRight />
        </button>
      </div>
      <ul className="mt-2 divide-y divide-line/60">
        {records.map((r) => (
          <li key={r.normalizedName}>
            <button
              type="button"
              onClick={onViewAll}
              className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left active:bg-line/30"
            >
              <span className="min-w-0 truncate text-sm text-ink">{r.displayName}</span>
              <span className="flex shrink-0 items-center gap-2 text-sm font-semibold text-ink tabular-nums">
                {r.heaviest ? formatLoadShort(r.heaviest.weightKg ?? 0, r.unit) : '–'}
                <ChevronRight />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- Formatting -------------------------------------------------------------------------

function formatBw(kg: number, unit: BodyWeightUnit): string {
  return unit === 'st' ? formatStoneLb(kg) : `${fmtNum(kg)} kg`;
}

function formatBwDelta(kg: number, unit: BodyWeightUnit): string {
  if (unit === 'st') {
    const lb = Math.round(kg / 0.45359237 * 10) / 10;
    return `${fmtNum(lb)} lb`;
  }
  return `${fmtNum(kg)} kg`;
}

function formatLoadShort(kg: number, unit: MachineUnit): string {
  const v = fmtNum(fromKgFor(kg, unit));
  return unit === 'pin' ? `pin ${v}` : `${v} ${unit}`;
}

// --- Icons -------------------------------------------------------------------------------

function ChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="shrink-0 text-muted">
      <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function BarsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M4 14V9M9 14V4M14 14v-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function ScaleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="12" height="12" rx="3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6.5 7.5a2.5 2.5 0 0 1 5 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
function CalendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 8h12M6.5 2.5v3M11.5 2.5v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
function BoltIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M10 2L4 10h5l-1 6 6-8h-5l1-6Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
function DumbbellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M6 9h6M3 7v4M5 6v6M13 6v6M15 7v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
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
  controls,
}: {
  rows: PerformanceData['bodyWeights'];
  bwUnit: BodyWeightUnit;
  /** Rendered beside the label — the range pills. */
  controls?: React.ReactNode;
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
      <div className="flex items-center justify-between">
        <SectionLabel>Body weight</SectionLabel>
        {controls}
      </div>
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
