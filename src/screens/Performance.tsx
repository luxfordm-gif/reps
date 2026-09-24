import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Area,
  AreaChart,
  Bar,
  Cell,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
import { PageHeader } from '../components/PageHeader';
import {
  MiniTile,
  ChevronRight,
  BarsIcon,
  BoltIcon,
  WaterIcon,
  StepsIcon,
} from '../components/Tile';
import { RecordsBoard } from '../components/RecordsBoard';
import {
  loadPerformanceData,
  buildExerciseHistory,
  buildWeeklySeries,
  est1RMChangePct,
  mostRepsIn,
  type PerformanceData,
} from '../lib/performanceApi';
import { loadRecords, type LiftRecord } from '../lib/recordsApi';
import { listWaterSince, type WaterDay } from '../lib/waterApi';
import { listSteps, formatSteps, type StepRow } from '../lib/stepsApi';
import { getActivePlan, weeksOnPlan, type FullPlan } from '../lib/plansApi';
import { buildDaySlots } from '../lib/daySlots';
import { buildWeekFacts, comparisonLabel, weekLine, type WeekFacts } from '../lib/summary';
import {
  getThisWeekSummary,
  listCompletedSessions,
  type CompletedSessionSummary,
  type WeekSummary,
} from '../lib/sessionsApi';
import {
  bodyWeightChange,
  bodyWeightRange,
  dailyAverage,
  HABIT_WINDOW_DAYS,
  computeWeekStreak,
  computeWeeklyVolume,
  weekVsAveragePct,
  computeWorkoutsPerWeek,
  compareWindow,
  countSessionsByExercise,
  summarizeBodyWeight,
  type WeekStreak,
  type WeeklyVolumePoint,
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
import ExerciseName from '../components/ExerciseName';
import { splitBrand } from '../lib/exerciseBrand';
import { SectionLabel } from '../components/SectionLabel';

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
type BwRange = 14 | 28 | 42 | 182 | 365;

/** The body-weight range pills, with what the change is measured across. */
const BW_RANGES: { days: BwRange; pill: string; label: string }[] = [
  { days: 14, pill: '2w', label: 'over 2 weeks' },
  { days: 28, pill: '4w', label: 'over 4 weeks' },
  { days: 42, pill: '6w', label: 'over 6 weeks' },
  { days: 182, pill: '6m', label: 'over 6 months' },
  { days: 365, pill: '1y', label: 'over a year' },
];

/**
 * What the movers list is comparing, in days: the last N against the N before.
 *
 * All rolling windows. Even the shortest spans a whole two-week rotation, so
 * it never sets one half of the plan against the other.
 */
type MoverPeriod = 14 | 28 | 42;

/** Which way the training-volume card is counting. */
type VolumeMetric = 'kg' | 'sets';

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
  // Bounded to what the habit average actually reads rather than fetching a
  // year of rows to divide by. This used to ask for the current week only,
  // which quietly capped the average at however much of this week had
  // happened however wide the window said it was.
  const from = new Date();
  from.setDate(from.getDate() - (HABIT_WINDOW_DAYS - 1));
  const weekFrom = `${from.getFullYear()}-${pad2(from.getMonth() + 1)}-${pad2(from.getDate())}`;
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
  const [bwRange, setBwRange] = useState<BwRange>(42);
  const [period, setPeriod] = useState<MoverPeriod>(14);
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
    const streak = computeWeekStreak(gymSessions, weeklyTarget);
    return {
      weeklyTarget,
      streak,
      week: buildWeekFacts({
        sets: perf.sets,
        sessions: gymSessions,
        planId: plan?.id ?? null,
        target: weeklyTarget,
        streak: streak.current,
      }),
      water: dailyAverage(data.water.map((w) => ({ date: w.recorded_on, value: w.count }))),
      steps: dailyAverage(data.steps.map((r) => ({ date: r.recorded_on, value: r.steps }))),
      volume: computeWeeklyVolume(perf.sets),
      perWeek: computeWorkoutsPerWeek(gymSessions, activatedAt),
      bodyWeight: summarizeBodyWeight(perf.bodyWeights, activatedAt),
      // Every lift that has ever been logged has a record, so this is what
      // decides whether a name anywhere on the tab is worth making tappable.
      recordNames: new Set(records.map((r) => r.normalizedName)),
      // How often each movement has actually been trained, for the library's
      // ordering and for holding back the ones done once.
      sessionsByExercise: countSessionsByExercise(perf.sets),
    };
  }, [data]);

  // Its own memo rather than part of `derived`: the pills above it change what
  // is being compared, and nothing else on the tab should recompute for that.
  // Sessions are counted before the reference day is filtered out — this is
  // "what did I do", not "did I hit the plan".
  const movers = useMemo(() => {
    if (!data) return null;
    return compareWindow(data.perf.sets, data.sessions, period);
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
          // No safe-area padding here: PageHeader's sticky bar carries it,
          // and adding it again left the status-bar gap doubled.
          className="mx-auto max-w-md px-5"
        >
          <PageHeader title="All-time records" onBack={() => setView('dashboard')} />
          <div className="mt-4">
            <RecordsBoard
              records={data.records}
              improvement={improvement}
              sessions={derived?.sessionsByExercise}
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
        {!loading && hasAnyData && derived?.week && (
          <WeekIntro facts={derived.week} unit={liftUnit} />
        )}

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
                <BodyWeightCard
                  rows={bodyWeightRange(data.perf.bodyWeights, bwRange)}
                  bwUnit={bwUnit}
                  rangeLabel={BW_RANGES.find((r) => r.days === bwRange)?.label ?? ''}
                  controls={
                    <Pills
                      options={BW_RANGES.map((r) => ({ key: r.days, label: r.pill }))}
                      value={bwRange}
                      onChange={setBwRange}
                    />
                  }
                />
              </Block>
            )}

            {/* How often, and the two habits. The habits average over three
                weeks and over the days actually logged — see dailyAverage —
                so a couple of missed days don't read as a collapse, and a
                Monday with nothing written down yet doesn't blank the tile
                entirely, which is what made steps look broken. */}
            <Block>
              <div className="grid grid-cols-3 gap-2.5">
                <MiniTile
                  icon={<BoltIcon />}
                  label="Workouts"
                  value={derived.perWeek.average != null ? String(derived.perWeek.average) : '–'}
                  hint="per week"
                />
                <MiniTile
                  icon={<WaterIcon />}
                  label="Water"
                  value={
                    derived.water.average != null
                      ? String(Math.round(derived.water.average * 10) / 10)
                      : '—'
                  }
                  hint={derived.water.average != null ? 'per day · 3w' : 'Not tracked'}
                />
                <MiniTile
                  icon={<StepsIcon />}
                  label="Steps"
                  value={
                    derived.steps.average != null
                      ? formatSteps(Math.round(derived.steps.average))
                      : '—'
                  }
                  hint={derived.steps.average != null ? 'per day · 3w' : 'Not tracked'}
                />
              </div>
            </Block>

            {derived.volume.some((p) => p.sets > 0) && (
              <Block>
                <TrainingVolumeCard volume={derived.volume} />
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
        <div className="text-label font-semibold uppercase tracking-eyebrow text-white/60">
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
          <div className="text-label font-semibold uppercase tracking-eyebrow text-white/60">
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
            <div className="text-label font-semibold uppercase tracking-eyebrow text-white/60">
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
 * The week in a sentence or two, straight under the page title.
 *
 * The figures below it on this tab each answer one question; this is the one
 * place that says how they add up, the way Strava puts a line on an activity.
 * It sits on the page rather than in a card: it's the tab's opening line, not
 * another figure to weigh against the rest.
 * It's written from templates over the same facts (lib/summary), so it can
 * only say what the numbers do, and it reads the same with no signal.
 */
function WeekIntro({ facts, unit }: { facts: WeekFacts; unit: MachineUnit }) {
  const line = weekLine(facts, {
    // Stable for a given week and count, so it doesn't reshuffle on every visit
    // but does move on once another workout is in.
    seed: `${facts.weekStart}:${facts.workouts}`,
    weight: (kg) => {
      const v = Math.round(fromKgFor(kg, unit) * 10) / 10;
      return `${Number.isInteger(v) ? v : v.toFixed(1)} ${unit}`;
    },
  });
  if (!line) return null;
  const against = comparisonLabel(facts);
  return (
    // Set like the subtitle under Home's greeting, so the two tabs open the
    // same way, with a touch more room under the title.
    <div className="mt-2">
      <p className="text-base text-muted">{line}</p>
      <div className="mt-1.5 text-caption text-muted">
        {facts.which === 'this' ? 'This week' : 'Last week'}
        {against && ` · ${against}`}
      </div>
    </div>
  );
}

/**
 * A section's name and its controls, along the top of its card.
 *
 * Every section on the tab is one card, and it carries its own heading and
 * pills. Some used to put theirs on the page above the card instead, so the
 * tab switched between two patterns as you scrolled; now the pills always sit
 * in the card they govern.
 */
function CardHeader({ title, controls }: { title: string; controls?: React.ReactNode }) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-3">
      <SectionLabel>{title}</SectionLabel>
      {controls && <div className="shrink-0">{controls}</div>}
    </div>
  );
}

