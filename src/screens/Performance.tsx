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
import { Tile, MiniTile, ChevronRight, BoltIcon, WaterIcon, StepsIcon } from '../components/Tile';
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
import { headlineRecords, recordAchievedAt } from '../lib/records';
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
  computeConsistency,
  weekDailyAverage,
  weekStartISO,
  computeWeekStreak,
  computeWeeklyLoad,
  type WeekStreak,
  type WeeklyLoadPoint,
  computeMostImproved,
  computeOverallStrength,
  computeWeeklyIntensity,
  computeWorkoutsPerWeek,
  compareWeeks,
  newRecordCount,
  summarizeBodyWeight,
  type WeeklyIntensityPoint,
  type WeekComparison,
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
// A dashboard first: where you are on the plan, how this week compares with
// the last one lift by lift, body weight, how hard and how much you've
// trained, and whether you're getting stronger. Every figure comes from
// lib/dashboard.ts, which says "not enough data" rather than invent a number.
//
// Two rules hold the page together. The first is about weight: the big
// numbers get a card with the chart that explains them, and the supporting
// ones get a mini tile a third of the height — water and steps are worth
// knowing and are not worth a 156px tile each. The second is about depth: any
// lift named anywhere on this tab opens its own history, in one tap, from
// wherever you tapped it. Nothing routes through an index on the way.

