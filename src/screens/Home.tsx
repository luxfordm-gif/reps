import { useEffect, useRef, useState } from 'react';
import { TrainingDayCard } from '../components/TrainingDayCard';
import { WeeklyProgress } from '../components/WeeklyProgress';
import { weeksOnPlan, type FullPlan } from '../lib/plansApi';
import {
  type ActiveSessionContext,
  type WeekSummary,
} from '../lib/sessionsApi';
import { adjustWater, getWaterGoal, getWaterUnit } from '../lib/waterApi';
import { getCachedHomeData, loadHomeData, patchHomeCache } from '../lib/homeCache';

type Day = FullPlan['training_days'][number];

interface Props {
  onUploadPlan: () => void;
  onLogBodyWeight: () => void;
  onTapDay: (day: Day) => void;
  onResumeWorkout?: (params: {
    day: Day;
    exerciseIdx: number;
    sessionId: string;
    startedAt: string;
  }) => void;
}

const ACCENTS: Record<string, string> = {
  Push: 'bg-[#FFE9D6]',
  Pull: 'bg-[#E5F0FF]',
  Legs: 'bg-[#E8F5E9]',
  Upper: 'bg-[#F3E5F5]',
  Arms: 'bg-[#FFF3E0]',
  Abs: 'bg-[#E0F7FA]',
};

const FALLBACK_ACCENT = 'bg-[#F0F0F0]';
const FIRST_NAME = 'Matt';

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

