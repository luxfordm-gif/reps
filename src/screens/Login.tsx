import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Logo } from '../components/Logo';

export function Login() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setInfo('Check your email to confirm your account, then sign in.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-5">
        <div className="flex flex-1 flex-col justify-center">
          <Logo className="h-16 w-auto self-start" />

          <h1 className="mt-10 text-[32px] font-bold leading-tight tracking-tight text-ink">
            {mode === 'signin' ? 'Welcome back.' : 'Create your account.'}
          </h1>
          <p className="mt-1.5 text-base text-muted">
            {mode === 'signin'
              ? 'Sign in to continue your training.'
              : "Let's get you set up."}
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-3">
            <Field
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              placeholder="you@example.com"
              autoComplete="email"
            />
            <Field
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              placeholder="••••••••"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            />

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
              {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <button
            onClick={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin');
              setError(null);
              setInfo(null);
            }}
            className="mt-6 w-full text-center text-sm text-muted"
          >
            {mode === 'signin' ? (
              <>
                New here? <span className="font-semibold text-ink">Create an account</span>
              </>
            ) : (
              <>
                Already have an account? <span className="font-semibold text-ink">Sign in</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
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
