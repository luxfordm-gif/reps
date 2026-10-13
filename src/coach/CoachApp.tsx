// Reps on a computer, at /coach: your own training on a big screen, and —
// for a coach — the athletes who have sent them an invite code, read-only.
// /coach/demo shows the same pages filled with made-up training, signed in
// or not.

import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider } from '../lib/auth';
import { useAuth } from '../lib/useAuth';
import { isSupabaseConfigured } from '../lib/supabase';
import { Login } from '../screens/Login';
import { SetNewPassword } from '../screens/SetNewPassword';
import { Logo } from '../components/Logo';
import { AthletesScreen } from './AthletesScreen';
import { AthleteLayout } from './AthleteLayout';
import { WeekScreen } from './WeekScreen';
import { BodyPartScreen } from './BodyPartScreen';
import { ExerciseScreen } from './ExerciseScreen';
import { SessionScreen } from './SessionScreen';
import { setCoachUnits, useCoachUnits } from './format';
import { STAY_HOME } from './athleteContext';

export default function CoachApp() {
  if (!isSupabaseConfigured) {
    return (
      <div className="flex min-h-full items-center justify-center p-8 text-sm text-muted">
        Configuration missing: set VITE_SUPABASE_URL and VITE_SUPABASE_KEY.
      </div>
    );
  }
  return (
    <AuthProvider>
      <BrowserRouter>
        <Gate />
      </BrowserRouter>
    </AuthProvider>
  );
}

function Gate() {
  const { session, loading, passwordRecovery, clearPasswordRecovery } = useAuth();
  const { pathname } = useLocation();
  const demo = pathname.startsWith('/coach/demo');
  if (loading) return null;
  if (passwordRecovery) return <SetNewPassword onDone={clearPasswordRecovery} />;
  if (!session && !demo) {
    return <Login note="Reps on a computer. Sign in to see your training, or the athletes who have invited you." />;
  }
  return (
    <div className="min-h-full bg-paper">
      <TopBar email={session?.user.email ?? null} signedIn={session != null} />
      <main className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-8">
        <Routes>
          <Route path="/coach" element={<AthletesScreen />} />
          <Route path="/coach/:athleteId" element={<AthleteLayout />}>
            <Route index element={<WeekScreen />} />
            <Route path="body-part/:part" element={<BodyPartScreen />} />
            <Route path="exercise/:name" element={<ExerciseScreen />} />
            <Route path="session/:sessionId" element={<SessionScreen />} />
          </Route>
          <Route path="*" element={<AthletesScreen />} />
        </Routes>
      </main>
    </div>
  );
}

function TopBar({ email, signedIn }: { email: string | null; signedIn: boolean }) {
  const { signOut } = useAuth();
  const units = useCoachUnits();
  return (
    <header className="border-b border-line bg-paper-card">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-8">
        <Link to="/coach" state={STAY_HOME} className="flex items-center gap-2.5">
          <Logo className="h-6 w-auto" />
        </Link>
        <div className="ml-auto flex flex-wrap items-center gap-4">
          <UnitSwitch
            label="Lifts"
            value={units.lift}
            options={['kg', 'lb']}
            onChange={(lift) => setCoachUnits({ ...units, lift })}
          />
          <UnitSwitch
            label="Body weight"
            value={units.body}
            options={['kg', 'st']}
            onChange={(body) => setCoachUnits({ ...units, body })}
          />
          {email && <span className="hidden text-sm text-muted md:inline">{email}</span>}
          {signedIn ? (
            <button
              onClick={() => void signOut()}
              className="rounded-pill px-3 py-1.5 text-sm font-semibold text-ink hover:bg-pressed"
            >
              Sign out
            </button>
          ) : (
            <Link to="/coach" className="rounded-pill bg-ink px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

function UnitSwitch<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: T[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted">{label}</span>
      <Segmented value={value} options={options.map((o) => ({ value: o, label: o }))} onChange={onChange} />
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-pill bg-surface-strong p-0.5" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`rounded-pill px-3 py-1 text-xs font-semibold transition-colors ${
            o.value === value ? 'bg-ink text-white' : 'text-muted hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
