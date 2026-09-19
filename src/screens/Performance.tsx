import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  LineChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from 'recharts';
import { PageHeader } from '../components/PageHeader';
import { MiniTile, ChevronRight, BoltIcon, WaterIcon, StepsIcon } from '../components/Tile';
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
import { recordAchievedAt } from '../lib/records';
import { listWaterSince, type WaterDay } from '../lib/waterApi';
import { listSteps, formatSteps, type StepRow } from '../lib/stepsApi';
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
  weekDailyAverage,
  weekStartISO,
  computeWeekStreak,
  computeWeeklyLoad,
  computeWeeklyIntensity,
  computeWorkoutsPerWeek,
  compareWeeks,
  compareWindow,
  summarizeBodyWeight,
  type WeekStreak,
  type WeeklyLoadPoint,
  type WeeklyIntensityPoint,
  type MoverComparison,
  type ExerciseMove,
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
// The job, which everything here is answerable to: in about five seconds,
// show whether the last week went better than the one before it — and be the
// way into any single exercise's history.
//
// The screen had no stated job for a long time, so it accumulated. At its
// widest it carried three separate lists of lifts (this week against last,
// most improved, all-time records), four charts, two hero cards and a
// paragraph under most figures. Three lists of lifts is one list: what's
// moving. The record book is a real thing to want and a bad thing to land
// on, so it lives one tap away behind "See all".
//
// Three rules hold the rest together:
//
//   Weight. A big number gets a card and the chart that explains it. A
//   supporting number gets a mini tile a third of the height.
//
//   Copy. A label names a number, it does not explain it — two words where
//   two will do, and never a sentence. A figure that needs a paragraph to be
//   trusted is the wrong figure. Charts carry no legend; tooltips can be as
//   wordy as they like, because they're asked for.
//
//   Depth. Any lift named anywhere opens its own history in one tap, from
//   wherever it was tapped. Nothing routes through an index on the way.
//
// Every figure comes from lib/dashboard.ts, which says "not enough data"
// rather than invent a number.

type View = 'dashboard' | 'records' | 'record';
type BwRange = 84 | 182 | 365;
/**
 * What the movers list is comparing against.
 *
 * Two named weeks, or a rolling eight — the plan runs on a fortnight's
 * rotation, so last week can be the wrong week to ask about, and over two
 * months which week it was stops mattering.
 */
type MoverPeriod = 'week' | 'fortnight' | 'season';

interface Loaded {
  perf: PerformanceData;
  records: LiftRecord[];
  plan: FullPlan | null;
  sessions: CompletedSessionSummary[];
  week: WeekSummary;
  water: WaterDay[];
  steps: StepRow[];
}

const EMPTY_WEEK: WeekSummary = {
  workoutsDone: 0,
  bars: [[], [], [], [], [], [], []],
  dayDetails: [[], [], [], [], [], [], []],
};

/** Each source fails on its own; one missing table must not blank the tab. */
async function loadAll(): Promise<Loaded> {
  // Only this week is needed for the habit averages, so the water query is
  // bounded rather than fetching a year to divide seven days by.
  const weekFrom = weekStartISO(new Date());
  const [perf, records, plan, sessions, week, water, steps] = await Promise.all([
    loadPerformanceData().catch(() => ({ sets: [], bodyWeights: [] })),
    loadRecords().catch(() => []),
    getActivePlan().catch(() => null),
    listCompletedSessions().catch(() => []),
    getThisWeekSummary().catch(() => EMPTY_WEEK),
    listWaterSince(weekFrom).catch(() => []),
    listSteps().catch(() => []),
  ]);
  return { perf, records, plan, sessions, week, water, steps };
}