type View = 'dashboard' | 'records' | 'record';
type BwRange = 84 | 182 | 365;
/** How far back the week-on-week card reaches: last week, or the one before. */
type VsWeeks = 1 | 2;

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
  const [vsWeeks, setVsWeeks] = useState<VsWeeks>(1);
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
    const mostImproved = computeMostImproved(perf.sets);
    return {
      weeklyTarget,
      consistency: computeConsistency(gymSessions, activatedAt, weeklyTarget),
      streak: computeWeekStreak(gymSessions, weeklyTarget),
      water: weekDailyAverage(data.water.map((w) => ({ date: w.recorded_on, value: w.count }))),
      steps: weekDailyAverage(data.steps.map((r) => ({ date: r.recorded_on, value: r.steps }))),
      load: computeWeeklyLoad(perf.sets),
      intensity: computeWeeklyIntensity(perf.sets),
      perWeek: computeWorkoutsPerWeek(gymSessions, activatedAt),
      strength: computeOverallStrength(perf.sets, activatedAt),
      mostImproved,
      mostImprovedSeries: mostImproved
        ? buildWeeklySeries(perf.sets, 'est1rm', { normalizedName: mostImproved.normalizedName })
        : [],
      bodyWeight: summarizeBodyWeight(perf.bodyWeights, activatedAt),
      newPrs: newRecordCount(records),
      topRecords: headlineRecords(records),
      // Every lift that has ever been logged has a record, so this is what
      // decides whether a name anywhere on the tab is worth making tappable.
      recordNames: new Set(records.map((r) => r.normalizedName)),
    };
  }, [data]);

  // Its own memo rather than part of `derived`: the pills above it change
  // which week is compared, and nothing else on the tab should recompute for
  // that. Sessions are counted before the reference day is filtered out — this
  // card is "what did I do", not "did I hit the plan".
  const comparison = useMemo(
    () => (data ? compareWeeks(data.perf.sets, data.sessions, vsWeeks) : null),
    [data, vsWeeks],
  );

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
          <div className="mt-2 space-y-3">
            <Block>
              <PlanHero
                plan={data.plan}
                done={data.week.workoutsDone}
                target={derived.weeklyTarget}
              />
            </Block>

            {derived.streak.longest > 0 && (
              <Block>
                <div className="grid grid-cols-2 gap-3">
                  <StreakTile streak={derived.streak} target={derived.weeklyTarget} />
                  <Tile
                    icon={<CalendarIcon />}
                    label="Consistency"
                    value={derived.consistency.pct != null ? `${derived.consistency.pct}%` : '–'}
                    hint={
                      derived.consistency.pct != null
                        ? `${derived.consistency.done} of ${derived.consistency.planned} this plan`
                        : 'needs an active plan'
                    }
                  />
                </div>
              </Block>
            )}

            {comparison && (
              <Block>
                <WeekCompareCard
                  comparison={comparison}
                  weeksBack={vsWeeks}
                  onWeeksBack={setVsWeeks}
                  unit={liftUnit}
                  canOpen={(n) => derived.recordNames.has(n)}
                  onOpen={(n) => openRecord(n)}
                />
              </Block>
            )}

            {/* The supporting numbers, three across and a third the height of
                a stat tile. Water and steps are averaged over the days they
                were actually logged — see weekDailyAverage — so the hint names
                that count rather than letting "a day" imply a full week. */}
            <Block>
              <div className="grid grid-cols-3 gap-2.5">
                <MiniTile
                  icon={<WaterIcon />}
                  label="Water"
                  value={
                    derived.water.average != null
                      ? String(Math.round(derived.water.average * 10) / 10)
                      : '–'
                  }
                  hint={
                    derived.water.average != null
                      ? `over ${derived.water.daysLogged} ${derived.water.daysLogged === 1 ? 'day' : 'days'}`
                      : 'none this week'
                  }
                />
                <MiniTile
                  icon={<StepsIcon />}
                  label="Steps"
                  value={
                    derived.steps.average != null
                      ? formatSteps(Math.round(derived.steps.average))
                      : '–'
                  }
                  hint={
                    derived.steps.average != null
                      ? `over ${derived.steps.daysLogged} ${derived.steps.daysLogged === 1 ? 'day' : 'days'}`
                      : 'none this week'
                  }
                />
                <MiniTile
                  icon={<BoltIcon />}
                  label="Workouts"
                  value={derived.perWeek.average != null ? String(derived.perWeek.average) : '–'}
                  hint={derived.perWeek.average != null ? 'a week on plan' : 'none logged'}
                />
              </div>
            </Block>

            {data.perf.bodyWeights.length > 0 && (
              <Block>
                <BodyWeightCard
                  rows={bodyWeightRange(data.perf.bodyWeights, bwRange).slice().reverse()}
                  bwUnit={bwUnit}
                  latestKg={derived.bodyWeight?.latestKg ?? null}
                  delta={
                    derived.bodyWeight?.deltaKg != null
                      ? `${derived.bodyWeight.deltaKg > 0 ? '↑' : derived.bodyWeight.deltaKg < 0 ? '↓' : '·'} ${formatBwDelta(
                          Math.abs(derived.bodyWeight.deltaKg),
                          bwUnit,
                        )} ${derived.bodyWeight.since === 'plan' ? 'this plan' : 'overall'}`
                      : null
                  }
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
              </Block>
            )}

            {derived.load.some((p) => p.sets > 0) && (
              <Block>
                <TrainingLoadCard
                  load={derived.load}
                  intensity={derived.intensity}
                  perWeek={derived.perWeek.average}
                />
              </Block>
            )}

            <Block>
              <StrengthCard strength={derived.strength} />
            </Block>

            {derived.mostImproved && (
              <Block>
                <MostImprovedCard
                  mi={derived.mostImproved}
                  series={derived.mostImprovedSeries.map((p) => p.value)}
                  unit={liftUnit}
                />
              </Block>
            )}

            {derived.topRecords.length > 0 && (
              <TopRecords
                records={derived.topRecords}
                newThisMonth={derived.newPrs}
                unit={liftUnit}
                onViewAll={() => setView('records')}
                onSelect={(n) => openRecord(n)}
              />
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
        <div className="text-label font-semibold uppercase tracking-[0.14em] text-white/60">
          Current plan
        </div>
        <div className="mt-1 text-xl font-bold tracking-tight">No active plan</div>
        <div className="mt-0.5 text-sm text-white/70">
          Upload one from your profile to start tracking.
        </div>
      </div>
    );
  }
  const week = weeksOnPlan(plan.activated_at);
  const pct = target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0;
  return (
    <div className="rounded-card bg-ink p-5 text-white shadow-card">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-label font-semibold uppercase tracking-[0.14em] text-white/60">
            Current plan
          </div>
          <div className="mt-1 text-display font-bold leading-none tracking-tight">Week {week}</div>
          <div className="mt-2 text-sm text-white/70">
            {week === 1 ? 'First week on plan' : `${week} weeks on plan`}
          </div>
          <div className="truncate text-sm text-white/70">{plan.name}</div>
        </div>
        {target > 0 && (
          <div className="w-32 shrink-0 pt-1 text-right">
            <div className="text-label font-semibold uppercase tracking-[0.14em] text-white/60">
              This week
            </div>
            <div className="mt-1 text-sm font-semibold tabular-nums">
              {done} of {target} workouts
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

/** A small line with a soft fill under it. Values only; no axes. */
/**
 * Weeks in a row hitting the plan's target.
 *
 * A tile rather than a card of its own. It carries exactly what the tiles
 * beside it carry — a chip, a label, one number, a line under it — and given
 * a full-width card to fill it just sat a 44px chip next to a short word and
 * left half the row empty.
 *
 * Paired with consistency because they answer the same question from two
 * sides: the ratio that forgives, and the run that doesn't.
 */
function StreakTile({ streak, target }: { streak: WeekStreak; target: number }) {
  const { current, longest, thisWeekCounts } = streak;
  const live = current > 0;
  const weeks = live ? current : longest;
  return (
    <Tile
      icon={<FlameIcon />}
      label={live ? 'Streak' : 'Best streak'}
      value={
        <>
          {weeks}
          <span className="ml-1 text-base font-semibold text-muted">
            {weeks === 1 ? 'week' : 'weeks'}
          </span>
        </>
      }
      hint={
        live
          ? thisWeekCounts
            ? 'this week counted'
            : `finish this week for ${current + 1}`
          : `${target} a week starts one`
      }
    />
  );
}

/**
 * Twelve weeks of training: how much, and how heavy.
 *
 * The rest of the tab looks at a fortnight or at one lift. This is the only
 * place that answers "how has it been going lately", which is the question a
 * chart is for — and the empty weeks are drawn, because a month off is the
 * most informative thing a season of training has to say.
 *
 * Two series, because sets alone were being read as a verdict they can't
 * give: a week of heavy triples and a week of light high-rep work look
 * identical by set count, so a block that gets harder and shorter draws a line
 * going down. The bars are the volume of work; the line over them is how heavy
 * that work was against the window's own normal (computeWeeklyIntensity has
 * the arithmetic and the reason it's a percentage rather than a tonnage). Load
 * down and intensity up is a real and common shape, and now it's visible
 * rather than looking like a decline.
 */
function TrainingLoadCard({
  load,
  intensity,
  perWeek,
}: {
  load: WeeklyLoadPoint[];
  intensity: WeeklyIntensityPoint[];
  perWeek: number | null;
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
      <div className="mt-1 flex items-baseline gap-2">
        <div className="text-display font-bold leading-none tracking-tight text-ink tabular-nums">
          {thisWeek}
        </div>
        <div className="text-sm font-semibold text-muted">
          {thisWeek === 1 ? 'set this week' : 'sets this week'}
        </div>
      </div>
      <div className="mt-0.5 text-xs text-muted tabular-nums">
        {average} a week on average{perWeek != null && ` · ${perWeek} workouts a week`}
      </div>
      {latestIntensity?.pct != null && (
        <div className="mt-1 text-xs tabular-nums">
          <span
            className={`font-semibold ${
              latestIntensity.pct > 1
                ? 'text-good'
                : latestIntensity.pct < -1
                  ? 'text-danger'
                  : 'text-muted'
            }`}
          >
            {latestIntensity.pct > 0 ? '+' : latestIntensity.pct < 0 ? '−' : ''}
            {fmtNum(Math.abs(latestIntensity.pct))}%
          </span>{' '}
          <span className="text-muted">
            on the weight lifted, against these 12 weeks — over {latestIntensity.lifts}{' '}
            {latestIntensity.lifts === 1 ? 'lift' : 'lifts'}
          </span>
        </div>
      )}
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
            {/* Hidden rather than absent: the line needs its own scale — a
                percentage swing of six would be invisible against a set count
                — but a second set of numbers down the right-hand edge of a
                phone-width card buys nothing the headline hasn't said. */}
            <YAxis yAxisId="intensity" hide domain={['dataMin - 4', 'dataMax + 4']} />
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
            {/* Each series keyed as it's drawn — a bar with a line for a
                swatch reads as two lines, one of which has gone missing. The
                formatter is there because recharts colours a legend label to
                match its series, which left "Sets" written in the bars' own
                14% ink and all but invisible. */}
            {hasIntensity && (
              <Legend
                verticalAlign="top"
                height={24}
                wrapperStyle={{ fontSize: 11 }}
                formatter={(value) => <span style={{ color: '#8E8E93' }}>{value}</span>}
              />
            )}
            <Bar
              yAxisId="sets"
              name="Sets"
              dataKey="value"
              // A tint of ink rather than the hairline grey: these bars carry
              // a number, and at #E5E5EA they read as the gridlines they
              // aren't.
              fill="rgba(10,10,10,0.14)"
              legendType="rect"
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
                legendType="plainline"
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

/**
 * Overall strength, as a data card rather than a shape of its own.
 *
 * Label, headline, graph — the same three parts as body weight and training
 * load, so "not enough data yet" is this card's empty state rather than a
 * fourth kind of component. The sentence sits where the number will, at the
 * size of prose rather than of a headline, because it is standing in for a
 * figure we haven't got rather than being one.
 */
function StrengthCard({ strength }: { strength: ReturnType<typeof computeOverallStrength> }) {
  const hint =
    strength.reason === 'no_plan'
      ? 'Needs an active plan'
      : strength.reason === 'too_early'
        ? 'Shows after four weeks on the plan'
        : strength.reason === 'too_few_lifts'
          ? 'Needs three lifts trained early and recently'
          : 'Since starting this plan';
  return (
    <div className="rounded-card bg-paper-card p-4 shadow-card">
      <SectionLabel>Overall strength</SectionLabel>
      {strength.pct != null ? (
        <div className="mt-1 text-display font-bold leading-none tracking-tight text-ink tabular-nums">
          {`${strength.pct > 0 ? '+' : ''}${fmtNum(strength.pct)}%`}
        </div>
      ) : (
        <div className="mt-1 text-base font-semibold leading-tight text-muted">
          Not enough data yet
        </div>
      )}
      <div className="mt-1 text-xs text-muted">{hint}</div>
      {strength.series.length >= 2 && (
        <div className="mt-3 h-20 w-full">
          <Sparkline
            values={strength.series.map((p) => p.pct)}
            stroke="#0A0A0A"
            fill="rgba(10,10,10,0.08)"
          />
        </div>
      )}
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
      <div className="text-label font-semibold uppercase tracking-[0.14em] text-white/60">
        Most improved this month
      </div>
      <div className="mt-2 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold">{mi.displayName}</div>
          <div className="mt-1 text-display font-bold leading-none tracking-tight tabular-nums">
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

function TopRecords({
  records,
  newThisMonth,
  unit,
  onViewAll,
  onSelect,
}: {
  records: LiftRecord[];
  newThisMonth: number;
  unit: MachineUnit;
  onViewAll: () => void;
  onSelect: (normalizedName: string) => void;
}) {
  return (
    // The heading sits on the page rather than inside the card, at the size a
    // section of a screen is titled — everything above it is the dashboard,
    // and everything from here down is the record book. The gap is doing the
    // same work as the type: this is a new part of the page, not the next
    // card in a stack.
    <div className="mt-12">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold tracking-tight text-ink">All-time records</h2>
          <p className="mt-0.5 text-sm text-muted">
            {newThisMonth > 0
              ? `${newThisMonth} set this month`
              : 'Your best ever on every movement'}
          </p>
        </div>
        <button
          type="button"
          onClick={onViewAll}
          className="flex shrink-0 items-center gap-1 pb-1 text-sm text-muted active:text-ink"
        >
          View all <ChevronRight />
        </button>
      </div>
      <ul className="mt-4 divide-y divide-line/60 overflow-hidden rounded-card bg-paper-card shadow-card">
        {records.map((r) => (
          <li key={r.normalizedName}>
            {/* Straight to the lift's own history. This used to open the
                records board instead, so the row you had just tapped had to be
                found and tapped again on the screen in between. */}
            <button
              type="button"
              onClick={() => onSelect(r.normalizedName)}
              className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left active:bg-surface"
            >
              <span className="min-w-0 truncate text-sm text-ink">{r.displayName}</span>
              <span className="flex shrink-0 items-center gap-2 text-sm font-semibold text-ink tabular-nums">
                {r.heaviest ? formatLoadShort(r.heaviest.weightKg ?? 0, unit) : '–'}
                <ChevronRight />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- This week against another one ---------------------------------------------

const VS_LABELS: { weeks: VsWeeks; pill: string; prose: string }[] = [
  { weeks: 1, pill: 'Last week', prose: 'last week' },
  { weeks: 2, pill: '2 weeks ago', prose: 'two weeks ago' },
];

/**
 * This week beside an earlier one, lift by lift.
 *
 * The rest of the tab is written in seasons — twelve weeks of load, a month of
 * PRs, a plan's worth of consistency. None of that answers the question you
 * actually open the tab with on a Thursday: is this week going better than the
 * last one? So this card names two weeks and puts them side by side.
 *
 * Two weeks back is offered as well as one because a plan on a fortnight's
 * rotation trains a given movement every other week, and comparing Tuesday's
 * push day with a week that had no push day in it compares nothing.
 *
 * Rows go straight to the lift's history — the card names a movement and a
 * number, and the next thing you want is the chart behind it.
 */
function WeekCompareCard({
  comparison,
  weeksBack,
  onWeeksBack,
  unit,
  canOpen,
  onOpen,
}: {
  comparison: WeekComparison;
  weeksBack: VsWeeks;
  onWeeksBack: (w: VsWeeks) => void;
  unit: MachineUnit;
  canOpen: (normalizedName: string) => boolean;
  onOpen: (normalizedName: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { current, previous, movers, heavier, lighter, held } = comparison;
  const prose = VS_LABELS.find((v) => v.weeks === weeksBack)?.prose ?? 'last week';
  // Enough to see the shape of the week without the card becoming the page;
  // the rest are one tap away.
  const shown = expanded ? movers : movers.slice(0, 4);

  return (
    <div className="rounded-card bg-paper-card p-4 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <SectionLabel>This week vs</SectionLabel>
        <div className="flex rounded-pill bg-surface-strong p-0.5">
          {VS_LABELS.map((v) => (
            <button
              key={v.weeks}
              type="button"
              onClick={() => onWeeksBack(v.weeks)}
              className={`rounded-pill px-2.5 py-1 text-caption font-semibold ${
                weeksBack === v.weeks ? 'bg-ink text-white' : 'text-muted'
              }`}
            >
              {v.pill}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <div className="text-display font-bold leading-none tracking-tight text-ink tabular-nums">
          {current.workouts}
        </div>
        <div className="text-sm font-semibold text-muted">
          {current.workouts === 1 ? 'workout' : 'workouts'} · {current.sets}{' '}
          {current.sets === 1 ? 'set' : 'sets'}
        </div>
      </div>
      <div className="mt-1 text-xs text-muted tabular-nums">
        {previous.workouts === 0 && previous.sets === 0
          ? `Nothing logged ${prose}`
          : `${previous.workouts} ${previous.workouts === 1 ? 'workout' : 'workouts'} · ${previous.sets} ${
              previous.sets === 1 ? 'set' : 'sets'
            } ${prose}`}
      </div>

      {movers.length === 0 ? (
        <div className="mt-4 rounded-panel bg-surface px-4 py-3 text-sm text-muted">
          {previous.sets === 0
            ? `No sets logged ${prose} to compare with yet.`
            : `Nothing trained in both weeks — try comparing with ${
                weeksBack === 1 ? 'two weeks ago' : 'last week'
              }.`}
        </div>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs tabular-nums">
            {heavier > 0 && <span className="font-semibold text-good">{heavier} heavier</span>}
            {lighter > 0 && <span className="font-semibold text-danger">{lighter} lighter</span>}
            {held > 0 && <span className="text-muted">{held} held</span>}
            <span className="text-muted">
              · {movers.length} {movers.length === 1 ? 'lift' : 'lifts'} in both weeks
            </span>
          </div>

          <ul className="mt-2 divide-y divide-line/60">
            {shown.map((m) => (
              <MoveRow
                key={m.normalizedName}
                move={m}
                unit={unit}
                onOpen={canOpen(m.normalizedName) ? () => onOpen(m.normalizedName) : undefined}
              />
            ))}
          </ul>

          {movers.length > shown.length && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="mt-3 text-sm font-semibold text-muted active:text-ink"
            >
              Show all {movers.length} lifts
            </button>
          )}
          {expanded && movers.length > 4 && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="mt-3 text-sm font-semibold text-muted active:text-ink"
            >
              Show less
            </button>
          )}
        </>
      )}
    </div>
  );
}

/**
 * One lift's two weeks: the earlier set, the one just done, and the change.
 *
 * Both sets are printed as they were logged — the weight and the reps you'd
 * recognise from the logger — while the percentage beside them is the change
 * in estimated 1RM, which is the only way five more kilos for three fewer reps
 * can be told from an actual gain.
 */
function MoveRow({
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
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-semibold text-ink">{move.displayName}</span>
        <span
          className={`shrink-0 text-sm font-semibold tabular-nums ${
            up ? 'text-good' : down ? 'text-danger' : 'text-muted'
          }`}
        >
          {up ? '↑' : down ? '↓' : '·'} {fmtNum(Math.abs(move.deltaPct))}%
        </span>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted tabular-nums">
        <span>{formatSetShort(move.previousKg, move.previousReps, unit)}</span>
        <span aria-hidden="true">→</span>
        <span className="font-semibold text-ink">
          {formatSetShort(move.currentKg, move.currentReps, unit)}
        </span>
        {onOpen && <ChevronRight />}
      </div>
    </>
  );
  return (
    <li>
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="w-full py-3 text-left active:bg-surface"
        >
          {body}
        </button>
      ) : (
        <div className="py-3">{body}</div>
      )}
    </li>
  );
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

function CalendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M3 8h12M6.5 2.5v3M11.5 2.5v3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
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
  return <div className="mt-7 first:mt-6">{children}</div>;
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
  controls,
  latestKg,
  delta,
}: {
  rows: PerformanceData['bodyWeights'];
  bwUnit: BodyWeightUnit;
  /** Rendered beside the label — the range pills. */
  controls?: React.ReactNode;
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
      <div className="flex items-center justify-between gap-3">
        <SectionLabel>Body weight</SectionLabel>
        {controls}
      </div>
      {/* The headline the stat grid used to carry. It belonged here all along,
          above the graph that explains it, rather than in a tile directly
          above a card showing the same figure. */}
      {latestKg != null && (
        <div className="mt-1">
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
