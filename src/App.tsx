import { useCallback, useEffect, useRef, useState } from 'react';
import { WhatsNewModal } from './components/WhatsNewModal';
import { EndWorkoutDialog } from './components/EndWorkoutDialog';
import { LATEST_CHANGELOG_ENTRY } from './lib/changelog';
import { AuthProvider, useAuth } from './lib/auth';
import { isSupabaseConfigured } from './lib/supabase';
import { Home } from './screens/Home';
import { Login } from './screens/Login';
import { UploadPlan } from './screens/UploadPlan';
import { BodyWeight } from './screens/BodyWeight';
import { Steps } from './screens/Steps';
import { Profile } from './screens/Profile';
import { Plans } from './screens/Plans';
import { Performance } from './screens/Performance';
import { DayView } from './screens/DayView';
import { ExerciseLogger } from './screens/ExerciseLogger';
import { SetNewPassword } from './screens/SetNewPassword';
import { WorkoutHistory } from './screens/WorkoutHistory';
import { Machines } from './screens/Machines';
import { FeedbackSheet } from './components/FeedbackSheet';
import { WorkoutComplete } from './screens/WorkoutComplete';
import { Onboarding } from './screens/Onboarding';
import {
  createSession,
  completeSession,
  deleteAllOpenSessions,
} from './lib/sessionsApi';
import { BottomNav, type Tab } from './components/BottomNav';
import { ActiveWorkoutBar, type ActiveWorkoutInfo } from './components/ActiveWorkoutBar';
import { InstallPrompt } from './components/InstallPrompt';
import { Splash } from './components/Splash';
import { clearHomeCache, loadHomeData } from './lib/homeCache';
import { requestFlush } from './lib/offline/outbox';
import { subscribeNet, isReachable } from './lib/offline/net';
import { reconcileRecentWorkouts } from './lib/offline/reconcile';
import { warmLastSetsForPlan } from './lib/sessionsApi';
import type { FullPlan, PlanExerciseRow } from './lib/plansApi';
import { supersetMembers } from './lib/supersets';
import { getMyProfile, type Profile as ProfileData } from './lib/profileApi';

type Modal =
  | null
  | 'upload'
  | 'bodyWeight'
  | 'steps'
  | 'history'
  | 'plans'
  | 'onboarding'
  | 'machines';

// Onboarding has been offered on this device. Setting up is worth asking about
// once, on a fresh install — after that it's the user's business, and Profile →
// Personal details is where it gets finished. The flag is local rather than on
// the profile row so that a failed write (offline, RLS hiccup) can't turn the
// flow into something that reappears on every launch.
const ONBOARDING_OFFERED_KEY = 'reps.onboardingOffered';

function onboardingOffered(): boolean {
  try {
    return window.localStorage.getItem(ONBOARDING_OFFERED_KEY) === '1';
  } catch {
    return false;
  }
}

function markOnboardingOffered(): void {
  try {
    window.localStorage.setItem(ONBOARDING_OFFERED_KEY, '1');
  } catch {
    // Private mode with storage disabled — worst case we offer again.
  }
}

/**
 * After a workout: give the flush a moment to land, then confirm the session
 * really is on the server and cache today's sets as next week's "last time" —
 * so next week pre-fills even if the phone never finds signal again first.
 */
function afterWorkoutSync(): void {
  window.setTimeout(() => {
    reconcileRecentWorkouts({ force: true }).catch(() => {});
    warmLastSetsForPlan({ force: true }).catch(() => {});
  }, 4000);
}

