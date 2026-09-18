import { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend } from 'recharts';
import { PageHeader } from '../components/PageHeader';
import { Tile, ChevronRight, BarsIcon, DumbbellIcon } from '../components/Tile';
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
import { headlineRecords } from '../lib/records';
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
  computeWeekStreak,
  computeWeeklyLoad,
  type WeekStreak,
  type WeeklyLoadPoint,
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
    const { perf, records, plan, sessions, week } = data;
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
      load: computeWeeklyLoad(perf.sets),
      perWeek: computeWorkoutsPerWeek(gymSessions, activatedAt),
      strength: computeOverallStrength(perf.sets, activatedAt),
      mostImproved,
      mostImprovedSeries: mostImproved
        ? buildWeeklySeries(perf.sets, 'est1rm', { normalizedName: mostImproved.normalizedName })
        : [],
      bodyWeight: summarizeBodyWeight(perf.bodyWeights, activatedAt),
      newPrs: newRecordCount(records),
      dots: weekDots(week.bars),
      topRecords: headlineRecords(records),
    };
  }, [data]);

  const hasAnyData =
    !!data &&
    (data.records.length > 0 ||
      data.perf.bodyWeights.length > 0 ||
      data.sessions.length > 0 ||
      !!data.plan);

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
                        ? `${derived.consistency.done} of ${derived.consistency.planned} planned`
                        : 'needs an active plan'
                    }
                    visual={<DotRow dots={derived.dots} />}
                  />
                </div>
              </Block>
            )}

            <Block>
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
                          bwUnit,
                        )} ${derived.bodyWeight.since === 'plan' ? 'this plan' : 'overall'}`
                      : 'no change yet'
                  }
                />
              </div>
            </Block>

            {data.perf.bodyWeights.length > 0 && (
              <Block>
                <BodyWeightCard
                  rows={bodyWeightRange(data.perf.bodyWeights, bwRange).slice().reverse()}
                  bwUnit={bwUnit}
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
                <TrainingLoadCard load={derived.load} perWeek={derived.perWeek.average} />
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
              <Block>
                <TopRecords records={derived.topRecords} onViewAll={() => setView('records')} />
              </Block>
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

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const TODAY_IDX = (new Date().getDay() + 6) % 7;

function DotRow({ dots }: { dots: boolean[] }) {
  return (
    <div className="flex justify-between">
      {dots.map((on, i) => (
        <div key={i} className="flex flex-col items-center gap-1">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              on ? 'bg-ink' : i > TODAY_IDX ? 'bg-surface-strong' : 'bg-line'
            }`}
          />
          <span className="text-label text-muted">{DAY_LETTERS[i]}</span>
        </div>
      ))}
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
      visual={
        live && longest > current ? (
          <div className="text-caption text-muted tabular-nums">Best: {longest} weeks</div>
        ) : undefined
      }
    />
  );
}

/**
 * Twelve weeks of training, in sets.
 *
 * The rest of the tab looks at a fortnight or at one lift. This is the only
 * place that answers "how has it been going lately", which is the question a
 * chart is for — and the empty weeks are drawn, because a month off is the
 * most informative thing a season of training has to say.
 *
 * Built like the body-weight chart rather than as a sparkline: two charts on
 * one screen drawn in two different idioms read as two different apps, and
 * this one has axes worth labelling.
 */
function TrainingLoadCard({ load, perWeek }: { load: WeeklyLoadPoint[]; perWeek: number | null }) {
  const thisWeek = load[load.length - 1]?.sets ?? 0;
  const average = Math.round(load.reduce((sum, p) => sum + p.sets, 0) / load.length);
  const points = load.map((p) => ({ label: p.weekStart, value: p.sets }));

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
      <div className="mt-3">
        <ResponsiveContainer width="100%" height={140}>
          <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
              tick={{ fill: '#8E8E93', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={40}
              allowDecimals={false}
              domain={[0, 'dataMax + 4']}
            />
            <Tooltip
              contentStyle={{ borderRadius: 12, border: '1px solid #E5E5EA', fontSize: 12 }}
              formatter={(v) => [`${v} ${Number(v) === 1 ? 'set' : 'sets'}`, 'Logged']}
              labelFormatter={(d) =>
                `Week of ${new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                })}`
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
          {strength.pct != null ? (
            <div className="mt-0.5 text-2xl font-bold leading-none tracking-tight text-ink tabular-nums">
              {`${strength.pct > 0 ? '+' : ''}${fmtNum(strength.pct)}%`}
            </div>
          ) : (
            // A sentence set at the size of a headline number reads as a
            // headline. This one is a placeholder for a number we haven't got.
            <div className="mt-0.5 text-base font-semibold leading-tight text-muted">
              Not enough data yet
            </div>
          )}
          <div className="mt-1 text-xs text-muted">{hint}</div>
        </div>
        {strength.series.length >= 2 && (
          <div className="h-12 w-28 shrink-0">
            <Sparkline
              values={strength.series.map((p) => p.pct)}
              stroke="#0A0A0A"
              fill="rgba(10,10,10,0.08)"
            />
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
              className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left active:bg-surface"
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
    const lb = Math.round((kg / 0.45359237) * 10) / 10;
    return `${fmtNum(lb)} lb`;
  }
  return `${fmtNum(kg)} kg`;
}

function formatLoadShort(kg: number, unit: MachineUnit): string {
  const v = fmtNum(fromKgFor(kg, unit));
  return unit === 'pin' ? `pin ${v}` : `${v} ${unit}`;
}

// --- Icons -------------------------------------------------------------------------------

function ScaleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="12" height="12" rx="3" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M6.5 7.5a2.5 2.5 0 0 1 5 0"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
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

function LiftHistory({ sets, record }: { sets: PerformanceData['sets']; record: LiftRecord }) {
  const history = useMemo(
    () => buildExerciseHistory(sets, record.normalizedName),
    [sets, record.normalizedName],
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
    [history, record.unit],
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
    [rows, bwUnit],
  );

  return (
    <div className="rounded-card bg-paper-card p-4 shadow-card">
      <div className="flex items-center justify-between">
        <SectionLabel>Body weight</SectionLabel>
        {controls}
      </div>
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
