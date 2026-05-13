import { useEffect, useRef, useState } from 'react';
import { WhatsNewModal } from './components/WhatsNewModal';
import { EndWorkoutDialog } from './components/EndWorkoutDialog';
import { APP_VERSION, getEntryForVersion } from './lib/changelog';
import { AuthProvider, useAuth } from './lib/auth';
import { isSupabaseConfigured } from './lib/supabase';
import { Home } from './screens/Home';
import { Login } from './screens/Login';
import { UploadPlan } from './screens/UploadPlan';
import { BodyWeight } from './screens/BodyWeight';
import { Profile } from './screens/Profile';
import { ComingSoon } from './screens/ComingSoon';
import { DayView } from './screens/DayView';
import { ExerciseLogger } from './screens/ExerciseLogger';
import { SetNewPassword } from './screens/SetNewPassword';
import { WorkoutHistory } from './screens/WorkoutHistory';
import { WorkoutComplete } from './screens/WorkoutComplete';
import {
  createSession,
  completeSession,
  deleteAllOpenSessions,
} from './lib/sessionsApi';
import { BottomNav, type Tab } from './components/BottomNav';
import type { FullPlan, PlanExerciseRow } from './lib/plansApi';

type Modal = null | 'upload' | 'bodyWeight' | 'history';