function Root() {
  const { session, loading, passwordRecovery, clearPasswordRecovery } = useAuth();
  const [splashMinElapsed, setSplashMinElapsed] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setSplashMinElapsed(true), 700);
    return () => window.clearTimeout(t);
  }, []);
  const splashVisible = loading || !splashMinElapsed;
  // Warm the Home cache as soon as the user is signed in, so the data is
  // (likely) ready by the time the splash fades. Wipe it on sign-out so a
  // different user can't see the previous account's content.
  useEffect(() => {
    if (session) {
      loadHomeData().catch(() => {});
    } else {
      clearHomeCache();
    }
  }, [session]);
  // Two things that have to happen while there is still signal, because the
  // gym won't have any: pull every exercise's last weights onto the phone, and
  // check that the last workout actually made it to the server. Both run again
  // the moment a connection comes back — including when the "one bar" cool-off
  // ends, which is the case that actually matters mid-workout.
  useEffect(() => {
    if (!session) return;
    const sync = (force: boolean) => {
      warmLastSetsForPlan({ force }).catch(() => {});
      reconcileRecentWorkouts({ force }).catch(() => {});
    };
    sync(false);
    let wasReachable = isReachable();
    return subscribeNet(() => {
      const now = isReachable();
      const regained = now && !wasReachable;
      wasReachable = now;
      if (regained) sync(true);
    });
  }, [session]);
  const [tab, setTab] = useState<Tab>('home');
  const [modal, setModal] = useState<Modal>(null);
  // The feedback sheet overlays whatever is on screen rather than being a
  // Modal: a report is most useful mid-workout, and routing to it would throw
  // away the very screen being reported.
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeDay, setActiveDay] = useState<FullPlan['training_days'][number] | null>(null);
  // The other week's version of the active day, when the plan rotates — DayView
  // shows a switch to it. Cleared with activeDay.
  const [activeDaySibling, setActiveDaySibling] = useState<
    FullPlan['training_days'][number] | null
  >(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionStartedAt, setSessionStartedAt] = useState<string | null>(null);
  const [exerciseIdx, setExerciseIdx] = useState<number | null>(null);
  const [completedSession, setCompletedSession] = useState<{ id: string; dayName: string } | null>(
    null
  );
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  const [endWorkoutOpen, setEndWorkoutOpen] = useState(false);
  // The workout in progress, as Home found it. Held up here so the bar over
  // the tab bar can show it on every tab — a running session used to exist
  // only on Home, and walking to Performance made it vanish.
  const [activeWorkout, setActiveWorkout] = useState<ActiveWorkoutInfo | null>(null);
  // Whether Home's own in-progress card is still on screen. Assumed true the
  // moment we land on Home, because every screen change scrolls to the top and
  // the card lives there — without that the bar flashes in for a frame before
  // the observer has had anything to report.
  const [activeCardVisible, setActiveCardVisible] = useState(true);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [onboardingDismissedThisSession, setOnboardingDismissedThisSession] = useState(false);

  // Fetch profile when the user signs in. Brand-new accounts — no profile row,
  // and no offer made on this device yet — get shown the setup flow once. An
  // unfinished profile is never chased again after that: nothing in the app
  // needs it, and Profile → Personal details picks it up whenever the user
  // wants. A failed fetch must not block sign-in, so we swallow errors and
  // just leave profile=null.
  useEffect(() => {
    if (!session) {
      setProfile(null);
      setOnboardingDismissedThisSession(false);
      return;
    }
    let cancelled = false;
    getMyProfile()
      .then((p) => {
        if (cancelled) return;
        setProfile(p);
        if (!onboardingDismissedThisSession && !p && !onboardingOffered()) {
          markOnboardingOffered();
          setModal('onboarding');
        }
      })
      .catch(() => {
        // Ignore — Home stays accessible even if profile fetch fails.
      });
    return () => {
      cancelled = true;
    };
    // We intentionally don't depend on onboardingDismissedThisSession; this
    // effect should only re-run on session change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  useEffect(() => {
    if (!session) return;
    if (typeof window === 'undefined') return;
    const seen = window.localStorage.getItem('reps.lastSeenVersion');
    if (seen === LATEST_CHANGELOG_ENTRY.version) return;
    if (seen === null) {
      // First load on this device — baseline silently so we only pop the
      // modal for *real* updates, not the initial install.
      window.localStorage.setItem(
        'reps.lastSeenVersion',
        LATEST_CHANGELOG_ENTRY.version
      );
      return;
    }
    setShowWhatsNew(true);
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
      window.localStorage.setItem('reps.lastSeenVersion', LATEST_CHANGELOG_ENTRY.version);
    }
    setShowWhatsNew(false);
  }

  const exercises = activeDay?.plan_exercises ?? [];
  const activeExercise: PlanExerciseRow | null =
    exerciseIdx != null && exercises[exerciseIdx] ? exercises[exerciseIdx] : null;
  // Exercises the plan says to run back to back — a superset, tri-set or giant
  // set. The logger cycles through them instead of resting between them, so it
  // needs the one to hand over to and whether this is the round's last.
  const roundMembers = activeExercise ? supersetMembers(activeExercise, exercises) : [];
  const memberIdx = roundMembers.findIndex((e) => e.id === activeExercise?.id);
  const supersetNext: PlanExerciseRow | null =
    memberIdx >= 0 ? roundMembers[(memberIdx + 1) % roundMembers.length] : null;
  const supersetNextIdx = supersetNext
    ? exercises.findIndex((e) => e.id === supersetNext.id)
    : -1;

  const navVisible =
    screenKey === 'tab:home' ||
    screenKey === 'tab:performance' ||
    screenKey === 'tab:profile';

  // Both of these are read by effects in Home, so they have to keep the same
  // identity across renders — an inline arrow would re-run the effect that
  // calls it, which sets the state that caused the render.
  const handleResumeWorkout = useCallback(
    ({
      day,
      exerciseIdx: idx,
      sessionId: sid,
      startedAt,
    }: {
      day: FullPlan['training_days'][number];
      exerciseIdx: number;
      sessionId: string;
      startedAt: string;
    }) => {
      setActiveDay(day);
      setSessionId(sid);
      setSessionStartedAt(startedAt);
      setExerciseIdx(idx);
    },
    [],
  );

  // A plan has just been imported — from the upload modal, or from the upload
  // screen Home shows in place of itself until there is a plan.
  function handlePlanSaved() {
    clearHomeCache();
    setRefreshKey((k) => k + 1);
    setModal(null);
    setTab('home');
  }

  function changeTab(next: Tab) {
    // Arriving at Home puts its in-progress card back at the top of the page,
    // so the docked bar steps aside until a scroll says otherwise.
    if (next === 'home') setActiveCardVisible(true);
    setTab(next);
  }

  // The bar shows wherever the tab bar does, except on Home while the card it
  // stands in for is still in view — two of the same thing on one screen reads
  // as a mistake.
  const barVisible = !!activeWorkout && navVisible && !(tab === 'home' && activeCardVisible);

  // Screens marked `pb-nav` leave room for the tab bar; this tops it up with
  // the bar's own height so the last card on a screen can't end up behind it.
  useEffect(() => {
    const root = document.documentElement;
    if (barVisible) root.style.setProperty('--active-bar-h', '72px');
    else root.style.removeProperty('--active-bar-h');
    return () => {
      root.style.removeProperty('--active-bar-h');
    };
  }, [barVisible]);

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
    body = <UploadPlan onCancel={() => setModal(null)} onSaved={handlePlanSaved} />;
  } else if (modal === 'bodyWeight') {
    body = <BodyWeight onBack={() => setModal(null)} />;
  } else if (modal === 'steps') {
    body = <Steps onBack={() => setModal(null)} />;
  } else if (modal === 'onboarding') {
    body = (
      <Onboarding
        initial={profile}
        onClose={(completed) => {
          setModal(null);
          setOnboardingDismissedThisSession(true);
          // Refresh the profile so banners/dots update.
          getMyProfile().then(setProfile).catch(() => {});
          if (completed) {
            clearHomeCache();
            setRefreshKey((k) => k + 1);
          }
        }}
      />
    );
  } else if (modal === 'history') {
    body = <WorkoutHistory onBack={() => setModal(null)} />;
  } else if (modal === 'machines') {
    body = (
      <Machines
        onBack={() => {
          clearHomeCache();
          setRefreshKey((k) => k + 1);
          setModal(null);
        }}
      />
    );
  } else if (modal === 'plans') {
    body = (
      <Plans
        onBack={() => setModal(null)}
        onUpload={() => setModal('upload')}
        onAfterActivate={() => {
          clearHomeCache();
          setRefreshKey((k) => k + 1);
        }}
      />
    );
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
          supersetNext={supersetNext}
          supersetPartnerNames={roundMembers
            .filter((e) => e.id !== activeExercise.id)
            .map((e) => e.name)}
          supersetLastOfRound={memberIdx === roundMembers.length - 1}
          onGoToSupersetNext={
            supersetNextIdx >= 0 ? () => setExerciseIdx(supersetNextIdx) : undefined
          }
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
          onFeedback={() => setFeedbackOpen(true)}
          onFinish={async () => {
            const sid = sessionId;
            const finishedDay = activeDay?.name ?? 'Workout';
            if (sid) {
              try {
                await completeSession(sid);
              } catch (e) {
                console.error(e);
              }
              // Everything logged during the workout goes up now, if it can.
              requestFlush();
              afterWorkoutSync();
            }
            setExerciseIdx(null);
            setSessionId(null);
            setSessionStartedAt(null);
            setActiveDay(null);
            setActiveWorkout(null);
            if (sid) {
              setCompletedSession({ id: sid, dayName: finishedDay });
              clearHomeCache();
              setRefreshKey((k) => k + 1);
            }
          }}
        />
      </>
    );
  } else if (activeDay) {
    body = (
      <DayView
        day={activeDay}
        siblingDay={activeDaySibling}
        onSwitchToSibling={
          activeDaySibling
            ? () => {
                // Swap which week's version is open; the old day becomes the
                // sibling so you can switch straight back.
                const current = activeDay;
                setActiveDay(activeDaySibling);
                setActiveDaySibling(current);
              }
            : undefined
        }
        onBack={() => {
          setActiveDay(null);
          setActiveDaySibling(null);
          setSessionId(null);
          setSessionStartedAt(null);
        }}
        onTapExercise={startExercise}
        onDayUpdate={(updated) => {
          setActiveDay(updated);
          // The Home cache holds the pre-reorder plan; drop it so the next
          // Home visit refetches the saved order and reset baselines.
          clearHomeCache();
        }}
      />
    );
  } else {
    let screen: React.ReactNode = null;
    switch (tab) {
      case 'home':
        screen = (
          <Home
            key={refreshKey}
            onPlanSaved={handlePlanSaved}
            onLogBodyWeight={() => setModal('bodyWeight')}
            onLogSteps={() => setModal('steps')}
            onTapDay={(day, sibling) => {
              setActiveDay(day);
              setActiveDaySibling(sibling ?? null);
            }}
            profile={profile}
            onResumeWorkout={handleResumeWorkout}
            onActiveWorkoutChange={setActiveWorkout}
            onActiveCardVisibilityChange={setActiveCardVisible}
          />
        );
        break;
      case 'performance':
        screen = <Performance />;
        break;
      case 'profile':
        screen = (
          <Profile
            onUploadPlan={() => setModal('upload')}
            onOpenHistory={() => setModal('history')}
            onOpenPlans={() => setModal('plans')}
            onOpenMachines={() => setModal('machines')}
            profile={profile}
            onProfileChange={setProfile}
            onResumeOnboarding={() => setModal('onboarding')}
          />
        );
        break;
    }
    body = (
      <>
        <TabSwipeContainer tab={tab} onTabChange={changeTab}>{screen}</TabSwipeContainer>
        {/* Home only, and never over the top of the release notes — the app
            gets one thing to ask for at a time. */}
        {tab === 'home' && !showWhatsNew && <InstallPrompt />}
        {showWhatsNew && (
          <WhatsNewModal entry={LATEST_CHANGELOG_ENTRY} onDismiss={dismissWhatsNew} />
        )}
      </>
    );
  }

  return (
    <>
      {body}
      <BottomNav
        active={tab}
        onChange={changeTab}
        visible={navVisible}
        onFeedback={session ? () => setFeedbackOpen(true) : undefined}
        above={
          barVisible && activeWorkout ? (
            <ActiveWorkoutBar info={activeWorkout} onEnd={() => setEndWorkoutOpen(true)} />
          ) : null
        }
      />
      {endWorkoutOpen && (
        <EndWorkoutDialog
          onSave={handleEndSave}
          onDiscard={handleEndDiscard}
          onCancel={() => setEndWorkoutOpen(false)}
        />
      )}
      {feedbackOpen && (
        <FeedbackSheet screen={screenKey} onClose={() => setFeedbackOpen(false)} />
      )}
      <Splash visible={splashVisible} />
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
    // Ending from the docked bar means no logger is on screen and none of the
    // per-workout state is set — the session is whatever the bar is showing.
    const sid = sessionId ?? activeWorkout?.context.sessionId ?? null;
    const finishedDay =
      activeDay?.name ?? activeWorkout?.context.trainingDayName ?? 'Workout';
    setEndWorkoutOpen(false);
    if (sid) {
      try {
        await completeSession(sid);
      } catch (e) {
        console.error(e);
      }
      requestFlush();
      afterWorkoutSync();
    }
    setExerciseIdx(null);
    setSessionId(null);
    setSessionStartedAt(null);
    setActiveDay(null);
    setActiveWorkout(null);
    if (sid) {
      setCompletedSession({ id: sid, dayName: finishedDay });
      clearHomeCache();
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
    setActiveWorkout(null);
    clearHomeCache();
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
      {/* Keyed on the tab so switching re-runs the fade — for a swipe as much
          as a tap. Opacity only, and short: this is here to stop a tab change
          landing with a bang, not to be noticed. */}
      <div key={tab} className="tab-fade">
        {children}
      </div>
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
