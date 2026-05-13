import { useEffect, useState } from 'react';
import { getSessionNotes, updateSessionNotes } from '../lib/sessionsApi';

type Field = 'feedbackForSelf' | 'notesToCoach';

export function NotesAccordion({
  sessionId,
  field,
  title,
  hint,
  placeholder,
}: {
  sessionId: string;
  field: Field;
  title: string;
  hint: string;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSessionNotes(sessionId)
      .then((n) => {
        if (cancelled) return;
        setValue(field === 'feedbackForSelf' ? n.feedbackForSelf : n.notesToCoach);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, field]);

  async function save(next: string): Promise<boolean> {
    setSaving(true);
    setError(null);
    try {
      await updateSessionNotes(sessionId, { [field]: next });
      setSavedAt(Date.now());
      return true;
    } catch (e) {
      setError((e as Error)?.message ?? 'Save failed');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleOk(e: React.MouseEvent) {
    // Be explicit — these accordions are sometimes near full-screen CTAs, so
    // we don't want a parent form/link grabbing the click.
    e.preventDefault();
    e.stopPropagation();
    const ok = await save(value);
    if (ok) setOpen(false);
  }

  const hasContent = value.trim().length > 0;

  return (
    <div className="overflow-hidden rounded-card bg-paper-card shadow-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-4 text-left active:opacity-70"
      >
        <div>
          <div className="text-sm font-semibold text-ink">{title}</div>
          {!open && (
            <div className="mt-0.5 text-xs text-muted">
              {hasContent
                ? `${value.length} char${value.length === 1 ? '' : 's'} saved`
                : 'Tap to add notes'}
            </div>
          )}
        </div>
        <svg
          width="16"
          height="16"
          viewBox="0 0 18 18"
          fill="none"
          style={{ transform: `rotate(${open ? 90 : 0}deg)`, transition: 'transform 200ms ease' }}
        >
          <path
            d="M7 4l5 5-5 5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div className="border-t border-line/60 px-5 pb-4 pt-3">
          <p className="text-xs text-muted">{hint}</p>
          <textarea
            value={value}
            disabled={!loaded}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            rows={4}
            className="mt-3 w-full resize-y rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-ink focus:outline-none"
          />
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[11px] text-muted">
              {error ? (
                <span className="text-red-700">{error}</span>
              ) : saving ? (
                'Saving…'
              ) : savedAt ? (
                'Saved'
              ) : (
                ' '
              )}
            </span>
            <button
              type="button"
              onClick={handleOk}
              disabled={!loaded || saving}
              className="rounded-pill bg-ink px-5 py-2 text-xs font-semibold text-white active:opacity-80 disabled:opacity-40"
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
