import { useState } from 'react';
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
import { createSession, completeSession } from './lib/sessionsApi';
import type { Tab } from './components/BottomNav';
import type { FullPlan, PlanExerciseRow } from './lib/plansApi';

type Modal = null | 'upload' | 'bodyWeight';

function Root() {
  const { session, loading } = useAuth();
  const [tab, setTab] = useState<Tab>('home');
  const [modal, setModal] = useState<Modal>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeDay, setActiveDay] = useState<FullPlan['training_days'][number] | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [exerciseIdx, setExerciseIdx] = useState<number | null>(null);

  const exercises = activeDay?.plan_exercises ?? [];
  const activeExercise: PlanExerciseRow | null =
    exerciseIdx != null && exercises[exerciseIdx] ? exercises[exerciseIdx] : null;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <div className="text-sm text-muted">Loading…</div>
      </div>
    );
  }

  if (!session) return <Login />;

  if (modal === 'upload') {
    return (
      <UploadPlan
        onCancel={() => setModal(null)}
        onSaved={() => {
          setRefreshKey((k) => k + 1);
          setModal(null);
          setTab('home');
        }}
      />
    );
  }

  if (modal === 'bodyWeight') {
    return <BodyWeight onBack={() => setModal(null)} />;
  }

  async function startExercise(exercise: PlanExerciseRow, existingSessionId?: string) {
    if (!activeDay) return;
    let sid = existingSessionId ?? sessionId;
    if (!sid) {
      try {
        const sess = await createSession(activeDay.id);
        sid = sess.id;
      } catch (e) {
        console.error(e);
        return;
      }
    }
    setSessionId(sid);
    const idx = exercises.findIndex((e) => e.id === exercise.id);
    setExerciseIdx(idx >= 0 ? idx : 0);
  }

  if (activeDay && exerciseIdx != null && activeExercise) {
    return (
      <ExerciseLogger
        sessionId={sessionId!}
        exercise={activeExercise}
        hasNext={exerciseIdx < exercises.length - 1}
        hasPrev={exerciseIdx > 0}
        totalExercises={exercises.length}
        exerciseIndex={exerciseIdx}
        onBack={() => setExerciseIdx(null)}
        onPrev={() => setExerciseIdx((i) => (i != null && i > 0 ? i - 1 : i))}
        onNext={() => setExerciseIdx((i) => (i != null ? i + 1 : null))}
        onFinish={async () => {
          if (sessionId) {
            try {
              await completeSession(sessionId);
            } catch (e) {
              console.error(e);
            }
          }
          setExerciseIdx(null);
          setSessionId(null);
          setActiveDay(null);
        }}
      />
    );
  }

  if (activeDay) {
    return (
      <DayView
        day={activeDay}
        onBack={() => {
          setActiveDay(null);
          setSessionId(null);
        }}
        onTapExercise={startExercise}
      />
    );
  }

  switch (tab) {
    case 'home':
      return (
        <Home
          key={refreshKey}
          onUploadPlan={() => setModal('upload')}
          onTabChange={setTab}
          onLogBodyWeight={() => setModal('bodyWeight')}
          onTapDay={setActiveDay}
        />
      );
    case 'workouts':
      return (
        <ComingSoon
          active="workouts"
          title="Workouts"
          subtitle="A flat list of every training day with quick-jump search."
          onTabChange={setTab}
        />
      );
    case 'progress':
      return (
        <ComingSoon
          active="progress"
          title="Progress"
          subtitle="PRs, est. 1RM, body weight trend, exercise history."
          onTabChange={setTab}
        />
      );
    case 'profile':
      return <Profile onUploadPlan={() => setModal('upload')} onTabChange={setTab} />;
  }
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
