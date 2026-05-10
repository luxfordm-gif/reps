import { useEffect, useRef, useState } from 'react';
import { TrainingDayCard } from '../components/TrainingDayCard';
import { BottomNav, type Tab } from '../components/BottomNav';
import { AppHeader } from '../components/AppHeader';
import { WeeklyProgress } from '../components/WeeklyProgress';
import { getActivePlan, type FullPlan } from '../lib/plansApi';
import { getLastCompletedTrainingDayName } from '../lib/sessionsApi';
import {
  getTodayWaterCount,
  adjustWater,
  getWaterGoal,
  getWaterUnit,
} from '../lib/waterApi';

type Day = FullPlan['training_days'][number];

interface Props {
  onUploadPlan: () => void;
  onTabChange: (tab: Tab) => void;
  onLogBodyWeight: () => void;
  onTapDay: (day: Day) => void;
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

function getNextDayName(days: { name: string }[], lastCompleted: string | null) {
  if (days.length === 0) return null;
  // No prior completed workout — don't pre-select anything as "Up next"
  if (!lastCompleted) return null;
  const idx = days.findIndex((d) => d.name === lastCompleted);
  if (idx === -1) return null;
  return days[(idx + 1) % days.length].name;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 22) return 'Good evening';
  return 'Hey';
}

export function Home({ onUploadPlan, onTabChange, onLogBodyWeight, onTapDay }: Props) {
  const [plan, setPlan] = useState<FullPlan | null>(null);
  const [lastCompleted, setLastCompleted] = useState<string | null>(null);
  const [waterCount, setWaterCount] = useState(0);
  const [waterGoal] = useState(() => getWaterGoal());
  const [waterUnit] = useState(() => getWaterUnit());
  const [waterBusy, setWaterBusy] = useState(false);
  const [waterError, setWaterError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    Promise.all([getActivePlan(), getLastCompletedTrainingDayName(), getTodayWaterCount()])
      .then(([p, lc, w]) => {
        if (!mounted) return;
        setPlan(p);
        setLastCompleted(lc);
        setWaterCount(w);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not save water count';
      setWaterError(msg);
      console.error('[water] adjust failed', err);
    } finally {
      setWaterBusy(false);
    }
  }

  const today = new Date()
    .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
    .toUpperCase();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <div className="text-sm text-muted">Loading…</div>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="min-h-screen bg-paper pb-28">
        <div className="mx-auto max-w-md px-5 pt-12">
          <AppHeader />

          <div className="mt-16 rounded-card bg-paper-card p-8 text-center shadow-card">
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
        <BottomNav active="home" onChange={onTabChange} />
      </div>
    );
  }

  const days = plan.training_days ?? [];
  const mainDays = days.filter((d) => d.name !== 'Abs');
  const absDay = days.find((d) => d.name === 'Abs');
  const nextDayName = getNextDayName(mainDays, lastCompleted);
  const nextDay = nextDayName ? mainDays.find((d) => d.name === nextDayName) : undefined;
  const otherDays = nextDay ? mainDays.filter((d) => d.name !== nextDay.name) : mainDays;

  return (
    <div className="min-h-screen bg-paper pb-28">
      <div className="mx-auto max-w-md px-5 pt-6">
        <AppHeader />

        <div className="mt-5">
          <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted">
            {today}
          </div>
          <h1 className="mt-1 text-[32px] font-bold leading-[1.1] tracking-tight text-ink">
            {greeting()}, {FIRST_NAME}.
          </h1>
          <p className="mt-1.5 text-base text-muted">
            Ready to crush your goals today?
          </p>
        </div>

        <div className="mt-6">
          <WeeklyProgress workoutsDone={0} workoutsTarget={5} bars={[0, 0, 0, 0, 0, 0, 0]} />
        </div>

        {nextDay && (
          <div className="mt-7">
            <SectionLabel>Today's Workout</SectionLabel>
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
          <SectionLabel>Quick Actions</SectionLabel>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <WaterAction
              count={waterCount}
              goal={waterGoal}
              unit={waterUnit}
              busy={waterBusy}
              onTap={() => handleWaterTap(1)}
              onLongPress={() => handleWaterTap(-1)}
            />
            <QuickAction
              icon={<ScaleIcon />}
              label="Log body weight"
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
          <SectionLabel>All Workouts</SectionLabel>
          <div className="mt-3 space-y-3">
            {otherDays.map((day) => (
              <TrainingDayCard
                key={day.id}
                name={day.name}
                bodyParts={bodyPartsForDay(day.plan_exercises ?? [])}
                exerciseCount={(day.plan_exercises ?? []).length}
                accent={ACCENTS[day.name] ?? FALLBACK_ACCENT}
                onClick={() => onTapDay(day)}
              />
            ))}
            {absDay && (
              <button
                onClick={() => onTapDay(absDay)}
                className="flex w-full items-center justify-between rounded-card bg-paper-card px-5 py-5 text-left shadow-card"
              >
                <div>
                  <div className="text-base font-semibold text-ink">Abs</div>
                  <div className="mt-0.5 text-sm text-muted">
                    2× weekly · {(absDay.plan_exercises ?? []).length} exercises
                  </div>
                </div>
                <ChevronRight />
              </button>
            )}
          </div>
        </div>
      </div>

      <BottomNav active="home" onChange={onTabChange} />
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
        hapticBuzz(12);
        onClick?.();
      }}
      className="quick-action-enter quick-action-enter-2 flex items-center justify-center gap-2 rounded-card bg-paper-card py-4 text-sm font-medium text-ink shadow-card transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
    >
      {icon}
      {label}
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
    <button
      onPointerDown={start}
      onPointerUp={end}
      onPointerCancel={clearTimer}
      disabled={busy}
      className="quick-action-enter quick-action-enter-1 relative flex flex-col items-start gap-1 overflow-hidden rounded-card bg-paper-card px-4 py-3 text-left shadow-card transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] touch-none select-none active:scale-[0.97]"
    >
      <div
        className="water-fill absolute inset-y-0 left-0 bg-[#E5F0FF]"
        style={{ width: `${pct * 100}%` }}
      />
      <div className="relative flex w-full items-center gap-1.5 text-ink">
        <DropletIcon />
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
          Water
        </span>
      </div>
      <div className="relative text-base font-bold tracking-tight text-ink">
        <span key={count} className="water-count tabular-nums">
          {count}
        </span>{' '}
        / {goal}{' '}
        <span className="text-xs font-medium text-muted">{unit}</span>
      </div>
    </button>
  );
}

function DropletIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
      <path
        d="M9 2c2 3 5 6 5 9.5A5 5 0 0 1 9 16.5 5 5 0 0 1 4 11.5C4 8 7 5 9 2z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ScaleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path
        d="M3 5h12l-1.5 9a1 1 0 0 1-1 .9H5.5a1 1 0 0 1-1-.9L3 5z M9 5V3 M7 3h4"
        stroke="currentColor"
        strokeWidth="1.5"
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

function ChevronRight() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-muted">
      <path
        d="M7.5 4L13.5 10L7.5 16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