export function Performance() {
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('dashboard');
  const [selected, setSelected] = useState<string | null>(null);
  // Where the open lift was tapped, so Back returns there. A lift reached from
  // the dashboard goes back to the dashboard; one reached from the board goes
  // back to the board. Without this every lift's Back led to the records
  // index, which is the screen you were trying not to visit.
  const [recordFrom, setRecordFrom] = useState<Exclude<View, 'record'>>('dashboard');
  const [bwRange, setBwRange] = useState<BwRange>(84);
  const [period, setPeriod] = useState<MoverPeriod>('week');
  const bwUnit = getBodyWeightUnit();
  const liftUnit = getLiftWeightUnit();

  // "View all" swaps the view inside the same tab, so without this the records
  // board opened wherever the dashboard had been scrolled to.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);

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
    const { perf, records, plan, sessions } = data;
    const activatedAt = plan?.activated_at ?? null;
    const slots = plan ? buildDaySlots(plan.training_days) : [];
    // The gym days per week: what Home counts towards the weekly target.
    const weeklyTarget = slots.filter(
      (s) => s.name !== 'Abs' && !s.variants.every((v) => v.reference_only === true),
    ).length;
    // A reference day (the home abs workout) isn't in the weekly target, so a
    // session marked done for it mustn't count towards it either.
    const referenceNames = new Set(
      (plan?.training_days ?? []).filter((d) => d.reference_only).map((d) => d.name),
    );
    const gymSessions = sessions.filter((s) => !referenceNames.has(s.day_name));
    return {
      weeklyTarget,
      streak: computeWeekStreak(gymSessions, weeklyTarget),
      water: weekDailyAverage(data.water.map((w) => ({ date: w.recorded_on, value: w.count }))),
      steps: weekDailyAverage(data.steps.map((r) => ({ date: r.recorded_on, value: r.steps }))),
      load: computeWeeklyLoad(perf.sets),
      intensity: computeWeeklyIntensity(perf.sets),
      perWeek: computeWorkoutsPerWeek(gymSessions, activatedAt),
      bodyWeight: summarizeBodyWeight(perf.bodyWeights, activatedAt),
      // Every lift that has ever been logged has a record, so this is what
      // decides whether a name anywhere on the tab is worth making tappable.
      recordNames: new Set(records.map((r) => r.normalizedName)),
    };
  }, [data]);

  // Its own memo rather than part of `derived`: the pills above it change what
  // is being compared, and nothing else on the tab should recompute for that.
  // Sessions are counted before the reference day is filtered out — this is
  // "what did I do", not "did I hit the plan".
  const movers = useMemo(() => {
    if (!data) return null;
    const { sets } = data.perf;
    if (period === 'season') return compareWindow(sets, data.sessions, 56);
    return compareWeeks(sets, data.sessions, period === 'fortnight' ? 2 : 1);
  }, [data, period]);

  // What the library's "Top increased" order sorts on. Built from the movers
  // the tab has already computed rather than by the board walking every set
  // again — and it follows the period pills, so the library agrees with the
  // list you came from.
  const improvement = useMemo(
    () => new Map((movers?.movers ?? []).map((m) => [m.normalizedName, m.deltaPct])),
    [movers],
  );

  // The lift at the top of the list gets the hero card, and a hero card gets a
  // graph. Scoped to that one lift, so it's the shape of its own progress
  // rather than the tab's.
  const leadSeries = useMemo(() => {
    const lead = movers?.movers[0];
    if (!data || !lead) return [];
    return buildWeeklySeries(data.perf.sets, 'est1rm', {
      normalizedName: lead.normalizedName,
    }).map((p) => p.value);
  }, [data, movers]);

  /** Open one lift's history. Ignored for a name with no record behind it. */
  function openRecord(normalizedName: string, from: Exclude<View, 'record'> = 'dashboard') {
    if (!derived?.recordNames.has(normalizedName)) return;
    setSelected(normalizedName);
    setRecordFrom(from);
    setView('record');
  }

  const hasAnyData =
    !!data &&
    (data.records.length > 0 ||
      data.perf.bodyWeights.length > 0 ||
      data.sessions.length > 0 ||
      !!data.plan);

  if (view === 'records' && data) {
    return (
      <div className="pb-nav min-h-screen bg-paper">
        <div
          className="mx-auto max-w-md px-5"
          style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0px)' }}
        >
          <PageHeader title="All-time records" onBack={() => setView('dashboard')} />
          <div className="mt-4">
            <RecordsBoard
              records={data.records}
              improvement={improvement}
              onSelect={(n) => openRecord(n, 'records')}
            />
          </div>
        </div>
      </div>
    );
  }

  if (view === 'record' && data) {
    const record = data.records.find((r) => r.normalizedName === selected) ?? null;
    if (record) {
      return (
        <RecordDetail
          record={record}
          sets={data.perf.sets}
          onBack={() => {
            setView(recordFrom);
            setSelected(null);
          }}
        />
      );
    }
  }

  return (
    <div className="pb-nav min-h-screen bg-paper">
      <div
        className="mx-auto max-w-md px-5"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 40px)' }}
      >
        <PageHeader title="Performance" />

        {loading ? (
          <LoadingState />
        ) : !hasAnyData || !data || !derived ? (
          <EmptyState />
        ) : (
          <div className="mt-2">
            <Block>
              <PlanHero
                plan={data.plan}
                done={data.week.workoutsDone}
                target={derived.weeklyTarget}
                streak={derived.streak}
              />
            </Block>

            {data.perf.bodyWeights.length > 0 && (
              <Block>
                <SectionHeader
                  title="Body weight"
                  controls={
                    <div className="flex rounded-pill bg-surface-strong p-0.5">
                      {([84, 182, 365] as BwRange[]).map((r) => (
                        <button
                          key={r}
                          onClick={() => setBwRange(r)}
                          className={`rounded-pill px-2.5 py-1 text-caption font-semibold ${
                            bwRange === r ? 'bg-ink text-white' : 'text-muted'
                          }`}
                        >
                          {r === 84 ? '12w' : r === 182 ? '6m' : '1y'}
                        </button>
                      ))}
                    </div>
                  }
                />
                <div className="mt-3">
                  <BodyWeightCard
                    rows={bodyWeightRange(data.perf.bodyWeights, bwRange).slice().reverse()}
                    bwUnit={bwUnit}
                    latestKg={derived.bodyWeight?.latestKg ?? null}
                    delta={
                      derived.bodyWeight?.deltaKg != null
                        ? `${derived.bodyWeight.deltaKg > 0 ? '↑' : derived.bodyWeight.deltaKg < 0 ? '↓' : '·'} ${formatBwDelta(
                            Math.abs(derived.bodyWeight.deltaKg),
                            bwUnit,
                          )}`
                        : null
                    }
                  />
                </div>
              </Block>
            )}

            {/* How often, and the two habits. Averaged over the days actually
                logged — see weekDailyAverage — so a well-tracked Tuesday and
                Wednesday don't read as a failed week. */}
            <Block>
              <div className="grid grid-cols-3 gap-2.5">
                <MiniTile
                  icon={<BoltIcon />}
                  label="Workouts"
                  value={derived.perWeek.average != null ? String(derived.perWeek.average) : '–'}
                  hint="a week"
                />
                <MiniTile
                  icon={<WaterIcon />}
                  label="Water"
                  value={
                    derived.water.average != null
                      ? String(Math.round(derived.water.average * 10) / 10)
                      : '–'
                  }
                  hint="a day"
                />
                <MiniTile
                  icon={<StepsIcon />}
                  label="Steps"
                  value={
                    derived.steps.average != null
                      ? formatSteps(Math.round(derived.steps.average))
                      : '–'
                  }
                  hint="a day"
                />
              </div>
            </Block>

            {derived.load.some((p) => p.sets > 0) && (
              <Block>
                <TrainingLoadCard load={derived.load} intensity={derived.intensity} />
              </Block>
            )}

            {movers && (
              <Block>
                <MoversCard
                  comparison={movers}
                  leadSeries={leadSeries}
                  period={period}
                  onPeriod={setPeriod}
                  unit={liftUnit}
                  canOpen={(n) => derived.recordNames.has(n)}
                  onOpen={(n) => openRecord(n)}
                  onSeeAll={() => setView('records')}
                />
              </Block>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Tiles ---------------------------------------------------------------------------

function PlanHero({
  plan,
  done,
  target,
  streak,
}: {
  plan: FullPlan | null;
  done: number;
  target: number;
  streak: WeekStreak;
}) {
  if (!plan) {
    return (
      <div className="rounded-card bg-ink p-5 text-white shadow-card">
        <div className="text-label font-semibold uppercase tracking-[0.14em] text-white/60">
          Current plan
        </div>
        <div className="mt-1 text-xl font-bold tracking-tight">No active plan</div>
        <div className="mt-0.5 text-sm text-white/70">Upload one from your profile.</div>
      </div>
    );
  }
  const week = weeksOnPlan(plan.activated_at);
  const pct = target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0;
  // The run, when there is one — otherwise the best there has been. A tile of
  // its own sat a 44px chip next to a short word and left half a row empty;
  // one line under the plan name says the same thing.
  const weeks = streak.current > 0 ? streak.current : streak.longest;
  return (
    <div className="rounded-card bg-ink p-5 text-white shadow-card">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-label font-semibold uppercase tracking-[0.14em] text-white/60">
            Current plan
          </div>
          <div className="mt-1 text-display font-bold leading-none tracking-tight">Week {week}</div>
          <div className="mt-2 truncate text-sm text-white/70">{plan.name}</div>
          {weeks > 0 && (
            <div className="mt-1.5 flex items-center gap-1 text-sm font-semibold tabular-nums">
              <span className="text-white/70">
                <FlameIcon />
              </span>
              {weeks} {weeks === 1 ? 'week' : 'weeks'}
              {streak.current === 0 && <span className="font-normal text-white/60">best</span>}
            </div>
          )}
        </div>
        {target > 0 && (
          <div className="w-28 shrink-0 pt-1 text-right">
            <div className="text-label font-semibold uppercase tracking-[0.14em] text-white/60">
              This week
            </div>
            <div className="mt-1 text-xl font-bold tabular-nums">
              {done} / {target}
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

/**
 * A section's name, on the page rather than inside the card.
 *
 * Used where a section has controls that act on the whole of it — the body
 * weight range, the movers period. Putting the heading and its pills above
 * the card says the controls govern everything below them, and gives the
 * screen a spine you can scan without reading a single number.
 */
function SectionHeader({
  title,
  controls,
  children,
}: {
  title: string;
  controls?: React.ReactNode;
  /** An optional short line under the title. Never a sentence. */
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-2xl font-bold tracking-tight text-ink">{title}</h2>
        {children && <div className="mt-0.5 text-sm text-muted tabular-nums">{children}</div>}
      </div>
      {controls && <div className="shrink-0 pb-1">{controls}</div>}
    </div>
  );
}

/**
 * Twelve weeks of training: how much, and how heavy.
 *
 * The only place on the tab that answers "how has it been going lately",
 * which is the question a chart is for — and the empty weeks are drawn,
 * because a month off is the most informative thing a season of training has
 * to say.
 *
 * Two series, because sets alone were being read as a verdict they can't
 * give: a week of heavy triples and a week of light high-rep work look
 * identical by set count, so a block that gets harder and shorter draws a line
 * going down. The bars are the volume of work; the line over them is how heavy
 * that work was against the window's own normal (computeWeeklyIntensity has
 * the arithmetic and the reason it's a percentage rather than a tonnage).
 */
function TrainingLoadCard({
  load,
  intensity,
}: {
  load: WeeklyLoadPoint[];
  intensity: WeeklyIntensityPoint[];
}) {
  const thisWeek = load[load.length - 1]?.sets ?? 0;
  const average = Math.round(load.reduce((sum, p) => sum + p.sets, 0) / load.length);
  const byWeek = new Map(intensity.map((p) => [p.weekStart, p]));
  const points = load.map((p) => ({
    label: p.weekStart,
    value: p.sets,
    intensity: byWeek.get(p.weekStart)?.pct ?? null,
  }));
  // The most recent week the figure could be computed for — not necessarily
  // this one, which on a Monday has nothing in it yet.
  const latestIntensity = [...intensity].reverse().find((p) => p.pct != null) ?? null;
  const hasIntensity = intensity.some((p) => p.pct != null);

  return (
    <div className="rounded-card bg-paper-card p-4 shadow-card">
      <div className="flex items-center justify-between">
        <SectionLabel>Training load</SectionLabel>
        <div className="text-xs text-muted">Past 12 weeks</div>
      </div>
      {/* Two figures, side by side, each with the one word that names it:
          how much work, and how heavy it was. This used to be a headline and
          two lines of explanation — "18 a week on average · 3.2 workouts a
          week", then a sentence about what the percentage was measured
          against. The numbers were never the problem. */}
      <div className="mt-2 flex items-start gap-7">
        <div>
          <div className="text-display font-bold leading-none tracking-tight text-ink tabular-nums">
            {thisWeek}
          </div>
          <div className="mt-1 text-xs text-muted tabular-nums">sets · avg {average}</div>
        </div>
        {latestIntensity?.pct != null && (
          <div>
            <div
              className={`text-display font-bold leading-none tracking-tight tabular-nums ${
                latestIntensity.pct > 1
                  ? 'text-good'
                  : latestIntensity.pct < -1
                    ? 'text-danger'
                    : 'text-ink'
              }`}
            >
              {latestIntensity.pct > 0 ? '+' : latestIntensity.pct < 0 ? '−' : ''}
              {fmtNum(Math.abs(latestIntensity.pct))}%
            </div>
            <div className="mt-1 text-xs text-muted">heavier</div>
          </div>
        )}
      </div>
      <div className="mt-3">
        <ResponsiveContainer width="100%" height={150}>
          <ComposedChart data={points} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
            <XAxis
              dataKey="label"
              tick={{ fill: '#8E8E93', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              minTickGap={24}
              tickFormatter={(d) =>
                new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                })
              }
            />
            {/* Anchored at zero, unlike body weight. A week off is a real zero,
                and an axis that starts at the smallest value would draw the
                gap as a shallow dip instead of the floor it is. */}
            <YAxis
              yAxisId="sets"
              tick={{ fill: '#8E8E93', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={32}
              allowDecimals={false}
              domain={[0, 'dataMax + 4']}
            />
            {/* Drawn away rather than hidden: the line needs its own scale — a
                percentage swing of six would vanish against a set count — but
                a second column of numbers down the right-hand edge of a
                phone-width card buys nothing the headline hasn't said.
                Deliberately not `hide`, which in this version of recharts
                suppresses the *other* axis's ticks too and left the sets scale
                blank. Zero width with nothing drawn gets the scale without the
                furniture. */}
            <YAxis
              yAxisId="intensity"
              orientation="right"
              width={0}
              tick={false}
              tickLine={false}
              axisLine={false}
              domain={['dataMin - 4', 'dataMax + 4']}
            />
            <Tooltip
              contentStyle={{ borderRadius: 12, border: '1px solid #E5E5EA', fontSize: 12 }}
              formatter={(v, name) =>
                name === 'Weight lifted'
                  ? [`${Number(v) > 0 ? '+' : ''}${fmtNum(Number(v))}% vs usual`, name]
                  : [`${v} ${Number(v) === 1 ? 'set' : 'sets'}`, name]
              }
              labelFormatter={(d) =>
                `Week of ${new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                })}`
              }
            />
            <Bar
              yAxisId="sets"
              name="Sets"
              dataKey="value"
              // A tint of ink rather than the hairline grey: these bars carry
              // a number, and at #E5E5EA they read as the gridlines they
              // aren't.
              fill="rgba(10,10,10,0.14)"
              radius={[3, 3, 0, 0]}
              maxBarSize={14}
              isAnimationActive
              animationDuration={900}
              animationEasing="ease-out"
            />
            {hasIntensity && (
              <Line
                yAxisId="intensity"
                name="Weight lifted"
                type="monotone"
                dataKey="intensity"
                stroke="#0A0A0A"
                strokeWidth={2}
                dot={{ r: 2.5, fill: '#0A0A0A' }}
                activeDot={{ r: 4 }}
                // A week the figure can't be computed for is a gap, not a
                // straight line drawn through it.
                connectNulls={false}
                isAnimationActive
                animationDuration={900}
                animationEasing="ease-out"
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function FlameIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2.6c.9 3.2-1.1 4.6-2.4 6.1a5.6 5.6 0 0 0-1.5 3.8 5.9 5.9 0 0 0 11.8 0c0-2.2-1-3.5-2.3-5-.5 1-1.2 1.6-2 1.9.3-2.9-1.2-5.4-3.6-6.8Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
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
  const line = pts
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');
  const area = `${line} L${w},${h} L0,${h} Z`;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="h-full w-full"
      aria-hidden="true"
    >
      <path d={area} fill={fill} />
      <path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth={1.6}
        vectorEffect="non-scaling-stroke"
      />
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={1.6} fill={stroke} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}


// --- What's moving ------------------------------------------------------------------

const PERIODS: { key: MoverPeriod; pill: string; prose: string }[] = [
  { key: 'week', pill: '1w', prose: 'last week' },
  { key: 'fortnight', pill: '2w', prose: 'two weeks ago' },
  { key: 'season', pill: '8w', prose: 'the eight before' },
];

/** Top six, hero included. Beyond that it stops being a glance. */
const MOVERS_SHOWN = 6;

/**
 * What's going up, and what isn't.
 *
 * This is the screen's answer to its own question, and it replaced three
 * lists that were each a different view of it: this week against last week,
 * the single most improved lift, and the all-time records board. They were
 * three renderings of "which lifts, and what are they doing", stacked one
 * above another, and the record book — which is a real thing to want — was
 * the worst of the three to land on, because it's a reference work rather
 * than a report. It moved behind "See all".
 *
 * The lift at the top keeps the black card the most-improved figure used to
 * have. It earns it: one movement, named, with the number and the shape of
 * how it got there.
 *
 * Ranked on estimated 1RM rather than on weight, so five more kilos for three
 * fewer reps doesn't read as a clean gain — but the rows print the set as it
 * was logged, because that's the number you'd recognise.
 */
function MoversCard({
  comparison,
  leadSeries,
  period,
  onPeriod,
  unit,
  canOpen,
  onOpen,
  onSeeAll,
}: {
  comparison: MoverComparison;
  /** Weekly best est. 1RM for the lead lift, for the hero's graph. */
  leadSeries: number[];
  period: MoverPeriod;
  onPeriod: (p: MoverPeriod) => void;
  unit: MachineUnit;
  canOpen: (normalizedName: string) => boolean;
  onOpen: (normalizedName: string) => void;
  onSeeAll: () => void;
}) {
  const { movers, heavier, lighter, previous } = comparison;
  const [lead, ...rest] = movers;
  const prose = PERIODS.find((p) => p.key === period)?.prose ?? 'last week';

  return (
    <div>
      <SectionHeader
        title="Moving"
        controls={
          <div className="flex rounded-pill bg-surface-strong p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => onPeriod(p.key)}
                className={`rounded-pill px-2.5 py-1 text-caption font-semibold ${
                  period === p.key ? 'bg-ink text-white' : 'text-muted'
                }`}
              >
                {p.pill}
              </button>
            ))}
          </div>
        }
      >
        {/* Only the counts that happened. A red "0↓" is a number drawing
            attention to the absence of the thing it counts. */}
        {heavier > 0 && <span className="font-semibold text-good">{heavier}↑</span>}
        {heavier > 0 && lighter > 0 && ' '}
        {lighter > 0 && <span className="font-semibold text-danger">{lighter}↓</span>}
      </SectionHeader>

      {movers.length === 0 ? (
        <div className="mt-3 rounded-card bg-paper-card p-5 text-sm text-muted shadow-card">
          {previous.sets === 0
            ? `Nothing logged ${prose}.`
            : `Nothing trained in both ${period === 'season' ? 'windows' : 'weeks'}.`}
        </div>
      ) : (
        <>
          <div className="mt-3">
            <MoverHero
              move={lead}
              series={leadSeries}
              unit={unit}
              onOpen={canOpen(lead.normalizedName) ? () => onOpen(lead.normalizedName) : undefined}
            />
          </div>
          {rest.length > 0 && (
            <ul className="mt-3 divide-y divide-line/60 overflow-hidden rounded-card bg-paper-card shadow-card">
              {rest.slice(0, MOVERS_SHOWN - 1).map((m) => (
                <MoverRow
                  key={m.normalizedName}
                  move={m}
                  unit={unit}
                  onOpen={canOpen(m.normalizedName) ? () => onOpen(m.normalizedName) : undefined}
                />
              ))}
            </ul>
          )}
        </>
      )}

      <button
        type="button"
        onClick={onSeeAll}
        className="mt-4 flex items-center gap-1 text-sm font-semibold text-muted active:text-ink"
      >
        See all exercises <ChevronRight />
      </button>
    </div>
  );
}

/** The lift at the top of the list, with the shape of how it got there. */
function MoverHero({
  move,
  series,
  unit,
  onOpen,
}: {
  move: ExerciseMove;
  series: number[];
  unit: MachineUnit;
  onOpen?: () => void;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className="text-label font-semibold uppercase tracking-[0.14em] text-white/60">
          Biggest gain
        </div>
        {onOpen && (
          <span className="text-white/60">
            <ChevronRight />
          </span>
        )}
      </div>
      <div className="mt-2 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold">{move.displayName}</div>
          <div className="mt-1 text-display font-bold leading-none tracking-tight tabular-nums">
            {formatLoadShort(move.currentKg, unit)}
          </div>
          <div className="mt-1.5 text-sm font-semibold tabular-nums">
            {deltaArrow(move.deltaPct)} {fmtNum(Math.abs(move.deltaPct))}%
          </div>
        </div>
        {series.length >= 2 && (
          <div className="h-16 w-28 shrink-0">
            <Sparkline values={series} stroke="#FFFFFF" fill="rgba(255,255,255,0.12)" />
          </div>
        )}
      </div>
    </>
  );
  const cls = 'w-full rounded-card bg-ink p-5 text-left text-white shadow-card';
  return onOpen ? (
    <button type="button" onClick={onOpen} className={`${cls} active:bg-ink-soft`}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/**
 * One lift under the hero.
 *
 * The set on top, the change under it — the same shape the records board
 * gives a row, so the two lists read as one thing seen twice. It used to
 * spell out both sets ("55 kg × 7 → 56.5 kg × 8"); the arrow and the
 * percentage already say which way it went, and the earlier set is one tap
 * away in the history.
 */
function MoverRow({
  move,
  unit,
  onOpen,
}: {
  move: ExerciseMove;
  unit: MachineUnit;
  /** Absent for a lift with no record behind it — nothing to open. */
  onOpen?: () => void;
}) {
  const up = move.deltaPct > 1;
  const down = move.deltaPct < -1;
  const body = (
    <div className="flex items-center justify-between gap-3 px-5 py-3.5">
      <span className="min-w-0 flex-1 truncate text-sm text-ink">{move.displayName}</span>
      <div className="shrink-0 text-right">
        <div className="whitespace-nowrap text-sm font-semibold text-ink tabular-nums">
          {formatSetShort(move.currentKg, move.currentReps, unit)}
        </div>
        <div
          className={`whitespace-nowrap text-caption font-semibold tabular-nums ${
            up ? 'text-good' : down ? 'text-danger' : 'text-muted'
          }`}
        >
          {deltaArrow(move.deltaPct)} {fmtNum(Math.abs(move.deltaPct))}%
        </div>
      </div>
      {onOpen && <ChevronRight />}
    </div>
  );
  return (
    <li>
      {onOpen ? (
        <button type="button" onClick={onOpen} className="w-full text-left active:bg-surface">
          {body}
        </button>
      ) : (
        body
      )}
    </li>
  );
}

function deltaArrow(pct: number): string {
  return pct > 1 ? '↑' : pct < -1 ? '↓' : '·';
}

// --- Formatting -------------------------------------------------------------------------

function formatBw(kg: number, unit: BodyWeightUnit): string {
  return unit === 'st' ? formatStoneLb(kg) : `${fmtNum(kg)} kg`;
}

function formatBwDelta(kg: number, unit: BodyWeightUnit): string {
  if (unit === 'st') {
    const lb = Math.round((kg / 0.45359237) * 10) / 10;
    return `${fmtNum(lb)} lb`;
  }
  return `${fmtNum(kg)} kg`;
}

/** A set as it was logged: the weight, then the reps hit on it. */
function formatSetShort(kg: number, reps: number, unit: MachineUnit): string {
  return `${formatLoadShort(kg, unit)} × ${reps}`;
}

function formatLoadShort(kg: number, unit: MachineUnit): string {
  const v = fmtNum(fromKgFor(kg, unit));
  return unit === 'pin' ? `pin ${v}` : `${v} ${unit}`;
}

// --- Icons -------------------------------------------------------------------------------

/**
 * One block of the dashboard.
 *
 * These used to rise into place one after another, 70ms apart. That's an
 * arrival gesture, and it belongs on a screen you arrive at — the one after a
 * workout still has it. This is a tab: you flick to it to read numbers, over
 * and over, and the stagger held the last card at zero opacity for 420ms after
 * the loading state had already cleared.
 */
function Block({ children }: { children: React.ReactNode }) {
  return <div className="mt-9 first:mt-6">{children}</div>;
}

// --- One lift's history, under its record ---------------------------------

type DetailRange = 30 | 90 | 182 | 0;

const RANGE_LABELS: { days: DetailRange; label: string }[] = [
  { days: 30, label: '1M' },
  { days: 90, label: '3M' },
  { days: 182, label: '6M' },
  { days: 0, label: 'All' },
];

/**
 * One movement, on its own screen.
 *
 * This used to unfold inside the records list: tapping a row dropped a chart,
 * a range of dates and every set you had ever done into the middle of it, and
 * the list you were reading stopped being a list. A record is an overview and
 * a movement is a detail, so they are now a screen apart — the list stays
 * scannable, and the analysis gets the room it needs.
 */
function RecordDetail({
  record,
  sets,
  onBack,
}: {
  record: LiftRecord;
  sets: PerformanceData['sets'];
  onBack: () => void;
}) {
  const [range, setRange] = useState<DetailRange>(0);
  const history = useMemo(
    () => buildExerciseHistory(sets, record.normalizedName),
    [sets, record.normalizedName],
  );
  const inRange = useMemo(() => {
    if (range === 0) return history;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - range);
    const from = `${cutoff.getFullYear()}-${pad2(cutoff.getMonth() + 1)}-${pad2(cutoff.getDate())}`;
    return history.filter((p) => p.date >= from);
  }, [history, range]);

  const points = useMemo(
    () =>
      inRange
        .filter((p) => p.topWeightKg != null && p.repsAtTopWeight != null)
        .map((p) => ({
          label: p.date,
          weight: fromKgFor(p.topWeightKg!, record.unit),
          reps: p.repsAtTopWeight!,
        })),
    [inRange, record.unit],
  );

  const best =
    record.kind === 'weighted' && record.heaviest
      ? formatLoadShort(record.heaviest.weightKg ?? 0, record.unit)
      : record.kind === 'reps' && record.mostReps
        ? `${record.mostReps.reps} reps`
        : '–';

  return (
    <div className="pb-nav min-h-screen bg-paper">
      <div
        className="mx-auto max-w-md px-5"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0px)' }}
      >
        <PageHeader title={record.displayName} onBack={onBack} />

        <div className="mt-3">
          <SectionLabel>All-time best</SectionLabel>
        </div>
        <div className="mt-1 text-display-lg font-bold leading-none tracking-tight text-ink tabular-nums">
          {best}
        </div>

        {/* Three across, and compact: these support the headline above them
            rather than being the headline, which is why they aren't the
            dashboard's stat tile. The same MiniTile the dashboard's water and
            steps sit in — one small-stat component, not two that differ by a
            font size. */}
        <div className="mt-5 grid grid-cols-3 gap-2.5">
          <MiniTile
            label="Est. 1RM"
            value={record.best1RMkg > 0 ? formatLoadShort(record.best1RMkg, record.unit) : '–'}
          />
          <MiniTile
            label="Best reps"
            value={record.mostReps?.reps != null ? String(record.mostReps.reps) : '–'}
          />
          <MiniTile label="Record date" value={shortDate(recordAchievedAt(record))} />
        </div>

        {record.kind === 'weighted' && (
          <>
            <div className="mt-5 flex rounded-pill bg-surface-strong p-0.5">
              {RANGE_LABELS.map((r) => (
                <button
                  key={r.label}
                  type="button"
                  onClick={() => setRange(r.days)}
                  className={`flex-1 rounded-pill py-1.5 text-xs font-semibold ${
                    range === r.days ? 'bg-ink text-white' : 'text-muted'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            <div className="mt-3 rounded-card bg-paper-card p-4 shadow-card">
              <SectionLabel>Strength progress</SectionLabel>
              <div className="mt-0.5 text-xs text-muted">Top working set</div>
              {points.length < 2 ? (
                <div className="flex h-[140px] items-center justify-center px-6 text-center text-sm text-muted">
                  {points.length === 0
                    ? 'Nothing logged in this range.'
                    : 'Just one session in this range — keep logging to see the trend.'}
                </div>
              ) : (
                <DualAxisChart points={points} unitLabel={record.unit} />
              )}
            </div>
          </>
        )}

        <SessionHistoryList history={inRange} unit={record.unit} />
      </div>
    </div>
  );
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
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
            <div className="mt-1 text-sm text-muted tabular-nums">{formatSets(p.sets, unit)}</div>
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
  latestKg,
  delta,
}: {
  rows: PerformanceData['bodyWeights'];
  bwUnit: BodyWeightUnit;
  /** Most recent reading, for the headline above the graph. */
  latestKg?: number | null;
  /** The change under it, already worded. */
  delta?: string | null;
}) {
  const points = useMemo(
    () =>
      [...rows].reverse().map((r) => ({
        label: r.recorded_on,
        value: bwUnit === 'kg' ? r.weight_kg : toDecimalStones(r.weight_kg),
      })),
    [rows, bwUnit],
  );

  return (
    <div className="rounded-card bg-paper-card p-4 shadow-card">
      {/* No heading of its own: the section is titled on the page above, where
          the range pills that govern it also sit. */}
      {latestKg != null && (
        <div>
          <div className="text-display font-bold leading-none tracking-tight text-ink tabular-nums">
            {formatBw(latestKg, bwUnit)}
          </div>
          {delta && <div className="mt-1 text-xs text-muted tabular-nums">{delta}</div>}
        </div>
      )}
      <div className="mt-3">
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
