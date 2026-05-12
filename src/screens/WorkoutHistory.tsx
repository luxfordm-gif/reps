import { useEffect, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { ConfirmModal } from '../components/ConfirmModal';
import { NotesAccordion } from '../components/NotesAccordion';
import {
  listCompletedSessions,
  deleteSession,
  getAllSessionSets,
  updateLoggedSet,
  type CompletedSessionSummary,
  type LoggedSet,
} from '../lib/sessionsApi';

interface Props {
  onBack: () => void;
}

export function WorkoutHistory({ onBack }: Props) {
  const [sessions, setSessions] = useState<CompletedSessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CompletedSessionSummary | null>(null);
  const [selected, setSelected] = useState<CompletedSessionSummary | null>(null);

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

  if (selected) {
    return <SessionDetail session={selected} onBack={() => setSelected(null)} />;
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
                  onOpen={() => setSelected(s)}
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
  onOpen,
}: {
  session: CompletedSessionSummary;
  busy: boolean;
  wobble: boolean;
  onRequestDelete: () => void;
  onOpen: () => void;
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
  function onPointerUp(e: React.PointerEvent) {
    if (startX == null) return;
    const movedX = Math.abs(e.clientX - startX);
    setStartX(null);
    setAnimating(true);
    const newDx = dx < -revealW / 2 ? -revealW : 0;
    setDx(newDx);
    if (movedX < 5 && newDx === 0 && dx > -2) {
      onOpen();
    }
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
              {session.total_exercises > 0
                ? ` · ${session.recorded_exercises} of ${session.total_exercises} exercises recorded`
                : ''}
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

function SessionDetail({
  session,
  onBack,
}: {
  session: CompletedSessionSummary;
  onBack: () => void;
}) {
  const [sets, setSets] = useState<LoggedSet[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openExercise, setOpenExercise] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAllSessionSets(session.id)
      .then((rows) => {
        if (!cancelled) setSets(rows);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message ?? 'Failed to load workout');
      });
    return () => {
      cancelled = true;
    };
  }, [session.id]);

  const dateLabel = new Date(session.completed_at).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  const groups: { name: string; sets: LoggedSet[] }[] = [];
  if (sets) {
    const order: string[] = [];
    const byName = new Map<string, LoggedSet[]>();
    for (const s of sets) {
      const arr = byName.get(s.exercise_display_name);
      if (arr) {
        arr.push(s);
      } else {
        byName.set(s.exercise_display_name, [s]);
        order.push(s.exercise_display_name);
      }
    }
    for (const name of order) {
      const list = byName.get(name)!.slice().sort((a, b) => {
        if (a.set_index !== b.set_index) return a.set_index - b.set_index;
        return a.drop_index - b.drop_index;
      });
      groups.push({ name, sets: list });
    }
  }

  function patchSet(id: string, patch: Partial<LoggedSet>) {
    setSets((prev) => (prev ? prev.map((s) => (s.id === id ? { ...s, ...patch } : s)) : prev));
  }

  return (
    <div className="min-h-screen bg-paper pb-10">
      <div className="mx-auto max-w-md px-5 pt-3">
        <PageHeader title={session.day_name} onBack={onBack} />
        <div className="mt-2 text-xs text-muted">{dateLabel}</div>

        <div className="mt-6 space-y-3">
          {error && (
            <div className="rounded-card bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          )}
          {sets == null && !error && (
            <div className="py-10 text-center text-sm text-muted">Loading…</div>
          )}
          {sets != null && sets.length === 0 && (
            <div className="py-16 text-center text-sm text-muted">No sets logged.</div>
          )}
          {groups.map((g) => (
            <ExerciseAccordion
              key={g.name}
              name={g.name}
              sets={g.sets}
              open={openExercise === g.name}
              onToggle={() => setOpenExercise((cur) => (cur === g.name ? null : g.name))}
              onPatch={patchSet}
            />
          ))}
        </div>

        {sets != null && (
          <div className="mt-6 space-y-3">
            <NotesAccordion
              sessionId={session.id}
              field="feedbackForSelf"
              title="Feedback for next time"
              hint="Private notes for you. Example: push harder on shoulders, up calf raises next week."
              placeholder="What would you do differently next time?"
            />
            <NotesAccordion
              sessionId={session.id}
              field="notesToCoach"
              title="Notes to coach"
              hint="Shared with your coach when you export this week."
              placeholder="Anything you want to flag to your coach about today's session?"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ExerciseAccordion({
  name,
  sets,
  open,
  onToggle,
  onPatch,
}: {
  name: string;
  sets: LoggedSet[];
  open: boolean;
  onToggle: () => void;
  onPatch: (id: string, patch: Partial<LoggedSet>) => void;
}) {
  return (
    <div className="overflow-hidden rounded-card bg-paper-card shadow-card">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-5 py-4 text-left active:opacity-70"
      >
        <div className="min-w-0">
          <div className="truncate text-base font-bold tracking-tight text-ink">{name}</div>
          <div className="mt-0.5 text-xs text-muted">{sets.length} sets</div>
        </div>
        <Chevron rotate={open ? 90 : 0} />
      </button>
      {open && (
        <div className="border-t border-line/60 px-5 py-3 space-y-2">
          {sets.map((s) => (
            <EditableSetRow key={s.id} set={s} onPatch={onPatch} />
          ))}
        </div>
      )}
    </div>
  );
}

function EditableSetRow({
  set,
  onPatch,
}: {
  set: LoggedSet;
  onPatch: (id: string, patch: Partial<LoggedSet>) => void;
}) {
  const [weight, setWeight] = useState<string>(set.weight != null ? String(set.weight) : '');
  const [reps, setReps] = useState<string>(set.reps != null ? String(set.reps) : '');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    weight !== (set.weight != null ? String(set.weight) : '') ||
    reps !== (set.reps != null ? String(set.reps) : '');

  async function save() {
    const w = weight ? parseFloat(weight) : null;
    const r = reps ? parseInt(reps, 10) : null;
    if (r != null && r > 100) {
      setError('Reps capped at 100');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await updateLoggedSet(set.id, { weight: w, reps: r });
      onPatch(set.id, { weight: w, reps: r });
      setSavedAt(Date.now());
      window.setTimeout(() => setSavedAt((t) => (t && Date.now() - t > 1400 ? null : t)), 1500);
    } catch (e) {
      setError((e as Error)?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const label = set.drop_index > 0 ? `Set ${set.set_index} · Drop ${set.drop_index}` : `Set ${set.set_index}`;

  return (
    <div className="flex items-center gap-2.5">
      <div className="w-20 text-xs font-semibold uppercase tracking-wider text-muted">{label}</div>
      <input
        type="number"
        inputMode="decimal"
        step="0.5"
        value={weight}
        onChange={(e) => setWeight(e.target.value)}
        onFocus={(e) => e.target.select()}
        placeholder="kg"
        className="w-20 rounded-xl border border-line bg-paper px-3 py-2 text-sm font-semibold text-ink focus:border-ink focus:outline-none"
      />
      <span className="text-xs text-muted">×</span>
      <input
        type="number"
        inputMode="numeric"
        max={100}
        value={reps}
        onChange={(e) => setReps(e.target.value)}
        onFocus={(e) => e.target.select()}
        placeholder="reps"
        className="w-16 rounded-xl border border-line bg-paper px-3 py-2 text-sm font-semibold text-ink focus:border-ink focus:outline-none"
      />
      <div className="flex-1" />
      {error ? (
        <span className="text-[11px] text-red-700">{error}</span>
      ) : savedAt ? (
        <span className="text-[11px] text-muted">Saved</span>
      ) : (
        <button
          onClick={save}
          disabled={!dirty || saving}
          className="rounded-pill bg-ink px-3 py-1.5 text-[11px] font-semibold text-white active:opacity-80 disabled:opacity-30"
        >
          {saving ? '…' : 'Save'}
        </button>
      )}
    </div>
  );
}

function Chevron({ rotate = 0 }: { rotate?: number }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 18 18"
      fill="none"
      style={{ transform: `rotate(${rotate}deg)`, transition: 'transform 200ms ease' }}
    >
      <path
        d="M7 4l5 5-5 5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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
