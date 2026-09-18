import { useEffect, useRef, useState } from 'react';
import { TrainingDayCard } from '../components/TrainingDayCard';
import { WeeklyProgress } from '../components/WeeklyProgress';
import { weeksOnPlan, type FullPlan } from '../lib/plansApi';
import {
  baseDayName,
  buildDaySlots,
  dueVariant,
  siblingVariant,
  type DaySlot,
} from '../lib/daySlots';
import {
  type ActiveSessionContext,
  type WeekSummary,
} from '../lib/sessionsApi';
import { adjustWater, getWaterGoal, getWaterUnit } from '../lib/waterApi';
import { formatSteps, getStepGoal } from '../lib/stepsApi';
import { getQuickActions, type QuickActionId } from '../lib/quickActions';
import { getCachedHomeData, loadHomeData, patchHomeCache } from '../lib/homeCache';
import { SyncStatus } from '../components/SyncStatus';
import { requestFlush } from '../lib/offline/outbox';
import { warmLastSetsForPlan } from '../lib/sessionsApi';
import { useNetStatus } from '../lib/offline/net';
import type { Profile } from '../lib/profileApi';
import { greetingName } from '../lib/displayName';
import { haptics } from '../lib/haptics';

type Day = FullPlan['training_days'][number];

interface Props {
  onUploadPlan: () => void;
  onLogBodyWeight: () => void;
  onLogSteps: () => void;
  // Opens a training day. `sibling` is the other week's version of the same day
  // type, when the plan rotates — DayView offers a switch to it.
  onTapDay: (day: Day, sibling?: Day | null) => void;
  profile?: Profile | null;
  onResumeOnboarding?: () => void;
  onResumeWorkout?: (params: {
    day: Day;
    exerciseIdx: number;
    sessionId: string;
    startedAt: string;
  }) => void;
}

const ONBOARDING_BANNER_DISMISSED_KEY = 'reps.onboardingBannerDismissed';

const ACCENTS: Record<string, string> = {
  Push: 'bg-[#FFE9D6]',
  Pull: 'bg-[#E5F0FF]',
  Legs: 'bg-[#E8F5E9]',
  Upper: 'bg-[#F3E5F5]',
  Arms: 'bg-[#FFF3E0]',
  Abs: 'bg-[#E0F7FA]',
};

const FALLBACK_ACCENT = 'bg-[#F0F0F0]';

/**
 * The bar that creeps across a quick action tile as its count rises. One grey
 * for all of them: the tiles sit on white cards in a greyscale app, and a
 * colour each turned the row into the loudest thing on the screen.
 */
const TILE_FILL = 'bg-[#EAEAEE]';

/** Accent for a day, ignoring any rotation number: "Legs 2" reads as Legs. */
function accentFor(dayName: string): string {
  return (
    ACCENTS[dayName] ?? ACCENTS[dayName.replace(/\s+\d+$/, '')] ?? FALLBACK_ACCENT
  );
}
/**
 * The greeting, with or without a name.
 *
 * Splitting it here rather than inline keeps the two call sites (skeleton and
 * loaded) identical — they used to drift. The name goes on its own line only
 * when the greeting is two words, so "Good afternoon," never wraps mid-phrase.
 */
function Greeting({ name }: { name: string | null }) {
  const hello = greeting();
  return (
    <h1 className="text-display font-bold leading-tight tracking-[-0.02em] text-ink">
      {name == null ? (
        `${hello}.`
      ) : (
        <>
          {hello},
          {hello.includes(' ') ? <span className="block">{name}.</span> : <> {name}.</>}
        </>
      )}
    </h1>
  );
}

function bodyPartsForDay(exercises: { body_part: string | null }[]): string {
  const parts: string[] = [];
  for (const e of exercises) {
    if (e.body_part && !parts.includes(e.body_part)) parts.push(e.body_part);
  }
  return parts.join(' · ');
}

function getNextDayName(
  days: { name: string }[],
  lastCompleted: string | null,
  completedThisWeek: string[]
) {
  if (days.length === 0) return null;
  // Prefer the earliest plan-day that hasn't been done yet this week — so
  // if someone skips Legs and does Arms instead, Legs still comes up next
  // instead of wrapping back to Push.
  const doneThisWeek = new Set(completedThisWeek);
  const firstUnfinished = days.find((d) => !doneThisWeek.has(d.name));
  if (firstUnfinished) return firstUnfinished.name;
  // Every plan-day has been done this week — fall back to "next after last
  // completed, wrapping" so we suggest something rather than nothing.
  if (!lastCompleted) return days[0].name;
  const idx = days.findIndex((d) => d.name === lastCompleted);
  if (idx === -1) return days[0].name;
  return days[(idx + 1) % days.length].name;
}

// Hide the "Up next" banner once the user has clearly stopped following plan
// order, so they don't get a suggestion that doesn't match what they're
// actually about to do. recentPositions is newest-first.
export function shouldShowUpNext(recentPositions: number[], planLength: number): boolean {
  if (planLength <= 0 || recentPositions.length < 2) return true;
  const inOrder: boolean[] = [];
  for (let i = 0; i < recentPositions.length - 1; i++) {
    const expected = (recentPositions[i + 1] + 1) % planLength;
    inOrder.push(recentPositions[i] === expected);
  }
  // Recovery: last two completed sessions were both in plan order → resume.
  if (inOrder.length >= 2 && inOrder[0] && inOrder[1]) return true;
  // Suppress: the three most recent sessions were all jumps.
  if (inOrder.length >= 3 && !inOrder[0] && !inOrder[1] && !inOrder[2]) return false;
  return true;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 22) return 'Good evening';
  return 'Hey';
}

