import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Logo } from '../components/Logo';

interface Props {
  onDone: () => void;
}

export function SetNewPassword({ onDone }: Props) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError("Passwords don’t match.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      onDone();
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
            Set a new password.
          </h1>
          <p className="mt-1.5 text-base text-muted">
            Choose something you&rsquo;ll remember this time.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-3">
            <Field
              label="New password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
            />
            <Field
              label="Confirm new password"
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
            />
            {error && (
              <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={busy}
              className="mt-2 w-full rounded-pill bg-ink py-4 text-base font-semibold text-white transition-opacity active:opacity-80 disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Update password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
      </span>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        required
        className="w-full rounded-2xl border border-line bg-paper-card px-4 py-3.5 text-base text-ink focus:border-ink focus:outline-none"
      />
    </label>
  );
}