function Root() {
  const { session, loading, passwordRecovery, clearPasswordRecovery } = useAuth();
  const [tab, setTab] = useState<Tab>('home');
  const [modal, setModal] = useState<Modal>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeDay, setActiveDay] = useState<FullPlan['training_days'][number] | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionStartedAt, setSessionStartedAt] = useState<string | null>(null);
  const [exerciseIdx, setExerciseIdx] = useState<number | null>(null);
  const [completedSession, setCompletedSession] = useState<{ id: string; dayName: string } | null>(
    null
  );
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  const [endWorkoutOpen, setEndWorkoutOpen] = useState(false);

  useEffect(() => {
    if (!session) return;
    if (typeof window === 'undefined') return;
    const seen = window.localStorage.getItem('reps.lastSeenVersion');
    if (seen !== APP_VERSION && getEntryForVersion(APP_VERSION)) {
      setShowWhatsNew(true);
    }
  }, [session]);

  const screenKey = loading
    ? 'loading'
    : passwordRecovery
      ? 'pw'
      : !session
        ? 'login'
        : modal
          ? `modal:${modal}`
          : completedSession
            ? 'complete'
            : activeDay && exerciseIdx != null
              ? `exercise:${exerciseIdx}`
              : activeDay
                ? `day:${activeDay.id}`
                : `tab:${tab}`;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.scrollTo(0, 0);
  }, [screenKey]);

  function dismissWhatsNew() {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('reps.lastSeenVersion', APP_VERSION);
    }
    setShowWhatsNew(false);
  }

  const exercises = activeDay?.plan_exercises ?? [];
  const activeExercise: PlanExerciseRow | null =
    exerciseIdx != null && exercises[exerciseIdx] ? exercises[exerciseIdx] : null;

  const navVisible =
    screenKey === 'tab:home' ||
    screenKey === 'tab:performance' ||
    screenKey === 'tab:profile';

  let body: React.ReactNode = null;

  if (loading) {
    body = (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <div className="text-sm text-muted">Loading…</div>
      </div>
    );
  } else if (passwordRecovery) {
    body = <SetNewPassword onDone={clearPasswordRecovery} />;
  } else if (!session) {
    body = <Login />;
  } else if (modal === 'upload') {
    body = (
      <UploadPlan
        onCancel={() => setModal(null)}
        onSaved={() => {
          setRefreshKey((k) => k + 1);
          setModal(null);
          setTab('home');
        }}
      />
    );
  } else if (modal === 'bodyWeight') {
    body = <BodyWeight onBack={() => setModal(null)} />;
  } else if (modal === 'history') {
    body = <WorkoutHistory onBack={() => setModal(null)} />;
  } else if (completedSession) {
    body = (
      <WorkoutComplete
        sessionId={completedSession.id}
        dayName={completedSession.dayName}
        onDone={() => setCompletedSession(null)}
      />
    );
  } else if (activeDay && exerciseIdx != null && activeExercise) {
    body = (
      <>
        <ExerciseLogger
          sessionId={sessionId!}
          sessionStartedAt={sessionStartedAt}
          dayName={activeDay.name}
          exercise={activeExercise}
          hasNext={exerciseIdx < exercises.length - 1}
          hasPrev={exerciseIdx > 0}
          totalExercises={exercises.length}
          exerciseIndex={exerciseIdx}
          onBack={() => setExerciseIdx(null)}
          onPrev={() => setExerciseIdx((i) => (i != null && i > 0 ? i - 1 : i))}
          onNext={() => setExerciseIdx((i) => (i != null ? i + 1 : null))}
          onOverview={() => setExerciseIdx(null)}
          onHome={() => {
            setExerciseIdx(null);
            setActiveDay(null);
          }}
          onEndWorkout={() => setEndWorkoutOpen(true)}
          onFinish={async () => {
            const sid = sessionId;
            const finishedDay = activeDay?.name ?? 'Workout';
            if (sid) {
              try {
                await completeSession(sid);
              } catch (e) {
                console.error(e);
              }
            }
            setExerciseIdx(null);
            setSessionId(null);
            setSessionStartedAt(null);
            setActiveDay(null);
            if (sid) {
              setCompletedSession({ id: sid, dayName: finishedDay });
              setRefreshKey((k) => k + 1);
            }
          }}
        />
        {endWorkoutOpen && (
          <EndWorkoutDialog
            onSave={handleEndSave}
            onDiscard={handleEndDiscard}
            onCancel={() => setEndWorkoutOpen(false)}
          />
        )}
      </>
    );
  } else if (activeDay) {
    body = (
      <DayView
        day={activeDay}
        onBack={() => {
          setActiveDay(null);
          setSessionId(null);
          setSessionStartedAt(null);
        }}
        onTapExercise={startExercise}
      />
    );
  } else {
    let screen: React.ReactNode = null;
    switch (tab) {
      case 'home':
        screen = (
          <Home
            key={refreshKey}
            onUploadPlan={() => setModal('upload')}
            onLogBodyWeight={() => setModal('bodyWeight')}
            onTapDay={setActiveDay}
            onResumeWorkout={({ day, exerciseIdx, sessionId: sid, startedAt }) => {
              setActiveDay(day);
              setSessionId(sid);
              setSessionStartedAt(startedAt);
              setExerciseIdx(exerciseIdx);
            }}
          />
        );
        break;
      case 'performance':
        screen = (
          <ComingSoon
            title="Performance"
            subtitle="PRs, est. 1RM, body weight trend, exercise history."
          />
        );
        break;
      case 'profile':
        screen = (
          <Profile
            onUploadPlan={() => setModal('upload')}
            onOpenHistory={() => setModal('history')}
          />
        );
        break;
    }
    const entry = getEntryForVersion(APP_VERSION);
    body = (
      <>
        <TabSwipeContainer tab={tab} onTabChange={setTab}>{screen}</TabSwipeContainer>
        {showWhatsNew && entry && (
          <WhatsNewModal entry={entry} onDismiss={dismissWhatsNew} />
        )}
      </>
    );
  }

  return (
    <>
      {body}
      <BottomNav active={tab} onChange={setTab} visible={navVisible} />
    </>
  );

  async function startExercise(exercise: PlanExerciseRow, existingSessionId?: string) {
    if (!activeDay) return;
    let sid = existingSessionId ?? sessionId;
    if (!sid) {
      try {
        const sess = await createSession(activeDay.id);
        sid = sess.id;
        setSessionStartedAt(sess.started_at);
      } catch (e) {
        console.error(e);
        return;
      }
    }
    setSessionId(sid);
    const idx = exercises.findIndex((e) => e.id === exercise.id);
    setExerciseIdx(idx >= 0 ? idx : 0);
  }

  async function handleEndSave() {
    const sid = sessionId;
    const finishedDay = activeDay?.name ?? 'Workout';
    setEndWorkoutOpen(false);
    if (sid) {
      try {
        await completeSession(sid);
      } catch (e) {
        console.error(e);
      }
    }
    setExerciseIdx(null);
    setSessionId(null);
    setSessionStartedAt(null);
    setActiveDay(null);
    if (sid) {
      setCompletedSession({ id: sid, dayName: finishedDay });
      setRefreshKey((k) => k + 1);
    }
  }

  async function handleEndDiscard() {
    setEndWorkoutOpen(false);
    try {
      // Wipe ALL of the user's open sessions, not just the current one —
      // otherwise a lingering abandoned session can still show as
      // "Workout in progress" on the home screen.
      await deleteAllOpenSessions();
    } catch (e) {
      console.error(e);
    }
    setExerciseIdx(null);
    setSessionId(null);
    setSessionStartedAt(null);
    setActiveDay(null);
    setRefreshKey((k) => k + 1);
  }
}

