import { useEffect, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { ConfirmModal } from '../components/ConfirmModal';
import {
  listCompletedSessions,
  deleteSession,
  type CompletedSessionSummary,
} from '../lib/sessionsApi';

interface Props {
  onBack: () => void;
}

export function WorkoutHistory({ onBack }: Props) {
  const [sessions, setSessions] = useState<CompletedSessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CompletedSessionSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    listCompletedSessions()
      .then((rows) => {
        if (!cancelled) setSessions(rows);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message ?? 'Failed to load history');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function confirmDelete() {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setBusyId(id);
    setPendingDelete(null);
    try {
      await deleteSession(id);
      setSessions((s) => (s ? s.filter((r) => r.id !== id) : s));
    } catch (e) {
      alert((e as Error)?.message ?? 'Delete failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="min-h-screen bg-paper pb-10">
      <div className="mx-auto max-w-md px-5 pt-3">
        <PageHeader title="Workout history" onBack={onBack} />

        <div className="mt-6">
          {error && (
            <div className="rounded-card bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
          {sessions == null && !error && (
            <div className="py-10 text-center text-sm text-muted">Loading…</div>
          )}
          {sessions != null && sessions.length === 0 && (
            <div className="py-16 text-center text-sm text-muted">
              No completed workouts yet.
            </div>
          )}
          {sessions != null && sessions.length > 0 && (
            <div className="space-y-3">
              {sessions.map((s, i) => (
                <HistoryRow
                  key={s.id}
                  session={s}
                  busy={busyId === s.id}
                  wobble={i === 0}
                  onRequestDelete={() => setPendingDelete(s)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {pendingDelete && (
        <ConfirmModal
          title="Delete this workout?"
          message="This cannot be undone."
          confirmLabel="Delete"
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}

function HistoryRow({
  session,
  busy,
  wobble,
  onRequestDelete,
}: {
  session: CompletedSessionSummary;
  busy: boolean;
  wobble: boolean;
  onRequestDelete: () => void;
}) {
  const revealW = 80;
  const [dx, setDx] = useState(0);
  const [startX, setStartX] = useState<number | null>(null);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    if (!wobble) return;
    let mounted = true;
    const timers: number[] = [];
    setAnimating(true);
    timers.push(window.setTimeout(() => mounted && setDx(-revealW * 0.7), 350));
    timers.push(window.setTimeout(() => mounted && setDx(0), 900));
    timers.push(window.setTimeout(() => mounted && setAnimating(false), 1150));
    return () => {
      mounted = false;
      timers.forEach(clearTimeout);
    };
  }, [wobble]);

  function onPointerDown(e: React.PointerEvent) {
    setStartX(e.clientX);
    setAnimating(false);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (startX == null) return;
    const delta = Math.min(0, Math.max(-revealW, e.clientX - startX));
    setDx(delta);
  }
  function onPointerUp() {
    if (startX == null) return;
    setStartX(null);
    setAnimating(true);
    setDx((d) => (d < -revealW / 2 ? -revealW : 0));
  }

  const date = new Date(session.completed_at);
  const dateLabel = date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  const revealed = dx < -2;

  return (
    <div className="relative overflow-hidden rounded-card bg-paper-card shadow-card">
      {revealed && (
        <button
          onClick={onRequestDelete}
          disabled={busy}
          aria-label="Delete workout"
          className="absolute inset-y-0 right-0 flex w-20 items-center justify-center bg-red-600 text-white active:opacity-80 disabled:opacity-50"
        >
          <TrashIcon />
        </button>
      )}
      <div
        className={`relative bg-paper-card ${
          animating || startX == null ? 'transition-transform duration-300 ease-out' : ''
        }`}
        style={{ transform: `translateX(${dx}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="flex items-center justify-between px-5 py-4">
          <div className="min-w-0">
            <div className="text-base font-bold tracking-tight text-ink">
              {session.day_name}
            </div>
            <div className="mt-0.5 truncate text-xs text-muted">
              {dateLabel}
              {session.body_parts.length > 0 ? ' · ' + session.body_parts.join(' · ') : ''}
            </div>
          </div>
          <button
            onClick={onRequestDelete}
            disabled={busy}
            aria-label="Delete workout"
            className="-mr-1 flex h-9 w-9 items-center justify-center rounded-full text-muted active:bg-line/60 disabled:opacity-50"
          >
            <TrashIcon />
          </button>
        </div>
      </div>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m-8 0v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V7M10 11v6M14 11v6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
