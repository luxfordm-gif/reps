import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Logo } from '../components/Logo';

type Mode = 'signin' | 'signup' | 'forgot';

export function Login() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [oauthBusy, setOauthBusy] = useState<'google' | 'apple' | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function handleOAuth(provider: 'google' | 'apple') {
    setError(null);
    setInfo(null);
    setOauthBusy(provider);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${window.location.origin}/` },
      });
      if (error) throw error;
      // On success the browser is redirecting; no state change needed.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start sign-in');
      setOauthBusy(null);
    }
  }

  function changeMode(m: Mode) {
    setMode(m);
    setError(null);
    setInfo(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setInfo('Check your email to confirm your account, then sign in.');
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/`,
        });
        if (error) throw error;
        setInfo('Check your email for a link to reset your password.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const titles: Record<Mode, { heading: string; subtitle: string; cta: string }> = {
    signin: {
      heading: 'Welcome back.',
      subtitle: 'Sign in to continue your training.',
      cta: 'Sign in',
    },
    signup: {
      heading: 'Create your account.',
      subtitle: "Let's get you set up.",
      cta: 'Create account',
    },
    forgot: {
      heading: 'Reset password.',
      subtitle: 'Enter your email and we’ll send you a link.',
      cta: 'Send reset link',
    },
  };
  const t = titles[mode];

  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-5">
        <div className="flex flex-1 flex-col justify-center">
          <Logo className="h-16 w-auto self-start" />

          <h1 className="mt-10 text-[32px] font-bold leading-tight tracking-tight text-ink">
            {t.heading}
          </h1>
          <p className="mt-1.5 text-base text-muted">{t.subtitle}</p>

          {mode !== 'forgot' && (
            <>
              <div className="mt-8 space-y-2">
                <OAuthButton
                  provider="google"
                  label="Continue with Google"
                  busy={oauthBusy === 'google'}
                  disabled={!!oauthBusy || busy}
                  onClick={() => handleOAuth('google')}
                />
                <OAuthButton
                  provider="apple"
                  label="Continue with Apple"
                  busy={oauthBusy === 'apple'}
                  disabled={!!oauthBusy || busy}
                  onClick={() => handleOAuth('apple')}
                />
              </div>
              <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-[0.12em] text-muted">
                <div className="h-px flex-1 bg-line" /> or <div className="h-px flex-1 bg-line" />
              </div>
            </>
          )}

          <form onSubmit={handleSubmit} className={mode === 'forgot' ? 'mt-8 space-y-3' : 'space-y-3'}>
            <Field
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              placeholder="you@example.com"
              autoComplete="email"
            />
            {mode !== 'forgot' && (
              <Field
                label="Password"
                type="password"
                value={password}
                onChange={setPassword}
                placeholder="••••••••"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              />
            )}

            {error && (
              <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}
            {info && (
              <div className="rounded-2xl bg-green-50 px-4 py-3 text-sm text-green-800">
                {info}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="mt-2 w-full rounded-pill bg-ink py-4 text-base font-semibold text-white transition-opacity active:opacity-80 disabled:opacity-50"
            >
              {busy ? 'Please wait…' : t.cta}
            </button>
          </form>

          <div className="mt-6 space-y-2 text-center text-sm text-muted">
            {mode === 'signin' && (
              <>
                <button onClick={() => changeMode('forgot')} className="block w-full">
                  Forgot password?
                </button>
                <button onClick={() => changeMode('signup')} className="block w-full">
                  New here? <span className="font-semibold text-ink">Create an account</span>
                </button>
              </>
            )}
            {mode === 'signup' && (
              <button onClick={() => changeMode('signin')} className="block w-full">
                Already have an account? <span className="font-semibold text-ink">Sign in</span>
              </button>
            )}
            {mode === 'forgot' && (
              <button onClick={() => changeMode('signin')} className="block w-full">
                <span className="font-semibold text-ink">Back to sign in</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Supabase OAuth setup notes (do these in the Supabase Dashboard, not in code):
//
//   Google
//   ------
//   1. Google Cloud Console → APIs & Services → Credentials → Create OAuth
//      2.0 Client ID (Web application).
//   2. Authorised redirect URI:
//        https://<project-ref>.supabase.co/auth/v1/callback
//      Authorised JavaScript origins: production domain AND
//        http://localhost:5173
//   3. Supabase → Authentication → Providers → Google: paste the Client ID
//      and Client Secret, enable.
//
//   Apple
//   -----
//   1. Apple Developer → Identifiers → Services ID (e.g. com.reps.web) with
//      "Sign In with Apple" enabled. Return URL is the Supabase callback above.
//   2. Create a Key with "Sign In with Apple" enabled, download the .p8.
//   3. Supabase → Authentication → Providers → Apple: paste Services ID,
//      Team ID, Key ID, and the .p8 contents.
//
//   Both
//   ----
//   In Supabase → Authentication → URL Configuration, allow-list the
//   production domain and http://localhost:5173/.
function OAuthButton({
  provider,
  label,
  busy,
  disabled,
  onClick,
}: {
  provider: 'google' | 'apple';
  label: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center justify-center gap-3 rounded-pill border border-line bg-paper-card py-3.5 text-base font-semibold text-ink transition-opacity active:opacity-80 disabled:opacity-50"
    >
      {provider === 'google' ? <GoogleIcon /> : <AppleIcon />}
      <span>{busy ? 'Redirecting…' : label}</span>
    </button>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.49h4.84a4.13 4.13 0 0 1-1.79 2.71v2.25h2.9c1.7-1.57 2.69-3.88 2.69-6.61z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.47-.81 5.96-2.19l-2.9-2.25c-.81.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.95v2.33A9 9 0 0 0 9 18z"
        fill="#34A853"
      />
      <path
        d="M3.95 10.7A5.41 5.41 0 0 1 3.65 9c0-.59.1-1.16.3-1.7V4.97H.95A9 9 0 0 0 0 9c0 1.45.35 2.83.95 4.03l3-2.33z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58A9 9 0 0 0 9 0 9 9 0 0 0 .95 4.97l3 2.33C4.66 5.17 6.65 3.58 9 3.58z"
        fill="#EA4335"
      />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
      <path d="M13.66 9.46c-.02-2.07 1.69-3.06 1.77-3.11-.96-1.4-2.46-1.59-2.99-1.61-1.27-.13-2.48.75-3.13.75-.65 0-1.65-.73-2.71-.71-1.39.02-2.68.81-3.4 2.06-1.45 2.52-.37 6.24 1.04 8.28.69.99 1.5 2.11 2.56 2.07 1.03-.04 1.42-.66 2.66-.66 1.24 0 1.59.66 2.68.64 1.11-.02 1.81-1.01 2.49-2 .79-1.15 1.12-2.27 1.13-2.33-.02-.01-2.17-.83-2.2-3.28zM11.71 3.42c.57-.69.95-1.65.85-2.6-.82.03-1.81.55-2.4 1.24-.53.61-.99 1.59-.87 2.53.91.07 1.85-.46 2.42-1.17z" />
    </svg>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
  placeholder,
  autoComplete,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required
        className="w-full rounded-2xl border border-line bg-paper-card px-4 py-3.5 text-base text-ink placeholder:text-muted focus:border-ink focus:outline-none"
      />
    </label>
  );
}