export function Home({ onUploadPlan, onLogBodyWeight, onTapDay, onResumeWorkout }: Props) {
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

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await loadHomeData();
        if (!mounted) return;
        setPlan(data.plan);
        setLastCompleted(data.lastCompleted);
        setWaterCount(data.waterCount);
        setActive(data.active);
        setWeekSummary(data.weekSummary);
        setCompletedThisWeek(data.completedThisWeek);
        setRecentPositions(data.recentPositions);
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
          style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 28px)' }}
        >
          <h1 className="text-[34px] font-bold leading-tight tracking-[-0.02em] text-ink">
            {greeting()}, {FIRST_NAME}.
          </h1>
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
          style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 28px)' }}
        >
          <div className="mt-12 rounded-card bg-paper-card p-8 text-center shadow-card">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#FFE9D6]">
              <UploadCloudIcon />
            </div>
            <h2 className="mt-5 text-2xl font-bold tracking-tight text-ink">
              Welcome to Reps.
            </h2>
            <p className="mt-2 text-sm text-muted">
              Drop in your first training plan PDF and we'll turn it into trackable
              training days.
            </p>
            <button
              onClick={onUploadPlan}
              className="mt-6 w-full rounded-pill bg-ink py-4 text-base font-semibold text-white transition-opacity active:opacity-80"
            >
              Upload your plan
            </button>
          </div>
        </div>
      </div>
    );
  }

  const days = plan.training_days ?? [];
  const mainDays = days.filter((d) => d.name !== 'Abs');
  const absDay = days.find((d) => d.name === 'Abs');
  const nextDayName = getNextDayName(mainDays, lastCompleted, completedThisWeek);
  const nextDay = nextDayName ? mainDays.find((d) => d.name === nextDayName) : undefined;
  const showNextDay = shouldShowUpNext(recentPositions, mainDays.length);
  // List order: each main day in plan order, with Abs inserted after Pull and after Arms.
  const listDays: { day: Day; slot: 'main' | 'abs' }[] = [];
  for (const d of mainDays) {
    listDays.push({ day: d, slot: 'main' });
    if (absDay && (d.name === 'Pull' || d.name === 'Arms')) {
      listDays.push({ day: absDay, slot: 'abs' });
    }
  }

  return (
    <div className="min-h-screen bg-paper pb-28">
      <div
        className="mx-auto max-w-md px-5"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 28px)' }}
      >
        {active && (
          <ActiveWorkoutBanner
            context={active}
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

        <div className={active ? 'mt-5' : ''}>
          <h1 className="text-[34px] font-bold leading-tight tracking-[-0.02em] text-ink">
            {greeting()}, {FIRST_NAME}.
          </h1>
          <p className="mt-1.5 text-base text-muted">
            Ready to crush your goals today?
          </p>
        </div>

        <div className="mt-6">
          <WeeklyProgress
            workoutsDone={weekSummary.workoutsDone}
            workoutsTarget={5}
            bars={weekSummary.bars}
            dayDetails={weekSummary.dayDetails}
            planWeek={plan ? weeksOnPlan(plan.activated_at) : null}
          />
        </div>

        {nextDay && !active && showNextDay && (
          <div className="mt-7">
            <SectionLabel>Today's workout</SectionLabel>
            <div className="mt-3">
              <TrainingDayCard
                name={nextDay.name}
                bodyParts={bodyPartsForDay(nextDay.plan_exercises ?? [])}
                exerciseCount={(nextDay.plan_exercises ?? []).length}
                accent={ACCENTS[nextDay.name] ?? FALLBACK_ACCENT}
                isNext
                onClick={() => onTapDay(nextDay)}
              />
            </div>
          </div>
        )}

        <div className="mt-7">
          <SectionLabel>Quick actions</SectionLabel>
          <div className="mt-3 grid grid-cols-[1fr_0.675fr_1fr] gap-2">
            <WaterAction
              count={waterCount}
              goal={waterGoal}
              unit={waterUnit}
              busy={waterBusy}
              onTap={() => handleWaterTap(1)}
              onLongPress={() => handleWaterTap(-1)}
            />
            <CoffeeAction />
            <QuickAction
              icon={<ScaleIcon />}
              label="Log weight"
              onClick={onLogBodyWeight}
            />
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
            {listDays.map(({ day }, i) => (
              <TrainingDayCard
                key={`${day.id}-${i}`}
                name={day.name}
                bodyParts={bodyPartsForDay(day.plan_exercises ?? [])}
                exerciseCount={(day.plan_exercises ?? []).length}
                accent={ACCENTS[day.name] ?? FALLBACK_ACCENT}
                done={completedThisWeek.includes(day.name)}
                onClick={() => onTapDay(day)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ActiveWorkoutBanner({
  context,
  onResume,
}: {
  context: ActiveSessionContext;
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
  const label = `${String(Math.floor(mins / 60)).padStart(0, '0')}${
    mins >= 60 ? `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}` : String(mins)
  }:${String(secs).padStart(2, '0')}`;
  // Simpler: hours only when needed
  const displayLabel =
    mins >= 60
      ? `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      : `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  void label;

  return (
    <button
      onClick={onResume}
      className="mt-4 flex w-full items-center gap-4 rounded-card bg-[#1F1F1F] px-5 py-4 text-left text-white shadow-card active:opacity-80"
    >
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/15">
        <span className="text-xl font-bold text-white">{context.trainingDayName[0]}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/70">
          Workout in progress
        </div>
        <div className="mt-0.5 text-xl font-bold tracking-tight">
          {context.trainingDayName} ·{' '}
          <span className="font-mono tabular-nums">{displayLabel}</span>
        </div>
      </div>
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path
          d="M7 4l5 5-5 5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
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
        hapticBuzz(12);
        onClick?.();
      }}
      className="flex items-center justify-between rounded-card bg-paper-card px-5 py-4 text-sm font-medium text-ink shadow-card transition-transform active:scale-[0.99]"
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function hapticBuzz(pattern: number | number[]) {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(pattern);
    } catch {
      // ignore — some platforms (notably iOS Safari) don't support vibration
    }
  }
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
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    didLongPress.current = false;
    clearTimer();
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      didLongPress.current = true;
      hapticBuzz([15, 40, 25]);
      bump(-1);
    }, 600);
  }

  function end() {
    if (didLongPress.current) {
      didLongPress.current = false;
      return;
    }
    if (pressTimer.current != null) {
      clearTimer();
      hapticBuzz(10);
      bump(1);
    }
  }

  // Touch `write` so it's not flagged unused — kept for potential reset use.
  void write;

  return (
    <button
      onPointerDown={start}
      onPointerUp={end}
      onPointerCancel={clearTimer}
      aria-label={`Coffee count: ${count}. Tap to add, press and hold to remove.`}
      className="flex items-center justify-between rounded-card bg-paper-card px-5 py-4 text-sm font-medium text-ink shadow-card transition-transform active:scale-[0.97] touch-none select-none"
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
        className="inline-flex origin-bottom"
        style={
          wiggleKey > 0
            ? { animation: 'reps-coffee-wiggle 450ms ease-out' }
            : undefined
        }
      >
        <CoffeeIcon />
      </span>
      <span className="tabular-nums">{count}</span>
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
    // Capture the pointer so tiny finger movement doesn't cancel the press.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore — older browsers may not support pointer capture
    }
    didLongPress.current = false;
    clearTimer();
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      didLongPress.current = true;
      hapticBuzz([15, 40, 25]);
      onLongPress();
    }, 600);
  }

  function end() {
    // If the long-press already fired, swallow the trailing pointerup.
    if (didLongPress.current) {
      didLongPress.current = false;
      return;
    }
    if (pressTimer.current != null) {
      clearTimer();
      hapticBuzz(12);
      onTap();
    }
  }

  return (
    <div className="relative">
      <button
        onPointerDown={start}
        onPointerUp={end}
        onPointerCancel={clearTimer}
        disabled={busy}
        className="relative flex w-full items-center justify-between overflow-hidden rounded-card bg-paper-card px-5 py-4 text-sm font-medium text-ink shadow-card transition-transform active:scale-[0.99] touch-none select-none"
      >
        <div
          className="absolute inset-y-0 left-0 bg-[#D6E8FF]"
          style={{ width: `${pct * 100}%`, transition: 'width 350ms cubic-bezier(.22,.85,.36,1)' }}
        />
        {reached ? (
          <span className="relative w-full text-center font-semibold text-ink">
            {celebrating ? 'Well done!' : praise}
          </span>
        ) : (
          <>
            <span className="relative">
              <DropletIcon />
            </span>
            <span className="relative truncate pl-2 text-right">
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

function CoffeeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M4 8h12v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M16 10h2a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2h-2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M8 3v2M11 3v2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DropletIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 3c2.5 3.8 6.5 7.5 6.5 12a6.5 6.5 0 0 1-13 0C5.5 10.5 9.5 6.8 12 3z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ScaleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect
        x="3"
        y="4"
        width="18"
        height="16"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <circle cx="12" cy="13" r="3.5" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 13l1.8-2.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path d="M9 7h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
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