export function Home({
  onUploadPlan,
  onLogBodyWeight,
  onLogSteps,
  onTapDay,
  onResumeWorkout,
  profile,
  onResumeOnboarding,
}: Props) {
  const [bannerDismissed, setBannerDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(ONBOARDING_BANNER_DISMISSED_KEY) === '1';
  });

  function dismissBanner() {
    setBannerDismissed(true);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ONBOARDING_BANNER_DISMISSED_KEY, '1');
    }
  }

  const showOnboardingBanner =
    !!profile && !profile.onboarding_completed && !bannerDismissed && !!onResumeOnboarding;
  // Null until they've told us, and null is a perfectly good greeting.
  const firstName = greetingName(profile?.display_name);
  const offline = !useNetStatus().reachable;
  // Hydrate synchronously from the module-level cache so tab switches don't
  // flash the skeleton. A background refresh always runs on mount to pick up
  // any drift.
  const initial = getCachedHomeData();
  const [plan, setPlan] = useState<FullPlan | null>(initial?.plan ?? null);
  const [lastCompleted, setLastCompleted] = useState<string | null>(
    initial?.lastCompleted ?? null
  );
  const [waterCount, setWaterCount] = useState(initial?.waterCount ?? 0);
  const [waterGoal] = useState(() => getWaterGoal());
  const [waterUnit] = useState(() => getWaterUnit());
  const [waterBusy, setWaterBusy] = useState(false);
  const [waterError, setWaterError] = useState<string | null>(null);
  const [stepCount, setStepCount] = useState(initial?.stepCount ?? 0);
  const [stepGoal] = useState(() => getStepGoal());
  // Which tiles the row shows, and in what order — set in Profile. Read once:
  // changing it there unmounts Home, so it's re-read on the way back.
  const [quickActions] = useState<QuickActionId[]>(() => getQuickActions());
  // Where the quick action row is scrolled to, so the edge fades only show on
  // the side that actually has more tiles. Tiles are as wide as their own
  // contents, so whether the row overflows at all has to be measured rather
  // than worked out in advance — `readRowEdges` runs as the row's ref on every
  // render, and again on every scroll. It only ever sets state when one of the
  // two answers has actually changed.
  const [rowEdges, setRowEdges] = useState({ atStart: true, atEnd: true });

  function readRowEdges(el: HTMLDivElement | null) {
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const next = { atStart: el.scrollLeft <= 4, atEnd: el.scrollLeft >= max - 4 };
    setRowEdges((prev) =>
      prev.atStart === next.atStart && prev.atEnd === next.atEnd ? prev : next
    );
  }
  const [loading, setLoading] = useState(!initial);
  const [active, setActive] = useState<ActiveSessionContext | null>(
    initial?.active ?? null
  );
  const [weekSummary, setWeekSummary] = useState<WeekSummary>(
    initial?.weekSummary ?? {
      workoutsDone: 0,
      bars: [[], [], [], [], [], [], []],
      dayDetails: [[], [], [], [], [], [], []],
    }
  );
  const [completedThisWeek, setCompletedThisWeek] = useState<string[]>(
    initial?.completedThisWeek ?? []
  );
  const [recentPositions, setRecentPositions] = useState<number[]>(
    initial?.recentPositions ?? []
  );
  const [lastCompletedByDay, setLastCompletedByDay] = useState<Record<string, string>>(
    initial?.lastCompletedByDay ?? {}
  );


  useEffect(() => {
    let mounted = true;
    // Landing on Home is a good moment to push anything logged offline.
    requestFlush();
    (async () => {
      try {
        const data = await loadHomeData();
        if (!mounted) return;
        setPlan(data.plan);
        setLastCompleted(data.lastCompleted);
        setWaterCount(data.waterCount);
        setStepCount(data.stepCount ?? 0);
        setActive(data.active);
        setWeekSummary(data.weekSummary);
        setCompletedThisWeek(data.completedThisWeek);
        setRecentPositions(data.recentPositions);
        setLastCompletedByDay(data.lastCompletedByDay ?? {});
        // Home is the screen that gets opened on wifi. Pull every exercise's
        // last weights onto the phone now, so a workout started in a basement
        // gym still pre-fills.
        warmLastSetsForPlan().catch(() => {});
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  async function handleWaterTap(delta: number) {
    if (waterBusy) return;
    setWaterBusy(true);
    setWaterError(null);
    try {
      const next = await adjustWater(delta);
      setWaterCount(next);
      patchHomeCache({ waterCount: next });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not save water count';
      setWaterError(msg);
      console.error('[water] adjust failed', err);
    } finally {
      setWaterBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-paper pb-28">
        <div
          className="mx-auto max-w-md px-5"
          style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 40px)' }}
        >
          <Greeting name={firstName} />
          <p className="mt-1.5 text-base text-muted">Ready to crush your goals today?</p>
          <div className="mt-6 h-[180px] animate-pulse rounded-card bg-paper-card shadow-card" />
          <div className="mt-8 h-3 w-24 animate-pulse rounded bg-line" />
          <div className="mt-3 h-14 animate-pulse rounded-card bg-paper-card shadow-card" />
        </div>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="min-h-screen bg-paper pb-28">
        <div
          className="mx-auto max-w-md px-5"
          style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 40px)' }}
        >
          {showOnboardingBanner && (
            <OnboardingBanner
              onResume={() => onResumeOnboarding?.()}
              onDismiss={dismissBanner}
            />
          )}
          <div className={`${showOnboardingBanner ? 'mt-5' : 'mt-12'} rounded-card bg-paper-card p-8 text-center shadow-card`}>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-panel bg-surface-strong">
              <UploadCloudIcon />
            </div>
            <h2 className="mt-5 text-2xl font-bold tracking-tight text-ink">
              {offline ? "Can't reach your plan" : 'Welcome to Reps.'}
            </h2>
            <p className="mt-2 text-sm text-muted">
              {offline
                ? "You're offline and this phone hasn't got a copy of your plan yet. Open Reps once with signal and it'll be here next time, connection or not."
                : "Drop in your first training plan PDF and we'll turn it into trackable training days."}
            </p>
            {!offline && (
              <button
                onClick={onUploadPlan}
                className="pressable mt-6 w-full rounded-pill bg-ink py-4 text-base font-semibold text-white transition-opacity active:opacity-80"
              >
                Upload your plan
              </button>
            )}
          </div>
          {!offline && (
            <div className="mt-4 rounded-card bg-paper-card p-8 text-center shadow-card">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-panel bg-surface-strong">
                <PencilIcon />
              </div>
              <h2 className="mt-5 text-2xl font-bold tracking-tight text-ink">
                Build your own plan.
              </h2>
              <p className="mt-2 text-sm text-muted">
                Put a plan together day by day, without a PDF to upload.
              </p>
              <button
                disabled
                className="mt-6 w-full cursor-not-allowed rounded-pill bg-surface-strong py-4 text-base font-semibold text-muted"
              >
                Coming soon
              </button>
            </div>
          )}
          {!offline && <WhatsInside />}
        </div>
      </div>
    );
  }

  // One card per day type. A rotating plan's "Legs 1" and "Legs 2" fold into a
  // single Legs slot whose card opens whichever version was completed longest
  // ago — each day alternates on its own, like a weekly exercise alternative.
  // Plans without a rotation come out as one slot per day, unchanged.
  const completedByDay = new Map(Object.entries(lastCompletedByDay));
  const slots = buildDaySlots(plan.training_days ?? []);
  const dueBySlot = new Map(slots.map((s) => [s.name, dueVariant(s, completedByDay)]));
  const mainSlots = slots.filter(
    (s) => s.name !== 'Abs' && !s.variants.every((v) => v.reference_only === true)
  );
  // Completed-this-week names are variant names ("Legs 1"); the cards and the
  // up-next cycle work in day types, so fold them down.
  const completedSlotNames = completedThisWeek.map(baseDayName);
  const nextSlotName = getNextDayName(mainSlots, lastCompleted ? baseDayName(lastCompleted) : null, completedSlotNames);
  const nextSlot = nextSlotName ? mainSlots.find((s) => s.name === nextSlotName) : undefined;
  const nextDay = nextSlot ? dueBySlot.get(nextSlot.name) : undefined;
  // Recent-session positions are the variant days' plan positions (0–7 on a
  // two-week plan); the in-order check runs over the four slots, so translate.
  // Doing Legs 1 → Push 1 → … → Legs 2 is plan order, not jumping around.
  const slotIndexByDayPosition = new Map<number, number>();
  mainSlots.forEach((slot, i) => {
    for (const v of slot.variants) slotIndexByDayPosition.set(v.position, i);
  });
  const recentSlotPositions = recentPositions
    .map((p) => slotIndexByDayPosition.get(p))
    .filter((i): i is number => i != null);
  const showNextDay = shouldShowUpNext(recentSlotPositions, mainSlots.length);

  const showRowStartFade = !rowEdges.atStart;
  const showRowEndFade = !rowEdges.atEnd;

  function openSlot(slot: DaySlot) {
    const due = dueBySlot.get(slot.name);
    if (due) onTapDay(due, siblingVariant(slot, due));
  }

  function isReferenceSlot(slot: DaySlot): boolean {
    return slot.variants.every((v) => v.reference_only === true);
  }

  function slotSubtitle(slot: DaySlot): string {
    const due = dueBySlot.get(slot.name);
    const parts = bodyPartsForDay(due?.plan_exercises ?? []);
    return isReferenceSlot(slot) ? `${parts} · in your own time` : parts;
  }

  /** The card's pill: which week's version is due, or Home for the abs card. */
  function slotTag(slot: DaySlot): string | null {
    if (isReferenceSlot(slot)) return 'Home';
    const due = dueBySlot.get(slot.name);
    if (slot.variants.length > 1 && due?.week_index != null) {
      return `Week ${due.week_index}`;
    }
    return null;
  }

  return (
    <div className="min-h-screen bg-paper pb-28">
      <div
        className="mx-auto max-w-md px-5"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 40px)' }}
      >
        {showOnboardingBanner && (
          <OnboardingBanner
            onResume={() => onResumeOnboarding?.()}
            onDismiss={dismissBanner}
          />
        )}

        {active && (
          <ActiveWorkoutBanner
            context={active}
            exerciseCount={
              plan?.training_days.find((d) => d.id === active.trainingDayId)
                ?.plan_exercises?.length ?? null
            }
            onResume={() => {
              if (!plan || !onResumeWorkout) return;
              const day = plan.training_days.find((d) => d.id === active.trainingDayId);
              if (!day) return;
              const exercises = day.plan_exercises ?? [];
              const lastIdx = active.lastPlanExerciseId
                ? exercises.findIndex((e) => e.id === active.lastPlanExerciseId)
                : 0;
              onResumeWorkout({
                day,
                exerciseIdx: Math.max(0, lastIdx === -1 ? 0 : lastIdx),
                sessionId: active.sessionId,
                startedAt: active.startedAt,
              });
            }}
          />
        )}

        <SyncStatus className={active || showOnboardingBanner ? 'mt-5' : ''} />

        <div className={active || showOnboardingBanner ? 'mt-5' : ''}>
          <Greeting name={firstName} />
          <p className="mt-1.5 text-base text-muted">
            Ready to crush your goals today?
          </p>
        </div>

        <div className="mt-6">
          <WeeklyProgress
            workoutsDone={weekSummary.workoutsDone}
            workoutsTarget={mainSlots.length}
            bars={weekSummary.bars}
            dayDetails={weekSummary.dayDetails}
            planWeek={plan ? weeksOnPlan(plan.activated_at) : null}
          />
        </div>

        {nextSlot && nextDay && !active && showNextDay && (
          <div className="mt-7">
            <SectionLabel>Today's workout</SectionLabel>
            <div className="mt-3">
              <TrainingDayCard
                name={nextSlot.name}
                bodyParts={slotSubtitle(nextSlot)}
                exerciseCount={(nextDay.plan_exercises ?? []).length}
                accent={accentFor(nextSlot.name)}
                tag={slotTag(nextSlot)}
                isNext
                onClick={() => openSlot(nextSlot)}
              />
            </div>
          </div>
        )}

        <div className="mt-7">
          <SectionLabel>Quick actions</SectionLabel>
          {/* Each tile is as wide as its own contents and no wider, so the
              padding sits even on both sides of every one of them. That means
              more tiles than fit, so the row scrolls sideways, bleeding out to
              both screen edges — the next tile is visibly cut off rather than
              everything being squeezed, it reads left to right so the cut one
              still shows its icon and the start of its value, and the edge
              fades say there's more where that came from. data-no-tab-swipe
              keeps a sideways drag here from switching tabs. */}
          <div className="relative -mx-5 mt-3">
            <div
              data-no-tab-swipe
              ref={readRowEdges}
              onScroll={(e) => readRowEdges(e.currentTarget)}
              className="flex gap-2 overflow-x-auto overscroll-x-contain px-5 pb-1 [&::-webkit-scrollbar]:hidden"
              style={{ scrollbarWidth: 'none' }}
            >
              {quickActions.map((id) => (
                <div key={id} className="shrink-0">
                  {id === 'water' && (
                    <WaterAction
                      count={waterCount}
                      goal={waterGoal}
                      unit={waterUnit}
                      busy={waterBusy}
                      onTap={() => handleWaterTap(1)}
                      onLongPress={() => handleWaterTap(-1)}
                    />
                  )}
                  {id === 'coffee' && <CoffeeAction />}
                  {id === 'steps' && (
                    <StepsAction count={stepCount} goal={stepGoal} onTap={onLogSteps} />
                  )}
                  {id === 'weight' && (
                    <QuickAction
                      icon={<ScaleIcon />}
                      label="Log weight"
                      onClick={onLogBodyWeight}
                    />
                  )}
                </div>
              ))}
            </div>
            {showRowStartFade && (
              <span className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-paper to-transparent" />
            )}
            {showRowEndFade && (
              <span className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-paper to-transparent" />
            )}
          </div>
          {waterError && (
            <div className="mt-2 rounded-card bg-[#FFEDED] px-3 py-2 text-xs text-[#B42318]">
              Couldn't save water: {waterError}
            </div>
          )}
        </div>

        <div className="mt-7">
          <SectionLabel>All workouts</SectionLabel>
          <div className="mt-3 space-y-3">
            {slots.map((slot) => (
              <TrainingDayCard
                key={slot.name}
                name={slot.name}
                bodyParts={slotSubtitle(slot)}
                exerciseCount={(dueBySlot.get(slot.name)?.plan_exercises ?? []).length}
                accent={accentFor(slot.name)}
                tag={slotTag(slot)}
                done={completedSlotNames.includes(slot.name)}
                onClick={() => openSlot(slot)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function OnboardingBanner({
  onResume,
  onDismiss,
}: {
  onResume: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="mt-4 flex items-center gap-5 rounded-card bg-[#FFF6D6] py-4 pl-5 pr-4 shadow-card">
      <button
        onClick={onResume}
        className="flex min-w-0 flex-1 items-center justify-between gap-4 text-left active:opacity-80"
      >
        <div className="min-w-0">
          <div className="text-label font-semibold uppercase tracking-[0.18em] text-[#7A5A00]">
            Get set up
          </div>
          <div className="mt-0.5 text-base font-bold tracking-tight text-ink">
            Finish setting up your profile
          </div>
        </div>
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="shrink-0 text-ink">
          <path
            d="M7 4l5 5-5 5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="pressable flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#7A5A00] active:bg-black/10"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path
            d="M4 4l8 8M12 4l-8 8"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}

function ActiveWorkoutBanner({
  context,
  exerciseCount,
  onResume,
}: {
  context: ActiveSessionContext;
  exerciseCount: number | null;
  onResume: () => void;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const elapsed = Math.max(
    0,
    Math.floor((Date.now() - new Date(context.startedAt).getTime()) / 1000)
  );
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  // Hours only when needed.
  const displayLabel =
    mins >= 60
      ? `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      : `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  // The same card as the rest of Home, in its dark variant — so a workout in
  // progress reads as the day it belongs to, photo and all, with the elapsed
  // time where the body parts normally sit.
  return (
    <div className="mt-4">
      <TrainingDayCard
        name={context.trainingDayName}
        bodyParts={<span className="font-mono tabular-nums">{displayLabel}</span>}
        exerciseCount={exerciseCount}
        accent={accentFor(context.trainingDayName)}
        isNext
        badgeLabel="Workout in progress"
        onClick={onResume}
      />
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
      {children}
    </div>
  );
}

function QuickAction({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={() => {
        haptics.tap();
        onClick?.();
      }}
      className="pressable flex w-full items-center gap-2.5 rounded-card bg-paper-card px-5 py-4 text-sm font-medium text-ink shadow-card transition-transform"
    >
      <span className="shrink-0">{icon}</span>
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

/**
 * Has the finger travelled far enough that this is a scroll, not a tap?
 *
 * The quick action tiles sit in a row that scrolls sideways, so a drag that
 * starts on the water tile is usually someone reaching for the tile off the
 * edge — it must not land as a drink. 8px is below what anyone holding still
 * produces and well under the browser's own pan threshold.
 */
function movedOffPress(
  origin: React.RefObject<{ x: number; y: number } | null>,
  e: React.PointerEvent
): boolean {
  const o = origin.current;
  if (!o) return false;
  return Math.abs(e.clientX - o.x) > 8 || Math.abs(e.clientY - o.y) > 8;
}


function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `reps_coffee_${y}-${m}-${day}`;
}

function CoffeeAction() {
  const key = todayKey();
  const [count, setCount] = useState(() => {
    try {
      const v = localStorage.getItem(key);
      return v ? parseInt(v, 10) || 0 : 0;
    } catch {
      return 0;
    }
  });
  const [wiggleKey, setWiggleKey] = useState(0);
  const pressTimer = useRef<number | null>(null);
  const didLongPress = useRef(false);
  const pressOrigin = useRef<{ x: number; y: number } | null>(null);

  function write(next: number) {
    setCount(next);
    try {
      localStorage.setItem(key, String(next));
    } catch {
      // localStorage unavailable — keep the in-memory count
    }
  }

  function bump(delta: number) {
    setWiggleKey((k) => k + 1);
    setCount((c) => {
      const next = Math.max(0, c + delta);
      try {
        localStorage.setItem(key, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  function clearTimer() {
    if (pressTimer.current != null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }

  function start(e: React.PointerEvent<HTMLButtonElement>) {
    didLongPress.current = false;
    pressOrigin.current = { x: e.clientX, y: e.clientY };
    clearTimer();
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      didLongPress.current = true;
      haptics.commit();
      bump(-1);
    }, 600);
  }

  function move(e: React.PointerEvent<HTMLButtonElement>) {
    if (movedOffPress(pressOrigin, e)) {
      pressOrigin.current = null;
      clearTimer();
    }
  }

  function end() {
    pressOrigin.current = null;
    if (didLongPress.current) {
      didLongPress.current = false;
      return;
    }
    if (pressTimer.current != null) {
      clearTimer();
      haptics.tap();
      bump(1);
    }
  }

  function cancel() {
    pressOrigin.current = null;
    clearTimer();
  }

  // Touch `write` so it's not flagged unused — kept for potential reset use.
  void write;

  return (
    <button
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={cancel}
      aria-label={`Coffee count: ${count}. Tap to add, press and hold to remove.`}
      className="pressable flex w-full touch-manipulation select-none items-center gap-2.5 rounded-card bg-paper-card px-5 py-4 text-sm font-medium text-ink shadow-card transition-transform"
    >
      <style>{`
        @keyframes reps-coffee-wiggle {
          0% { transform: rotate(0deg); }
          20% { transform: rotate(-14deg); }
          45% { transform: rotate(12deg); }
          70% { transform: rotate(-7deg); }
          100% { transform: rotate(0deg); }
        }
      `}</style>
      <span
        key={wiggleKey}
        className="inline-flex shrink-0 origin-bottom"
        style={
          wiggleKey > 0
            ? { animation: 'reps-coffee-wiggle 450ms ease-out' }
            : undefined
        }
      >
        <CoffeeIcon />
      </span>
      <span className="whitespace-nowrap tabular-nums">{count}</span>
    </button>
  );
}

/**
 * Today's step count against the goal, as a tap-through rather than a counter:
 * steps come off a phone's health app in one number, so the tile opens the
 * screen where that number gets typed in instead of incrementing.
 */
function StepsAction({
  count,
  goal,
  onTap,
}: {
  count: number;
  goal: number;
  onTap: () => void;
}) {
  const pct = Math.min(1, count / Math.max(1, goal));
  const reached = count >= goal;
  return (
    <button
      onClick={() => {
        haptics.tap();
        onTap();
      }}
      aria-label={`Steps today: ${count} of ${goal}. Opens the step log.`}
      className="pressable relative flex w-full items-center gap-2.5 overflow-hidden rounded-card bg-paper-card px-5 py-4 text-sm font-medium text-ink shadow-card transition-transform"
    >
      <div
        className={`absolute inset-y-0 left-0 ${TILE_FILL}`}
        style={{ width: `${pct * 100}%`, transition: 'width 350ms cubic-bezier(.22,.85,.36,1)' }}
      />
      <span className="relative shrink-0">
        <StepsIcon />
      </span>
      <span className="relative whitespace-nowrap tabular-nums">
        {formatSteps(count)}
        <span className="text-muted">
          {reached ? ' \u2713' : ` / ${formatSteps(goal)}`}
        </span>
      </span>
    </button>
  );
}

const HYDRATION_MESSAGES = [
  'Well done!',
  "You're well hydrated",
  'Hydration hero',
  'Crushing it',
  'Topped right up',
  'Smashed your goal',
];

function WaterAction({
  count,
  goal,
  unit,
  busy,
  onTap,
  onLongPress,
}: {
  count: number;
  goal: number;
  unit: string;
  busy: boolean;
  onTap: () => void;
  onLongPress: () => void;
}) {
  const pct = Math.min(1, count / Math.max(1, goal));
  const pressTimer = useRef<number | null>(null);
  const didLongPress = useRef(false);
  const pressOrigin = useRef<{ x: number; y: number } | null>(null);
  const reached = count >= goal;
  const prevReached = useRef(reached);
  const [celebrating, setCelebrating] = useState(false);
  const [praise, setPraise] = useState(() =>
    reached ? HYDRATION_MESSAGES[Math.floor(Math.random() * HYDRATION_MESSAGES.length)] : ''
  );

  useEffect(() => {
    if (reached && !prevReached.current) {
      setPraise(HYDRATION_MESSAGES[Math.floor(Math.random() * HYDRATION_MESSAGES.length)]);
      setCelebrating(true);
      const t = window.setTimeout(() => setCelebrating(false), 1400);
      prevReached.current = true;
      return () => window.clearTimeout(t);
    }
    if (!reached && prevReached.current) {
      prevReached.current = false;
      setCelebrating(false);
    }
  }, [reached]);

  function clearTimer() {
    if (pressTimer.current != null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }

  function start(e: React.PointerEvent<HTMLButtonElement>) {
    didLongPress.current = false;
    pressOrigin.current = { x: e.clientX, y: e.clientY };
    clearTimer();
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      didLongPress.current = true;
      haptics.commit();
      onLongPress();
    }, 600);
  }

  function move(e: React.PointerEvent<HTMLButtonElement>) {
    if (movedOffPress(pressOrigin, e)) {
      pressOrigin.current = null;
      clearTimer();
    }
  }

  function end() {
    pressOrigin.current = null;
    // If the long-press already fired, swallow the trailing pointerup.
    if (didLongPress.current) {
      didLongPress.current = false;
      return;
    }
    if (pressTimer.current != null) {
      clearTimer();
      haptics.tap();
      onTap();
    }
  }

  function cancel() {
    pressOrigin.current = null;
    clearTimer();
  }

  return (
    <div className="relative">
      <button
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={cancel}
        disabled={busy}
        className="pressable relative flex w-full touch-manipulation select-none items-center gap-2.5 overflow-hidden rounded-card bg-paper-card px-5 py-4 text-sm font-medium text-ink shadow-card transition-transform"
      >
        <div
          className={`absolute inset-y-0 left-0 ${TILE_FILL}`}
          style={{ width: `${pct * 100}%`, transition: 'width 350ms cubic-bezier(.22,.85,.36,1)' }}
        />
        {reached ? (
          <span className="relative w-full text-center font-semibold text-ink">
            {celebrating ? 'Well done!' : praise}
          </span>
        ) : (
          <>
            <span className="relative shrink-0">
              <WaterIcon />
            </span>
            <span className="relative whitespace-nowrap">
              {count} / {goal} <span className="text-muted">{unit}</span>
            </span>
          </>
        )}
      </button>
      {celebrating && <Confetti />}
    </div>
  );
}

const CONFETTI_COLORS = ['#6BB6FF', '#FFB84D', '#FF6B9A', '#7BD389', '#A78BFA'];
const CONFETTI_PIECES = Array.from({ length: 14 }, (_, i) => {
  const angle = (i / 14) * Math.PI * 2 + Math.random() * 0.3;
  const dist = 38 + Math.random() * 30;
  return {
    tx: Math.cos(angle) * dist,
    ty: Math.sin(angle) * dist - 10,
    rot: Math.random() * 360,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    delay: Math.random() * 80,
  };
});

function Confetti() {
  return (
    <span
      className="pointer-events-none absolute inset-0 flex items-center justify-center"
      aria-hidden
    >
      <style>{`
        @keyframes reps-confetti {
          0% { transform: translate(0,0) rotate(0deg); opacity: 0; }
          15% { opacity: 1; }
          100% { transform: translate(var(--tx), var(--ty)) rotate(var(--rot)); opacity: 0; }
        }
      `}</style>
      {CONFETTI_PIECES.map((p, i) => (
        <span
          key={i}
          className="absolute h-1.5 w-1.5 rounded-sm"
          style={{
            backgroundColor: p.color,
            ['--tx' as string]: `${p.tx}px`,
            ['--ty' as string]: `${p.ty}px`,
            ['--rot' as string]: `${p.rot}deg`,
            animation: `reps-confetti 1100ms ease-out ${p.delay}ms forwards`,
          }}
        />
      ))}
    </span>
  );
}

/*
 * The quick action icons, traced from the approved mockup.
 *
 * Filled outlines rather than strokes. The trace came out at roughly 0.75px
 * of ink where 1px was intended, which read thin and small on a phone, so each
 * is stroked along its own outline to carry it to about 1.5px and rendered at
 * 20px. The stroke width is given in each path's own units — they were traced
 * at different scales — so the weight matches across the four and grows with
 * the icon rather than staying put if one is ever rendered larger.
 *
 * The traced edges are a staircase of sub-pixel steps: invisible at this size,
 * and the round joins soften it, but visible if one were blown up. Anything
 * bigger should be re-exported from the source artwork rather than scaled from
 * these. The fill is currentColor so each takes its tile's text colour.
 */

function WaterIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M 17.00 2.00 L 16.00 3.00 L 15.00 3.00 L 15.00 4.00 L 14.00 5.00 L 14.00 7.00 L 13.00 8.00 L 13.00 11.00 L 12.00 12.00 L 11.00 12.00 L 10.00 13.00 L 10.00 17.00 L 8.00 19.00 L 8.00 20.00 L 5.00 23.00 L 5.00 24.00 L 4.00 25.00 L 4.00 27.00 L 3.00 28.00 L 3.00 36.00 L 2.00 37.00 L 2.00 39.00 L 3.00 40.00 L 3.00 42.00 L 4.00 43.00 L 4.00 45.00 L 3.00 46.00 L 3.00 49.00 L 2.00 50.00 L 2.00 77.00 L 3.00 78.00 L 3.00 80.00 L 4.00 81.00 L 4.00 82.00 L 7.00 85.00 L 8.00 85.00 L 9.00 86.00 L 11.00 86.00 L 12.00 87.00 L 13.00 86.00 L 24.00 86.00 L 25.00 87.00 L 26.00 86.00 L 39.00 86.00 L 40.00 85.00 L 41.00 85.00 L 44.00 82.00 L 44.00 81.00 L 45.00 80.00 L 45.00 78.00 L 46.00 77.00 L 46.00 49.00 L 45.00 48.00 L 45.00 46.00 L 44.00 45.00 L 44.00 43.00 L 45.00 42.00 L 45.00 28.00 L 44.00 27.00 L 44.00 25.00 L 42.00 23.00 L 42.00 22.00 L 37.00 17.00 L 37.00 13.00 L 36.00 12.00 L 35.00 12.00 L 34.00 11.00 L 34.00 5.00 L 33.00 4.00 L 33.00 3.00 L 32.00 3.00 L 31.00 2.00 Z M 9.00 45.00 L 37.00 45.00 L 38.00 46.00 L 39.00 45.00 L 41.00 47.00 L 41.00 48.00 L 42.00 49.00 L 42.00 78.00 L 37.00 83.00 L 12.00 83.00 L 11.00 82.00 L 10.00 82.00 L 7.00 79.00 L 7.00 78.00 L 6.00 77.00 L 6.00 49.00 L 7.00 48.00 L 7.00 47.00 Z M 15.00 18.00 L 33.00 18.00 L 39.00 24.00 L 39.00 25.00 L 40.00 26.00 L 40.00 27.00 L 41.00 28.00 L 41.00 30.00 L 42.00 31.00 L 42.00 39.00 L 41.00 40.00 L 41.00 41.00 L 40.00 42.00 L 9.00 42.00 L 7.00 40.00 L 7.00 39.00 L 6.00 38.00 L 6.00 32.00 L 7.00 31.00 L 7.00 28.00 L 8.00 27.00 L 8.00 26.00 L 9.00 25.00 L 9.00 24.00 Z M 18.00 7.00 L 19.00 6.00 L 30.00 6.00 L 31.00 7.00 L 31.00 11.00 L 30.00 12.00 L 18.00 12.00 L 17.00 11.00 L 17.00 9.00 L 18.00 8.00 Z"
        fill="currentColor"
        fillRule="evenodd"
        stroke="currentColor"
        strokeWidth="2.922"
        strokeLinejoin="round"
        transform="translate(4.8078,1.3000) scale(0.171111)"
      />
    </svg>
  );
}

function CoffeeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M 3.00 36.00 L 2.00 37.00 L 2.00 74.00 L 3.00 75.00 L 3.00 77.00 L 4.00 78.00 L 4.00 79.00 L 6.00 81.00 L 6.00 82.00 L 8.00 84.00 L 9.00 84.00 L 11.00 86.00 L 42.00 86.00 L 43.00 85.00 L 44.00 85.00 L 49.00 80.00 L 49.00 79.00 L 50.00 78.00 L 50.00 77.00 L 51.00 76.00 L 51.00 75.00 L 52.00 74.00 L 52.00 72.00 L 53.00 71.00 L 58.00 71.00 L 59.00 70.00 L 61.00 70.00 L 62.00 69.00 L 63.00 69.00 L 65.00 67.00 L 66.00 67.00 L 68.00 65.00 L 68.00 64.00 L 69.00 63.00 L 69.00 62.00 L 70.00 61.00 L 70.00 59.00 L 71.00 58.00 L 71.00 54.00 L 70.00 53.00 L 70.00 50.00 L 69.00 49.00 L 69.00 48.00 L 66.00 45.00 L 65.00 45.00 L 63.00 43.00 L 60.00 43.00 L 59.00 42.00 L 53.00 42.00 L 52.00 41.00 L 52.00 37.00 L 51.00 36.00 Z M 52.00 47.00 L 53.00 46.00 L 60.00 46.00 L 61.00 47.00 L 62.00 47.00 L 66.00 51.00 L 66.00 53.00 L 67.00 54.00 L 67.00 57.00 L 66.00 58.00 L 66.00 60.00 L 65.00 61.00 L 65.00 62.00 L 61.00 66.00 L 59.00 66.00 L 58.00 67.00 L 53.00 67.00 L 52.00 66.00 Z M 6.00 40.00 L 7.00 39.00 L 8.00 40.00 L 9.00 39.00 L 10.00 40.00 L 46.00 40.00 L 47.00 39.00 L 48.00 40.00 L 48.00 73.00 L 47.00 74.00 L 47.00 76.00 L 45.00 78.00 L 45.00 79.00 L 43.00 81.00 L 42.00 81.00 L 40.00 83.00 L 38.00 83.00 L 37.00 84.00 L 17.00 84.00 L 16.00 83.00 L 14.00 83.00 L 13.00 82.00 L 12.00 82.00 L 7.00 77.00 L 7.00 76.00 L 6.00 75.00 Z M 16.00 5.00 L 15.00 6.00 L 14.00 6.00 L 13.00 7.00 L 13.00 8.00 L 12.00 9.00 L 12.00 16.00 L 13.00 17.00 L 13.00 18.00 L 15.00 20.00 L 15.00 21.00 L 16.00 22.00 L 16.00 24.00 L 15.00 25.00 L 15.00 26.00 L 13.00 28.00 L 13.00 29.00 L 14.00 30.00 L 17.00 30.00 L 19.00 28.00 L 19.00 27.00 L 20.00 26.00 L 20.00 20.00 L 19.00 19.00 L 19.00 18.00 L 17.00 16.00 L 17.00 15.00 L 16.00 14.00 L 16.00 11.00 L 17.00 10.00 L 17.00 9.00 L 18.00 8.00 L 18.00 7.00 Z M 32.00 2.00 L 29.00 5.00 L 29.00 6.00 L 28.00 7.00 L 28.00 13.00 L 29.00 14.00 L 29.00 15.00 L 31.00 17.00 L 31.00 18.00 L 34.00 21.00 L 34.00 25.00 L 33.00 26.00 L 32.00 26.00 L 31.00 27.00 L 31.00 28.00 L 33.00 30.00 L 34.00 30.00 L 37.00 27.00 L 37.00 25.00 L 38.00 24.00 L 38.00 22.00 L 37.00 21.00 L 37.00 19.00 L 36.00 18.00 L 36.00 17.00 L 33.00 14.00 L 33.00 13.00 L 32.00 12.00 L 32.00 8.00 L 33.00 7.00 L 33.00 6.00 L 34.00 5.00 L 34.00 4.00 Z"
        fill="currentColor"
        fillRule="evenodd"
        stroke="currentColor"
        strokeWidth="2.788"
        strokeLinejoin="round"
        transform="translate(2.3655,1.2000) scale(0.179310)"
      />
    </svg>
  );
}

function StepsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M 46.00 2.00 L 43.00 5.00 L 43.00 6.00 L 41.00 8.00 L 41.00 9.00 L 40.00 10.00 L 40.00 12.00 L 37.00 15.00 L 35.00 15.00 L 34.00 16.00 L 32.00 16.00 L 31.00 17.00 L 30.00 17.00 L 29.00 16.00 L 27.00 16.00 L 26.00 15.00 L 25.00 15.00 L 23.00 13.00 L 23.00 12.00 L 19.00 8.00 L 16.00 8.00 L 15.00 9.00 L 14.00 9.00 L 12.00 11.00 L 12.00 12.00 L 10.00 14.00 L 10.00 16.00 L 9.00 17.00 L 9.00 18.00 L 8.00 19.00 L 8.00 22.00 L 7.00 23.00 L 7.00 25.00 L 6.00 26.00 L 6.00 30.00 L 5.00 31.00 L 5.00 33.00 L 4.00 34.00 L 4.00 36.00 L 3.00 37.00 L 3.00 40.00 L 2.00 41.00 L 2.00 44.00 L 3.00 45.00 L 3.00 47.00 L 4.00 48.00 L 4.00 49.00 L 5.00 50.00 L 5.00 51.00 L 8.00 54.00 L 9.00 54.00 L 10.00 55.00 L 12.00 55.00 L 13.00 56.00 L 16.00 56.00 L 17.00 57.00 L 56.00 57.00 L 57.00 58.00 L 70.00 58.00 L 71.00 59.00 L 81.00 59.00 L 82.00 58.00 L 90.00 58.00 L 91.00 57.00 L 94.00 57.00 L 95.00 56.00 L 97.00 56.00 L 98.00 55.00 L 99.00 55.00 L 100.00 54.00 L 101.00 54.00 L 103.00 52.00 L 104.00 52.00 L 106.00 50.00 L 106.00 49.00 L 107.00 48.00 L 107.00 46.00 L 108.00 45.00 L 108.00 39.00 L 107.00 38.00 L 107.00 37.00 L 106.00 36.00 L 106.00 35.00 L 104.00 33.00 L 103.00 33.00 L 102.00 32.00 L 100.00 32.00 L 99.00 31.00 L 97.00 31.00 L 96.00 30.00 L 94.00 30.00 L 93.00 29.00 L 91.00 29.00 L 90.00 28.00 L 88.00 28.00 L 87.00 27.00 L 86.00 27.00 L 85.00 26.00 L 84.00 26.00 L 83.00 25.00 L 82.00 25.00 L 81.00 24.00 L 80.00 24.00 L 79.00 23.00 L 78.00 23.00 L 76.00 21.00 L 75.00 21.00 L 73.00 19.00 L 72.00 19.00 L 69.00 16.00 L 68.00 16.00 L 66.00 14.00 L 65.00 14.00 L 62.00 11.00 L 61.00 11.00 L 57.00 7.00 L 56.00 7.00 L 51.00 2.00 Z M 102.00 46.00 L 103.00 45.00 L 104.00 46.00 L 103.00 47.00 Z M 7.00 37.00 L 8.00 36.00 L 9.00 36.00 L 11.00 38.00 L 12.00 38.00 L 13.00 39.00 L 14.00 39.00 L 15.00 40.00 L 16.00 40.00 L 17.00 41.00 L 20.00 41.00 L 21.00 42.00 L 26.00 42.00 L 27.00 43.00 L 36.00 43.00 L 37.00 44.00 L 43.00 44.00 L 44.00 45.00 L 48.00 45.00 L 49.00 46.00 L 53.00 46.00 L 54.00 47.00 L 58.00 47.00 L 59.00 48.00 L 65.00 48.00 L 66.00 49.00 L 89.00 49.00 L 90.00 48.00 L 95.00 48.00 L 96.00 47.00 L 99.00 47.00 L 100.00 46.00 L 102.00 46.00 L 103.00 47.00 L 103.00 48.00 L 100.00 51.00 L 99.00 51.00 L 98.00 52.00 L 97.00 52.00 L 96.00 53.00 L 94.00 53.00 L 93.00 54.00 L 89.00 54.00 L 88.00 55.00 L 58.00 55.00 L 57.00 54.00 L 33.00 54.00 L 32.00 53.00 L 14.00 53.00 L 13.00 52.00 L 12.00 52.00 L 11.00 51.00 L 10.00 51.00 L 8.00 49.00 L 8.00 48.00 L 7.00 47.00 L 7.00 46.00 L 6.00 45.00 L 6.00 39.00 L 7.00 38.00 Z M 48.00 6.00 L 49.00 5.00 L 54.00 10.00 L 55.00 10.00 L 56.00 11.00 L 56.00 12.00 L 54.00 14.00 L 54.00 15.00 L 52.00 17.00 L 51.00 17.00 L 49.00 19.00 L 49.00 20.00 L 48.00 21.00 L 50.00 23.00 L 51.00 22.00 L 52.00 22.00 L 59.00 15.00 L 61.00 15.00 L 63.00 17.00 L 64.00 17.00 L 66.00 19.00 L 65.00 20.00 L 64.00 20.00 L 58.00 26.00 L 58.00 28.00 L 59.00 29.00 L 60.00 29.00 L 66.00 23.00 L 67.00 23.00 L 69.00 21.00 L 70.00 21.00 L 72.00 23.00 L 73.00 23.00 L 75.00 25.00 L 73.00 27.00 L 72.00 27.00 L 67.00 32.00 L 67.00 33.00 L 68.00 34.00 L 70.00 34.00 L 72.00 32.00 L 73.00 32.00 L 78.00 27.00 L 79.00 27.00 L 80.00 28.00 L 81.00 28.00 L 82.00 29.00 L 83.00 29.00 L 84.00 30.00 L 86.00 30.00 L 87.00 31.00 L 88.00 31.00 L 89.00 32.00 L 91.00 32.00 L 92.00 33.00 L 95.00 33.00 L 96.00 34.00 L 98.00 34.00 L 99.00 35.00 L 100.00 35.00 L 101.00 36.00 L 102.00 36.00 L 104.00 38.00 L 104.00 41.00 L 103.00 42.00 L 102.00 42.00 L 101.00 43.00 L 99.00 43.00 L 98.00 44.00 L 95.00 44.00 L 94.00 45.00 L 88.00 45.00 L 87.00 46.00 L 68.00 46.00 L 67.00 45.00 L 61.00 45.00 L 60.00 44.00 L 56.00 44.00 L 55.00 43.00 L 51.00 43.00 L 50.00 42.00 L 46.00 42.00 L 45.00 41.00 L 40.00 41.00 L 39.00 40.00 L 31.00 40.00 L 30.00 39.00 L 23.00 39.00 L 22.00 38.00 L 19.00 38.00 L 18.00 37.00 L 17.00 37.00 L 16.00 36.00 L 15.00 36.00 L 14.00 35.00 L 13.00 35.00 L 12.00 34.00 L 11.00 34.00 L 9.00 32.00 L 9.00 29.00 L 10.00 28.00 L 10.00 25.00 L 11.00 24.00 L 11.00 22.00 L 12.00 21.00 L 12.00 19.00 L 13.00 18.00 L 13.00 17.00 L 14.00 16.00 L 14.00 15.00 L 15.00 14.00 L 15.00 13.00 L 16.00 12.00 L 18.00 12.00 L 21.00 15.00 L 21.00 16.00 L 23.00 18.00 L 24.00 18.00 L 25.00 19.00 L 26.00 19.00 L 27.00 20.00 L 34.00 20.00 L 35.00 19.00 L 37.00 19.00 L 39.00 17.00 L 40.00 17.00 L 41.00 16.00 L 42.00 16.00 L 43.00 15.00 L 43.00 14.00 L 44.00 13.00 L 43.00 12.00 L 44.00 11.00 L 44.00 10.00 L 45.00 9.00 L 45.00 8.00 L 47.00 6.00 Z"
        fill="currentColor"
        fillRule="evenodd"
        stroke="currentColor"
        strokeWidth="3.426"
        strokeLinejoin="round"
        transform="translate(0.9000,4.4757) scale(0.145946)"
      />
    </svg>
  );
}

function ScaleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M 30.00 16.00 L 29.00 17.00 L 27.00 17.00 L 26.00 18.00 L 25.00 18.00 L 22.00 21.00 L 21.00 21.00 L 21.00 22.00 L 18.00 25.00 L 18.00 26.00 L 17.00 27.00 L 17.00 29.00 L 16.00 30.00 L 17.00 31.00 L 20.00 31.00 L 20.00 29.00 L 21.00 28.00 L 21.00 27.00 L 26.00 22.00 L 27.00 22.00 L 28.00 21.00 L 29.00 21.00 L 30.00 20.00 L 32.00 20.00 L 33.00 19.00 L 37.00 19.00 L 38.00 20.00 L 41.00 20.00 L 42.00 21.00 L 43.00 21.00 L 44.00 22.00 L 45.00 22.00 L 49.00 26.00 L 49.00 27.00 L 50.00 28.00 L 50.00 29.00 L 51.00 30.00 L 51.00 31.00 L 54.00 31.00 L 55.00 30.00 L 54.00 29.00 L 54.00 27.00 L 53.00 26.00 L 53.00 25.00 L 47.00 19.00 L 46.00 19.00 L 44.00 17.00 L 42.00 17.00 L 41.00 16.00 Z M 13.00 2.00 L 12.00 3.00 L 10.00 3.00 L 9.00 4.00 L 8.00 4.00 L 7.00 5.00 L 6.00 5.00 L 4.00 7.00 L 4.00 8.00 L 3.00 9.00 L 3.00 10.00 L 2.00 11.00 L 2.00 64.00 L 3.00 65.00 L 3.00 66.00 L 5.00 68.00 L 5.00 69.00 L 6.00 69.00 L 8.00 71.00 L 9.00 71.00 L 10.00 72.00 L 61.00 72.00 L 62.00 71.00 L 63.00 71.00 L 68.00 66.00 L 68.00 64.00 L 69.00 63.00 L 69.00 12.00 L 68.00 11.00 L 68.00 10.00 L 67.00 9.00 L 67.00 8.00 L 63.00 4.00 L 62.00 4.00 L 61.00 3.00 L 59.00 3.00 L 58.00 2.00 Z M 11.00 7.00 L 12.00 6.00 L 58.00 6.00 L 59.00 7.00 L 61.00 7.00 L 64.00 10.00 L 64.00 11.00 L 65.00 12.00 L 65.00 24.00 L 66.00 25.00 L 66.00 28.00 L 65.00 29.00 L 65.00 63.00 L 64.00 64.00 L 64.00 65.00 L 62.00 67.00 L 61.00 67.00 L 59.00 69.00 L 13.00 69.00 L 12.00 68.00 L 10.00 68.00 L 6.00 64.00 L 6.00 62.00 L 5.00 61.00 L 5.00 14.00 L 6.00 13.00 L 6.00 11.00 L 10.00 7.00 Z"
        fill="currentColor"
        fillRule="evenodd"
        stroke="currentColor"
        strokeWidth="2.401"
        strokeLinejoin="round"
        transform="translate(1.5041,1.4000) scale(0.208219)"
      />
    </svg>
  );
}

/**
 * The handful of things worth knowing about before you've used the app.
 *
 * It sits under the two cards on Home rather than inside onboarding: someone
 * arriving with a plan to upload is here to upload it, and a tour in the way of
 * that is a tour nobody reads. Here it waits until they look down.
 */
function WhatsInside() {
  const items: { icon: React.ReactNode; title: string; body: string }[] = [
    {
      icon: <PlateIcon />,
      title: 'Plate calculator',
      body: 'Tap a weight while you log and it works out which plates go on the bar \u2014 one side at a time, from the plates your gym actually has.',
    },
    {
      icon: <PegsIcon />,
      title: 'Machines that need more than one number',
      body: 'Plate-loaded machines log peg by peg, because 20 kg on peg 3 is nothing like 20 kg on peg 1. Cable machines record which position the cam was set to.',
    },
    {
      icon: <NotepadIcon />,
      title: 'Logged the way the machine works',
      body: 'Type a weight against each peg and the total is what your records, PRs and history read \u2014 the breakdown rides along underneath.',
    },
    {
      icon: <DropletIcon />,
      title: 'Water, coffee, weight and steps',
      body: 'Four tiles on Home. Tap one to add, hold it to take one back \u2014 no screen to open first.',
    },
  ];
  return (
    <div className="mt-4 rounded-card bg-paper-card p-5 shadow-card">
      <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
        What's inside
      </div>
      <ul className="mt-4 space-y-5">
        {items.map((item) => (
          <li key={item.title} className="flex gap-3.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-panel bg-surface-strong text-ink">
              {item.icon}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-ink">{item.title}</div>
              <p className="mt-0.5 text-sm leading-snug text-muted">{item.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlateIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3 10v4M21 10v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function PegsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M5 4v16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path
        d="M8 7h9M8 12h6M8 17h11"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function NotepadIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <rect x="4.5" y="3.5" width="15" height="17" rx="3" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M8.5 9h7M8.5 13h7M8.5 17h4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DropletIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 3.5s6 6.2 6 10a6 6 0 0 1-12 0c0-3.8 6-10 6-10z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" className="text-ink">
      <path
        d="M21 7l4 4M22.5 5.5a2.1 2.1 0 013 3L12 22l-5 1 1-5 14.5-12.5z M8 27h16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function UploadCloudIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" className="text-ink">
      <path
        d="M16 22V12 M11 17l5-5 5 5 M8 26h16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