const TAB_ORDER: Tab[] = ['home', 'performance', 'profile'];

function TabSwipeContainer({
  tab,
  onTabChange,
  children,
}: {
  tab: Tab;
  onTabChange: (t: Tab) => void;
  children: React.ReactNode;
}) {
  const start = useRef<{ x: number; y: number; ignore: boolean; claimed: boolean } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  function suppressNextClick() {
    const node = containerRef.current;
    if (!node) return;
    const handler = (ev: Event) => {
      ev.preventDefault();
      ev.stopPropagation();
      node.removeEventListener('click', handler, true);
    };
    node.addEventListener('click', handler, true);
    // Safety: clear after a tick in case no click follows
    window.setTimeout(() => node.removeEventListener('click', handler, true), 350);
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = e.target as HTMLElement;
    // Only bail on form fields where horizontal gestures are part of the UX
    // (text selection, range scrubbing). Buttons/links are fine — we'll claim
    // the gesture mid-swipe and suppress their trailing click.
    const ignore = !!target.closest(
      'input, textarea, select, [data-no-tab-swipe]'
    );
    start.current = { x: e.clientX, y: e.clientY, ignore, claimed: false };
  }

  function onPointerMove(e: React.PointerEvent) {
    const s = start.current;
    if (!s || s.ignore || s.claimed) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    // Claim the gesture once it looks like a horizontal swipe.
    if (Math.abs(dx) > 24 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      s.claimed = true;
      try {
        (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    const s = start.current;
    start.current = null;
    if (!s || s.ignore) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) < 60 || Math.abs(dy) > 60) return;
    const idx = TAB_ORDER.indexOf(tab);
    if (idx === -1) return;
    const nextIdx = dx < 0 ? idx + 1 : idx - 1;
    if (nextIdx < 0 || nextIdx >= TAB_ORDER.length) return;
    if (s.claimed) suppressNextClick();
    onTabChange(TAB_ORDER[nextIdx]);
  }

  return (
    <div
      ref={containerRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (start.current = null)}
    >
      {children}
    </div>
  );
}

function App() {
  if (!isSupabaseConfigured) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper p-8">
        <div className="max-w-md rounded-card bg-paper-card p-8 text-center shadow-card">
          <h1 className="text-2xl font-bold text-ink">Configuration missing</h1>
          <p className="mt-3 text-sm text-muted">
            The app couldn't find <code className="rounded bg-line px-1">VITE_SUPABASE_URL</code>{' '}
            or <code className="rounded bg-line px-1">VITE_SUPABASE_KEY</code> in this build.
          </p>
          <p className="mt-3 text-sm text-muted">
            Set both in Netlify → Site configuration → Environment variables, then{' '}
            <strong className="text-ink">trigger a fresh deploy with cache cleared</strong>.
          </p>
        </div>
      </div>
    );
  }
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  );
}

export default App;