/** The segmented pills a card's header uses to switch what it shows. */
function Pills<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <div className="flex rounded-pill bg-surface-strong p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={`rounded-pill px-2.5 py-1 text-caption font-semibold ${
            value === o.key ? 'bg-ink text-white' : 'text-muted'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Twelve weeks of training, counted two ways.
 *
 * The only place on the tab that answers "how has it been going lately",
 * which is the question a chart is for — and the empty weeks are drawn,
 * because a month off is the most informative thing a season of training has
 * to say.
 *
 * Volume leads and sets are a tap away, because the two disagree in exactly
 * the case worth noticing: a block that gets heavier and shorter loses sets
 * while gaining kilograms, and either number alone reads as a verdict it
 * can't give. This replaced a sets line with an "intensity" line drawn over
 * it — a ratio against the window's own average, which needed a sentence of
 * explanation under every reading and still wasn't the number anyone wanted.
 * Kilograms are.
 */
function TrainingVolumeCard({ volume }: { volume: WeeklyVolumePoint[] }) {
  const [metric, setMetric] = useState<VolumeMetric>('kg');
  // The week in progress, not the window's total: the total is a number that
  // barely moves and that nobody acts on, while "is this a big week" is the
  // question the bar beside it is already answering.
  const thisWeek = volume[volume.length - 1]?.[metric] ?? 0;
  const change = weekVsAveragePct(volume, metric);
  const ticks = niceTicks(Math.max(...volume.map((p) => p[metric]), 0));
  const points = volume.map((p, i) => ({
    label: p.weekStart,
    value: p[metric],
    // The week in progress, drawn in ink so it reads as "now" rather than as
    // another finished bar that happens to be short.
    current: i === volume.length - 1,
  }));

  return (
    <div className="rounded-card bg-paper-card p-4 shadow-card">
      <CardHeader
        title="Training volume"
        controls={
          <Pills
            options={[
              { key: 'kg' as VolumeMetric, label: 'Volume' },
              { key: 'sets' as VolumeMetric, label: 'Sets' },
            ]}
            value={metric}
            onChange={setMetric}
          />
        }
      />
      <div className="mt-0.5 text-xs text-muted">Past 12 weeks</div>

      <div className="mt-1 flex items-baseline gap-1.5">
        <div className="text-display font-bold leading-none tracking-tight text-ink tabular-nums">
          {Math.round(thisWeek).toLocaleString('en-GB')}
        </div>
        <div className="text-base font-semibold text-muted">{metric === 'kg' ? 'kg' : 'sets'}</div>
      </div>
      {change != null && (
        <div className="mt-1.5 text-xs tabular-nums">
          <span
            className={`font-semibold ${
              change > 0 ? 'text-good' : change < 0 ? 'text-danger' : 'text-muted'
            }`}
          >
            {deltaArrow(change)} {fmtNum(Math.abs(change))}%
          </span>{' '}
          <span className="text-muted">vs 12-week average</span>
        </div>
      )}

      <div className="mt-3">
        <ResponsiveContainer width="100%" height={150}>
          <BarChart data={points} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
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
            {/* Anchored at zero. A week off is a real zero, and an axis that
                started at the smallest value would draw the gap as a shallow
                dip instead of the floor it is. */}
            <YAxis
              tick={{ fill: '#8E8E93', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={40}
              allowDecimals={false}
              domain={[0, ticks[ticks.length - 1]]}
              ticks={ticks}
              tickFormatter={(n) => compactNumber(Number(n))}
            />
            <Tooltip
              cursor={{ fill: 'rgba(10,10,10,0.04)' }}
              contentStyle={{ borderRadius: 12, border: '1px solid #E5E5EA', fontSize: 12 }}
              formatter={(v) => [
                metric === 'kg'
                  ? `${Math.round(Number(v)).toLocaleString('en-GB')} kg`
                  : `${v} ${Number(v) === 1 ? 'set' : 'sets'}`,
                metric === 'kg' ? 'Volume' : 'Sets',
              ]}
              labelFormatter={(d) =>
                `Week of ${new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                })}`
              }
            />
            <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false}>
              {points.map((p) => (
                <Cell key={p.label} fill={p.current ? '#0A0A0A' : 'rgba(10,10,10,0.14)'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/**
 * Axis marks at round numbers.
 *
 * Left to itself recharts divides the largest bar into five, which on real
 * volume gives an axis reading 38K, 28.5K, 19K — arithmetically correct and
 * unreadable at a glance. This rounds the step to a 1, 2, 2.5 or 5 and works
 * up from zero, so the marks land where a reader expects them.
 */
function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0];
  const rough = max / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalized = rough / magnitude;
  const step =
    (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10) *
    magnitude;
  const ticks: number[] = [];
  for (let v = 0; v < max; v += step) ticks.push(Math.round(v * 1000) / 1000);
  ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

/** 30000 → "30K". Keeps a 12-week volume axis inside 40px. */
function compactNumber(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return `${Number.isInteger(k) ? k : Math.round(k * 10) / 10}K`;
  }
  return String(Math.round(n));
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
  { key: 14, pill: '2w', prose: 'the two weeks before' },
  { key: 28, pill: '4w', prose: 'the four weeks before' },
  { key: 42, pill: '6w', prose: 'the six weeks before' },
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
  const { movers, previous } = comparison;
  const [lead, ...rest] = movers;
  const prose = PERIODS.find((p) => p.key === period)?.prose ?? '';

  return (
    <div className="overflow-hidden rounded-card bg-paper-card shadow-card">
      <div className="p-4 pb-0">
        <CardHeader
          title="Strength trends"
          controls={
            <Pills
              options={PERIODS.map((p) => ({ key: p.key, label: p.pill }))}
              value={period}
              onChange={onPeriod}
            />
          }
        />
      </div>

      {movers.length === 0 ? (
        <div className="px-4 pb-4 pt-3 text-sm text-muted">
          {previous.sets === 0
            ? `Nothing logged in ${prose}.`
            : 'Nothing trained in both windows.'}
        </div>
      ) : (
        <>
          <div className="px-4 py-3">
            <MoverHero
              move={lead}
              series={leadSeries}
              unit={unit}
              onOpen={canOpen(lead.normalizedName) ? () => onOpen(lead.normalizedName) : undefined}
            />
          </div>
          {rest.length > 0 && (
            <ul className="divide-y divide-line/60">
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
        className="flex w-full items-center justify-center gap-1 border-t border-line/60 py-3.5 text-sm font-semibold text-muted active:bg-surface active:text-ink"
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
        {/* Only a gain when it gained. In a deload week every lift is down
            and the top of the list is the smallest drop — still worth the
            card, not worth calling a gain. */}
        <div className="text-label font-semibold uppercase tracking-eyebrow text-white/60">
          {move.deltaPct > 1 ? 'Biggest gain' : 'Top mover'}
        </div>
        {onOpen && (
          <span className="text-white/60">
            <ChevronRight />
          </span>
        )}
      </div>
      <div className="mt-2 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold">
            <ExerciseName name={move.displayName} variant="inline" />
          </div>
          <div className="mt-1 text-display font-bold leading-none tracking-tight tabular-nums">
            {formatLoadShort(move.currentKg, unit)}
          </div>
          <div
            className={`mt-1.5 text-sm font-semibold tabular-nums ${
              move.deltaPct > 1
                ? 'text-good'
                : move.deltaPct < -1
                  ? 'text-danger'
                  : 'text-white/70'
            }`}
          >
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
  // A panel inside the Strength trends card, so a panel's corners and no
  // shadow of its own.
  const cls = 'w-full rounded-panel bg-ink p-4 text-left text-white';
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
 * Name, the set as it was logged, the change — one line, because that is all
 * three of them are. They were stacked in a right-hand column, which cost a
 * row's height to say the same thing and left the delta floating under a
 * weight it wasn't about. The earlier set isn't printed: the arrow and the
 * percentage say which way it went, and the set itself is one tap away.
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
    <div className="flex items-center gap-2 px-4 py-3.5">
      <span className="min-w-0 flex-1 truncate text-sm text-ink">
        <ExerciseName name={move.displayName} variant="inline" />
      </span>
      <span className="shrink-0 whitespace-nowrap text-xs font-semibold text-ink tabular-nums">
        {formatSetShort(move.currentKg, move.currentReps, unit)}
      </span>
      <span
        className={`w-14 shrink-0 whitespace-nowrap text-right text-xs font-semibold tabular-nums ${
          up ? 'text-good' : down ? 'text-danger' : 'text-muted'
        }`}
      >
        {deltaArrow(move.deltaPct)} {fmtNum(Math.abs(move.deltaPct))}%
      </span>
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
  // One gap for every card. Each carries its own heading, so none needs extra
  // room above it to read as a new section.
  return <div className="mt-6">{children}</div>;
}

// --- One movement, on its own screen ---------------------------------------

type DetailRange = 7 | 14 | 30 | 90 | 182 | 365 | 0;

// The pill governs the figure, so the words beside it only have to name the
// span — "in the last three months" wrapped onto a second line to say what
// "3 months" already said.
const RANGE_LABELS: { days: DetailRange; label: string; prose: string }[] = [
  { days: 7, label: '1w', prose: 'this week' },
  { days: 14, label: '2w', prose: '2 weeks' },
  { days: 30, label: '1m', prose: '1 month' },
  { days: 90, label: '3m', prose: '3 months' },
  { days: 182, label: '6m', prose: '6 months' },
  { days: 365, label: '1y', prose: '1 year' },
  { days: 0, label: 'All', prose: 'all time' },
];

/** Sessions before the list offers to show the rest. */
const PROGRESSION_ROWS = 5;

/**
 * One movement, on its own screen.
 *
 * Built around estimated 1RM rather than around the heaviest set ever done.
 * An all-time best is a fact you check once; what you come back for is
 * whether the thing is moving, and 1RM is the measure that answers it across
 * changing rep ranges — 60×10 and 80×3 are the same lift told two ways, and
 * only an estimate can say which was stronger.
 *
 * The all-time figures keep their place, but as three supporting numbers in
 * one card rather than as the headline. The range pills govern everything
 * above the records card — the figure, the percentage and the chart all
 * describe the same span, so the page can't quote one window while drawing
 * another.
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
  const [range, setRange] = useState<DetailRange>(30);
  const [showAll, setShowAll] = useState(false);
  const recordName = splitBrand(record.displayName);
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

  const points = useMemo(() => {
    const scored = inRange.filter((p) => p.bestEst1RMkg != null);
    return scored.map((p, i) => {
      const value = fromKgFor(p.bestEst1RMkg!, record.unit);
      const before = i > 0 ? fromKgFor(scored[i - 1].bestEst1RMkg!, record.unit) : null;
      return {
        label: p.date,
        value,
        // Against the session before it, so the tooltip answers "was that one
        // better than the last one" without any arithmetic.
        delta: before != null && before > 0 ? ((value - before) / before) * 100 : null,
      };
    });
  }, [inRange, record.unit]);
  const changePct = useMemo(() => est1RMChangePct(inRange), [inRange]);
  const prose = RANGE_LABELS.find((r) => r.days === range)?.prose ?? '';

  // The headline: the best estimate in this window, not all time — the card
  // below carries the all-time one.
  const latest = points.length > 0 ? points[points.length - 1].value : null;
  const mostReps = useMemo(() => mostRepsIn(history), [history]);

  const rows = useMemo(() => [...inRange].reverse(), [inRange]);
  const shown = showAll ? rows : rows.slice(0, PROGRESSION_ROWS);

  return (
    <div className="pb-nav min-h-screen bg-paper">
      <div
        // No safe-area padding here: PageHeader's sticky bar carries it.
        className="mx-auto max-w-md px-5"
      >
        {/* PageHeader already draws the large title and collapses it into the
            sticky bar on scroll, so the movement's name is not repeated here.
            The body part stands in for the machine note the design asks for —
            there is nowhere in the schema to keep "the white one". */}
        <PageHeader title={recordName.movement} onBack={onBack} />
        {(recordName.brand || record.bodyPart) && (
          <p className="mt-1 text-base text-muted">
            {[recordName.brand, record.bodyPart].filter(Boolean).join(' · ')}
          </p>
        )}

        {/* Seven windows, from a week to everything. The old four started at a
            month, which is too coarse to see whether this week went well. */}
        <div className="mt-4 flex rounded-pill bg-surface-strong p-0.5">
          {RANGE_LABELS.map((r) => (
            <button
              key={r.label}
              type="button"
              onClick={() => setRange(r.days)}
              className={`flex-1 rounded-pill py-1.5 text-caption font-semibold ${
                range === r.days ? 'bg-ink text-white' : 'text-muted'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="mt-5">
          {/* Sentence case, not the tracked uppercase the dashboard uses for
              its section labels: this names the number directly under it
              rather than heading a region of the page. */}
          <div className="text-sm text-muted">Estimated 1RM</div>
          {latest != null ? (
            <>
              <div className="mt-1 flex items-baseline gap-1.5">
                <div className="text-display-lg font-bold leading-none tracking-tight text-ink tabular-nums">
                  {fmtNum(latest)}
                </div>
                <div className="text-base font-semibold text-muted">
                  {record.unit === 'pin' ? 'pin' : record.unit}
                </div>
              </div>
              {changePct != null && (
                <div className="mt-1.5 text-sm tabular-nums">
                  <span
                    className={`font-semibold ${
                      changePct > 1
                        ? 'text-good'
                        : changePct < -1
                          ? 'text-danger'
                          : 'text-muted'
                    }`}
                  >
                    {deltaArrow(changePct)} {fmtNum(Math.abs(changePct))}%
                  </span>{' '}
                  <span className="text-muted">{prose}</span>
                </div>
              )}
            </>
          ) : (
            <div className="mt-1 text-base font-semibold text-muted">Nothing logged in range</div>
          )}
        </div>

        {points.length >= 2 ? (
          <div className="mt-4">
            <Est1RMChart points={points} unitLabel={record.unit} />
          </div>
        ) : (
          <div className="mt-4 flex h-[180px] items-center justify-center rounded-card bg-paper-card px-6 text-center text-sm text-muted shadow-card">
            {points.length === 0
              ? 'Nothing logged in this range.'
              : 'One session in this range — keep logging to see the trend.'}
          </div>
        )}

        <div className="mt-7 rounded-card bg-paper-card p-4 shadow-card">
          <div className="flex items-center gap-2">
            <span className="text-ink">
              <BarsIcon />
            </span>
            <div className="text-base font-bold tracking-tight text-ink">Personal records</div>
          </div>
          <div className="mt-4 flex items-stretch divide-x divide-line">
            <PersonalRecord
              label="Heaviest weight"
              value={
                record.heaviest ? formatLoadShort(record.heaviest.weightKg ?? 0, record.unit) : '–'
              }
            />
            <PersonalRecord
              label="Estimated 1RM"
              value={record.best1RMkg > 0 ? formatLoadShort(record.best1RMkg, record.unit) : '–'}
            />
            <PersonalRecord label="Most reps" value={mostReps != null ? String(mostReps) : '–'} />
          </div>
        </div>

        {rows.length > 0 && (
          <div className="mt-4 rounded-card bg-paper-card p-4 shadow-card">
            <div className="text-base font-bold tracking-tight text-ink">Recent progression</div>
            <ul className="mt-2 divide-y divide-line/60">
              {shown.map((p) => (
                <li key={p.date} className="flex items-baseline gap-3 py-3">
                  <span className="w-20 shrink-0 text-sm text-muted">{shortDate(p.at)}</span>
                  <span className="min-w-0 flex-1 text-sm font-semibold text-ink tabular-nums">
                    {p.topWeightKg != null && p.repsAtTopWeight != null
                      ? formatSetShort(p.topWeightKg, p.repsAtTopWeight, record.unit)
                      : '–'}
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-sm text-muted tabular-nums">
                    {p.bestEst1RMkg != null
                      ? `${formatLoadShort(p.bestEst1RMkg, record.unit)} e1RM`
                      : ''}
                  </span>
                </li>
              ))}
            </ul>
            {rows.length > shown.length && (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="mt-2 flex w-full items-center justify-center gap-1 rounded-card bg-surface-strong py-3.5 text-sm font-semibold text-muted active:bg-pressed active:text-ink"
              >
                View full history <ChevronRight />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** One of the three all-time figures, in a divided row. */
function PersonalRecord({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col px-2 first:pl-0 last:pr-0">
      {/* Wraps rather than clips, for a label too long for a third of a
          phone. The card's own heading says these are personal records, so
          none of them repeats the word "best". */}
      <div className="text-caption leading-tight text-muted">{label}</div>
      <div className="mt-auto truncate pt-1 text-lg font-bold leading-tight tracking-tight text-ink tabular-nums">
        {value}
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

/**
 * Estimated 1RM over the chosen window.
 *
 * One series where there used to be two. The old chart drew top weight and
 * reps on separate axes, which made every question a two-step read — was that
 * dip a lighter day or the same weight for fewer reps? — and answered it in a
 * legend. Estimated 1RM folds both into the figure the page is already
 * headlined with, so the line and the number agree by construction.
 */
/**
 * The reading under the pointer: when, how much, and whether it beat the
 * session before it. Three short lines, because a chart tooltip is asked for
 * rather than read in passing — the page itself stays wordless.
 */
function Est1RMTooltip({
  active,
  payload,
  unitLabel,
}: {
  active?: boolean;
  payload?: { payload: { label: string; value: number; delta: number | null } }[];
  unitLabel: MachineUnit;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="rounded-control bg-ink px-3 py-2 shadow-lift">
      <div className="text-caption text-white/60">
        {new Date(point.label).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
      </div>
      <div className="mt-0.5 text-sm font-bold text-white tabular-nums">
        {fmtNum(point.value)} {unitLabel === 'pin' ? 'pin' : unitLabel}
      </div>
      {point.delta != null && Math.abs(point.delta) >= 0.05 && (
        <div
          className={`text-caption font-semibold tabular-nums ${
            point.delta > 0 ? 'text-good' : 'text-danger-strong'
          }`}
        >
          {point.delta > 0 ? '+' : '−'}
          {fmtNum(Math.abs(point.delta))}%
        </div>
      )}
    </div>
  );
}

function Est1RMChart({
  points,
  unitLabel,
}: {
  points: { label: string; value: number }[];
  unitLabel: MachineUnit;
}) {
  return (
    <div className="rounded-card bg-paper-card p-4 shadow-card">
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="e1rm-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0A0A0A" stopOpacity={0.12} />
              <stop offset="100%" stopColor="#0A0A0A" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#E5E5EA" strokeDasharray="3 4" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: '#8E8E93', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            minTickGap={28}
            tickFormatter={(d) =>
              new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
            }
          />
          <YAxis
            tick={{ fill: '#8E8E93', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={36}
            domain={['dataMin - 4', 'dataMax + 4']}
            tickFormatter={(n) => String(Math.round(Number(n)))}
          />
          <Tooltip cursor={{ stroke: '#C9C9CE', strokeWidth: 1 }} content={<Est1RMTooltip unitLabel={unitLabel} />} />
          <Area
            type="monotone"
            dataKey="value"
            stroke="#0A0A0A"
            strokeWidth={2}
            fill="url(#e1rm-fill)"
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive
            animationDuration={900}
            animationEasing="ease-out"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// --- Body weight ---------------------------------------------------------------

function BodyWeightCard({
  rows,
  bwUnit,
  rangeLabel,
  controls,
}: {
  /** Newest first, already filtered to the selected range. */
  rows: PerformanceData['bodyWeights'];
  bwUnit: BodyWeightUnit;
  /** "over 12 weeks" — names the window the change is measured across. */
  rangeLabel: string;
  /** The range pills, for the card's header. */
  controls: React.ReactNode;
}) {
  // Sorted on the date the chart is keyed by, so no caller's ordering can
  // flip it — see bodyWeightChange, which had to learn this the hard way.
  const ascending = useMemo(
    () => [...rows].sort((a, b) => (a.recorded_on < b.recorded_on ? -1 : 1)),
    [rows],
  );
  const points = useMemo(
    () =>
      ascending.map((r) => ({
        label: r.recorded_on,
        value: bwUnit === 'kg' ? r.weight_kg : toDecimalStones(r.weight_kg),
      })),
    [ascending, bwUnit],
  );

  // Both figures come from the rows the chart is drawing, so the number and
  // the picture can't disagree. The change used to be measured from the start
  // of the plan however far back the pills were set, which meant moving the
  // range redrew the graph and left the delta saying something about a
  // different span of time.
  const { latestKg, deltaKg } = useMemo(() => bodyWeightChange(rows), [rows]);

  return (
    <div className="rounded-card bg-paper-card p-4 shadow-card">
      <CardHeader title="Body weight" controls={controls} />
      {latestKg != null && (
        <div className="mt-1">
          <div className="flex items-baseline gap-1.5">
            <div className="text-display font-bold leading-none tracking-tight text-ink tabular-nums">
              {bwUnit === 'st' ? formatStoneLb(latestKg) : fmtNum(latestKg)}
            </div>
            {bwUnit === 'kg' && <div className="text-base font-semibold text-muted">kg</div>}
          </div>
          {deltaKg != null && (
            <div className="mt-1.5 text-xs tabular-nums">
              <span
                className={`font-semibold ${
                  deltaKg > 0 ? 'text-good' : deltaKg < 0 ? 'text-danger' : 'text-muted'
                }`}
              >
                {deltaKg > 0 ? '↑' : deltaKg < 0 ? '↓' : '·'}{' '}
                {formatBwDelta(Math.abs(deltaKg), bwUnit)}
              </span>{' '}
              <span className="text-muted">{rangeLabel}</span>
            </div>
          )}
        </div>
      )}
      <div className="mt-3">
        {points.length < 2 ? (
          <div className="flex h-[140px] items-center justify-center px-6 text-center text-sm text-muted">
            Log your body weight on more days to see the trend.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={140}>
            <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="bw-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0A0A0A" stopOpacity={0.1} />
                  <stop offset="100%" stopColor="#0A0A0A" stopOpacity={0} />
                </linearGradient>
              </defs>
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
              {/* A dot on every reading turned a year of daily weigh-ins into a
                  string of beads. Only the latest is marked — the one the
                  headline above is quoting. */}
              <Area
                type="monotone"
                dataKey="value"
                stroke="#0A0A0A"
                strokeWidth={2}
                fill="url(#bw-fill)"
                dot={false}
                activeDot={{ r: 4 }}
                isAnimationActive
                animationDuration={900}
                animationEasing="ease-out"
              />
            </AreaChart>
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
    // The same gap under the title as a populated Performance (mt-2 + Block's
    // first:mt-6) and as the upload screen's drop zone, so nothing jumps
    // between the two tabs before there's a plan.
    <div className="mt-8 rounded-card bg-paper-card p-8 text-center shadow-card">
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

function toDecimalStones(kg: number): number {
  const { stones, pounds } = kgToStoneLb(kg);
  return stones + pounds / 14;
}

function fmtNum(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}
