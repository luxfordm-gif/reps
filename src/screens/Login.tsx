import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { hasSignedInBefore } from '../lib/returning';
import { Logo } from '../components/Logo';

type Mode = 'signin' | 'signup' | 'forgot';
type Step = 'email' | 'password';

export function Login() {
  const [mode, setMode] = useState<Mode>('signin');
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Read once on mount: has this device ever been signed in? Only then does
  // "Welcome back" mean anything.
  const [returning] = useState(hasSignedInBefore);

  function changeMode(m: Mode) {
    setMode(m);
    setStep('email');
    setError(null);
    setInfo(null);
    setPassword('');
  }

  function handleBack() {
    setError(null);
    setInfo(null);
    if (step === 'password') {
      setPassword('');
      setStep('email');
      return;
    }
    if (step === 'email' && mode === 'forgot') changeMode('signin');
  }

  function emailLooksValid() {
    return /\S+@\S+\.\S+/.test(email.trim());
  }

  function handleEmailNext(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (!emailLooksValid()) {
      setError('Please enter a valid email.');
      return;
    }
    setStep('password');
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



  const { heading, subtitle, primaryLabel } = computeHeadings(
    mode,
    step,
    email,
    returning
  );
  const showBack = step === 'password' || mode === 'forgot';

  return (
    <div className="bg-paper" style={{ minHeight: '100dvh' }}>
      <div
        className="mx-auto flex max-w-md flex-col px-5"
        style={{ minHeight: '100dvh' }}
      >
        <div
          className="flex h-11 items-center"
          style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
        >
          {showBack && (
            <button
              onClick={handleBack}
              className="pressable -ml-2 flex h-11 w-11 items-center justify-center rounded-full text-ink active:bg-surface-strong"
              aria-label="Back"
            >
              <BackIcon />
            </button>
          )}
        </div>

        {/* Anchored at the top rather than centred: a centred form re-centres
            when the keyboard takes half the viewport, and the whole page
            lurches the moment the field is tapped. Up here the field is
            already above the keyboard and nothing moves. */}
        <div
          className="flex flex-1 flex-col items-center justify-start pt-2"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 2.5rem)' }}
        >
          <Logo className="h-8 w-auto" />

          <h1 className="mt-6 text-center text-xl font-bold leading-tight tracking-tight text-ink">
            {heading}
          </h1>
          {subtitle && (
            <p className="mt-1 text-center text-sm text-muted">{subtitle}</p>
          )}

          <div className="mt-5 w-full">
            {step === 'email' && (
              <form
                onSubmit={mode === 'forgot' ? handleSubmit : handleEmailNext}
                className="space-y-3"
              >
                <Field
                  label="Email"
                  type="email"
                  value={email}
                  onChange={setEmail}
                  placeholder="you@example.com"
                  autoComplete="email"
                />
                <Messages error={error} info={info} />
                <PrimaryButton
                  type="submit"
                  busy={busy}
                  disabled={!emailLooksValid() || busy}
                >
                  {primaryLabel}
                </PrimaryButton>
              </form>
            )}

            {step === 'password' && (
              <form onSubmit={handleSubmit} className="space-y-3">
                <Field
                  label="Password"
                  type="password"
                  value={password}
                  onChange={setPassword}
                  placeholder="••••••••"
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  autoFocus
                />
                <Messages error={error} info={info} />
                <PrimaryButton
                  type="submit"
                  busy={busy}
                  disabled={!password || busy}
                >
                  {primaryLabel}
                </PrimaryButton>
                {mode === 'signin' && (
                  <button
                    type="button"
                    onClick={() => changeMode('forgot')}
                    className="block w-full pt-3 text-center text-sm text-muted active:text-ink"
                  >
                    Forgot password?
                  </button>
                )}
              </form>
            )}
          </div>

          <div className="mt-6 space-y-2 text-center text-sm text-muted">
            {mode === 'signin' && step !== 'password' && (
              <button onClick={() => changeMode('signup')} className="block w-full">
                New here?{' '}
                <span className="font-semibold text-ink">Create an account</span>
              </button>
            )}
            {mode === 'signup' && step !== 'password' && (
              <button onClick={() => changeMode('signin')} className="block w-full">
                Already have an account?{' '}
                <span className="font-semibold text-ink">Sign in</span>
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

/** What the screen says at each step. The landing step greets; the steps after
 *  it name the task, because by then you are doing it rather than arriving. */
function computeHeadings(
  mode: Mode,
  step: Step,
  email: string,
  returning: boolean
): { heading: string; subtitle: string; primaryLabel: string } {
  if (mode === 'forgot') {
    return {
      heading: 'Reset password.',
      subtitle: "We'll email you a link.",
      primaryLabel: 'Send reset link',
    };
  }
  if (mode === 'signup') {
    if (step === 'email') {
      return {
        heading: 'Create your account.',
        subtitle: "Let's get you set up.",
        primaryLabel: 'Next',
      };
    }
    return {
      heading: 'Pick a password.',
      subtitle: email,
      primaryLabel: 'Create account',
    };
  }
  // signin
  if (step === 'email') {
    // "Welcome back" is a claim about the past, so only a device that has held
    // a session gets to make it.
    return returning
      ? {
          heading: 'Welcome back.',
          subtitle: 'Enter your email to continue.',
          primaryLabel: 'Next',
        }
      : {
          heading: 'Sign in.',
          subtitle: 'Enter your email to get started.',
          primaryLabel: 'Next',
        };
  }
  return {
    heading: 'Enter your password.',
    subtitle: email,
    primaryLabel: 'Sign in',
  };
}

function Messages({ error, info }: { error: string | null; info: string | null }) {
  return (
    <>
      {error && (
        <div className="rounded-panel bg-danger-soft px-4 py-3 text-sm text-danger">{error}</div>
      )}
      {info && (
        <div className="rounded-panel bg-good-soft px-4 py-3 text-sm text-good">{info}</div>
      )}
    </>
  );
}

function PrimaryButton({
  type = 'button',
  busy,
  disabled,
  onClick,
  children,
}: {
  type?: 'button' | 'submit';
  busy: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="pressable mt-2 w-full rounded-pill bg-ink py-4 text-base font-semibold text-white transition-opacity active:opacity-80 disabled:opacity-50"
    >
      {busy ? 'Please wait…' : children}
    </button>
  );
}

// Sign-in is email and password only.
//
// There were provider buttons here for Google and Apple. Apple needs a paid
// Apple Developer Program membership; Google needs an OAuth client that hasn't
// been created. A button that can only answer "Unsupported provider" is worse
// than no button, so both are gone rather than waiting to be configured.
//
// To bring one back: restore its button, call
// supabase.auth.signInWithOAuth({ provider, options: { redirectTo: origin } }),
// and in the dashboard —
//
//   Google
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
//   1. Apple Developer → Identifiers → Services ID with "Sign In with Apple"
//      enabled. Return URL is the Supabase callback above.
//   2. Create a Key with "Sign In with Apple" enabled, download the .p8.
//   3. Supabase → Authentication → Providers → Apple: paste Services ID,
//      Team ID, Key ID, and the .p8 contents.
//
//   Either way: Supabase → Authentication → URL Configuration must allow-list
//   the production domain and http://localhost:5173/.

function BackIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path
        d="M15 5l-7 7 7 7"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
  autoFocus,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  autoFocus?: boolean;
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
        autoFocus={autoFocus}
        required
        className="w-full rounded-panel border border-line bg-paper-card px-4 py-3.5 text-base text-ink placeholder:text-muted focus:border-ink focus:outline-none"
      />
    </label>
  );
}
