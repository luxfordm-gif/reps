import { useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import {
  logSet,
  updateLoggedSet,
  getSessionSets,
  getLastSessionSetsForExercise,
  type LoggedSet,
} from '../lib/sessionsApi';
import { parseSetMods } from '../lib/parseSetMods';
import type { PlanExerciseRow } from '../lib/plansApi';
import BarbellCalculator from '../components/BarbellCalculator';

// Flip to false to revert to the inline rest timer (the original design).
const USE_REST_OVERLAY = true;

interface Props {
  sessionId: string;
  sessionStartedAt?: string | null;
  dayName?: string;
  exercise: PlanExerciseRow;
  hasNext: boolean;
  hasPrev: boolean;
  totalExercises: number;
  exerciseIndex: number;
  onBack: () => void;
  onPrev: () => void;
  onNext: () => void;
  onFinish: () => void;
  onOverview: () => void;
  onHome: () => void;
  onEndWorkout: () => void;
}

interface SetState {
  setIndex: number;
  dropIndex: number; // 0 = main, 1+ = drop
  weight: string;
  reps: string;
  weightSuggested: string;
  repsSuggested: string;
  repRangeLabel?: string;
  scheme?: 'dropset' | 'back_off' | 'muscle_round' | 'intensifier';
  schemeDetail?: string;
  completed: boolean;
  loggedId?: string;
}

function parseTargetReps(repRange: string): number | null {
  const m = repRange.match(/^(\d+)\s*-\s*(\d+)$/);
  if (m) return parseInt(m[2], 10);
  const s = repRange.match(/^(\d+)$/);
  if (s) return parseInt(s[1], 10);
  return null;
}

function buildInitialSets(
  totalSets: number,
  repRange: string,
  lastSets: LoggedSet[],
  notes: string
): SetState[] {
  const baseTarget = parseTargetReps(repRange);
  const baseTargetStr = baseTarget != null ? String(baseTarget) : '';
  const mods = parseSetMods(notes, Math.max(1, totalSets));
  const intensifier = parseIntensifier(notes);
  const rows: SetState[] = [];
  for (let i = 0; i < Math.max(1, totalSets); i++) {
    const setIndex = i + 1;
    const mod = mods.bySetIndex.get(setIndex);
    const targetStr =
      mod?.repTarget != null ? String(mod.repTarget) : baseTargetStr;
    // Main set
    const mainLast = lastSets.find((s) => s.set_index === setIndex && s.drop_index === 0);
    const mainWeightSugg = mainLast?.weight != null ? String(mainLast.weight) : '';
    const mainRepsSugg =
      mainLast?.reps != null ? String(mainLast.reps) : targetStr;
    rows.push({
      setIndex,
      dropIndex: 0,
      weight: mainWeightSugg,
      reps: mainRepsSugg,
      weightSuggested: mainWeightSugg,
      repsSuggested: mainRepsSugg,
      repRangeLabel: mod?.repRangeOverride,
      scheme: mod?.scheme,
      schemeDetail: mod?.schemeDetail,
      completed: false,
    });
    // Drops (from coach-note modifiers)
    if (mod && mod.drops.length > 0) {
      mod.drops.forEach((drop, di) => {
        const dropIndex = di + 1;
        const dropLast = lastSets.find(
          (s) => s.set_index === setIndex && s.drop_index === dropIndex
        );
        const wSugg = dropLast?.weight != null ? String(dropLast.weight) : '';
        const rSugg =
          dropLast?.reps != null
            ? String(dropLast.reps)
            : drop.repTarget != null
              ? String(drop.repTarget)
              : '';
        rows.push({
          setIndex,
          dropIndex,
          weight: wSugg,
          reps: rSugg,
          weightSuggested: wSugg,
          repsSuggested: rSugg,
          completed: false,
        });
      });
    }
  }

  // If the coach notes describe a dumbbell intensifier on the last set,
  // replace that set's row(s) with one editable row per pyramid weight×reps.
  if (intensifier && rows.length > 0) {
    const lastSetIndex = rows[rows.length - 1].setIndex;
    const without = rows.filter((r) => r.setIndex !== lastSetIndex);
    intensifier.forEach((p, i) => {
      const dropIndex = i; // first = main (0), rest = drops 1..N
      const last = lastSets.find(
        (s) => s.set_index === lastSetIndex && s.drop_index === dropIndex
      );
      const w = last?.weight != null ? String(last.weight) : String(p.weight);
      const r = last?.reps != null ? String(last.reps) : String(p.reps);
      without.push({
        setIndex: lastSetIndex,
        dropIndex,
        weight: w,
        reps: r,
        weightSuggested: w,
        repsSuggested: r,
        completed: false,
        scheme: dropIndex === 0 ? 'intensifier' : undefined,
      });
    });
    return without;
  }

  return rows;
}

function googleImagesUrl(name: string): string {
  return `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(name + ' gym machine')}`;
}

export function ExerciseLogger({
  sessionId,
  sessionStartedAt,
  dayName,
  exercise,
  hasNext,
  hasPrev,
  totalExercises,
  exerciseIndex,
  onBack,
  onPrev,
  onNext,
  onFinish,
  onOverview,
  onHome,
  onEndWorkout,
}: Props) {
  const [sets, setSets] = useState<SetState[]>([]);
  const [lastSets, setLastSets] = useState<LoggedSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [notesOpen, setNotesOpen] = useState(false);
  const [savingIdx, setSavingIdx] = useState<number | null>(null);
  const [shakeIdx, setShakeIdx] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [calcOpen, setCalcOpen] = useState<number | null>(null);
  const [restEndsAt, setRestEndsAt] = useState<number | null>(null);
  const [restSeconds, setRestSecondsState] = useState<number>(() => {
    if (typeof window === 'undefined') return 60;
    const v = window.localStorage.getItem('reps.restSeconds');
    const n = v ? parseInt(v, 10) : 60;
    return [30, 60, 90, 120, 180].includes(n) ? n : 60;
  });
  const [, setNow] = useState(Date.now());

  function setRestSeconds(s: number) {
    setRestSecondsState(s);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('reps.restSeconds', String(s));
    }
  }

  // Keep screen on while resting
  useEffect(() => {
    if (restEndsAt == null) return;
    type WakeLockSentinel = { release: () => Promise<void> };
    type WakeLockNav = Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinel> };
    };
    const nav = navigator as WakeLockNav;
    if (!nav.wakeLock) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    async function acquire() {
      try {
        const s = await nav.wakeLock!.request('screen');
        if (cancelled) {
          s.release().catch(() => {});
          return;
        }
        sentinel = s;
      } catch {
        // Permission denied or unsupported — silently ignore.
      }
    }
    acquire();

    function onVisibility() {
      if (document.visibilityState === 'visible' && !sentinel && !cancelled) {
        acquire();
      }
    }
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (sentinel) {
        sentinel.release().catch(() => {});
        sentinel = null;
      }
    };
  }, [restEndsAt]);

  // Tick for rest timer
  useEffect(() => {
    if (restEndsAt == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    const remaining = restEndsAt - Date.now();
    const fireAt = Math.max(0, remaining);
    const buzz = window.setTimeout(() => {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try {
          navigator.vibrate(25);
        } catch {
          // ignore
        }
      }
    }, fireAt);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(buzz);
    };
  }, [restEndsAt]);

  // Load existing sets for this exercise + last session's sets
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    Promise.all([
      getSessionSets(sessionId, exercise.id),
      getLastSessionSetsForExercise(exercise.normalized_name, sessionId),
    ])
      .then(([existing, last]) => {
        if (!mounted) return;
        setLastSets(last);
        const initial = buildInitialSets(
          exercise.total_sets ?? 1,
          exercise.rep_range,
          last,
          exercise.notes ?? ''
        );
        // Mark as completed any rows already logged in this session
        for (const s of existing) {
          const idx = initial.findIndex(
            (x) => x.setIndex === s.set_index && x.dropIndex === s.drop_index
          );
          if (idx >= 0) {
            initial[idx] = {
              ...initial[idx],
              weight: s.weight != null ? String(s.weight) : initial[idx].weight,
              reps: s.reps != null ? String(s.reps) : initial[idx].reps,
              completed: true,
              loggedId: s.id,
            };
          }
        }
        setSets(initial);
        const firstIncomplete = initial.findIndex((s) => !s.completed);
        setActiveIndex(firstIncomplete === -1 ? initial.length - 1 : firstIncomplete);
      })
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, [
    sessionId,
    exercise.id,
    exercise.normalized_name,
    exercise.total_sets,
    exercise.rep_range,
    exercise.notes,
  ]);

  const targetSets = exercise.total_sets ?? sets.length;
  const allDone = sets.length > 0 && sets.every((s) => s.completed);

  function update(idx: number, patch: Partial<SetState>) {
    setSets((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }

  function triggerShake(idx: number) {
    setShakeIdx(idx);
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate([40, 30, 40]);
      } catch {
        // ignore
      }
    }
    window.setTimeout(() => setShakeIdx((cur) => (cur === idx ? null : cur)), 380);
  }

  function handleEdit(idx: number) {
    setError(null);
    setRestEndsAt(null);
    update(idx, { completed: false });
    setActiveIndex(idx);
  }

  async function handleComplete(idx: number) {
    const set = sets[idx];
    const weightStr = set.weight.trim();
    const repsStr = set.reps.trim();
    const weightNum = weightStr === '' ? NaN : parseFloat(weightStr);
    const repsNum = repsStr === '' ? NaN : parseInt(repsStr, 10);
    if (weightStr === '' || repsStr === '' || Number.isNaN(weightNum) || Number.isNaN(repsNum)) {
      setError('Enter both weight and reps (use 0 kg for body weight)');
      triggerShake(idx);
      return;
    }
    if (repsNum > 100) {
      setError('Reps capped at 100 — check the number');
      triggerShake(idx);
      return;
    }
    setError(null);
    setSavingIdx(idx);
    const isEdit = !!set.loggedId;
    try {
      if (set.loggedId) {
        await updateLoggedSet(set.loggedId, { weight: weightNum, reps: repsNum });
        update(idx, { completed: true });
      } else {
        const logged = await logSet({
          sessionId,
          planExerciseId: exercise.id,
          exerciseDisplayName: exercise.name,
          exerciseNormalizedName: exercise.normalized_name,
          setIndex: set.setIndex,
          dropIndex: set.dropIndex,
          weight: weightNum,
          reps: repsNum,
        });
        update(idx, { completed: true, loggedId: logged.id });
      }
      if (!isEdit) {
        // Auto-advance
        const nextIdx = sets.findIndex((s, i) => i > idx && !s.completed);
        if (nextIdx !== -1) setActiveIndex(nextIdx);
        // Rest timer only when stepping into a NEW set group (not within drops of
        // the same set) AND only when there is a next set still to do.
        const next = sets[idx + 1];
        const isLastInGroup = !next || next.setIndex !== set.setIndex;
        const hasMoreToDo = sets.some((s, i) => i !== idx && !s.completed);
        if (isLastInGroup && hasMoreToDo && set.scheme !== 'intensifier') {
          setRestEndsAt(Date.now() + restSeconds * 1000);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to log set');
    } finally {
      setSavingIdx(null);
    }
  }

  const lastTopSet = useMemo(() => {
    if (lastSets.length === 0) return null;
    return [...lastSets].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))[0];
  }, [lastSets]);

  const totalVolume = useMemo(
    () => sets.reduce((sum, s) => sum + (parseFloat(s.weight) || 0) * (parseInt(s.reps, 10) || 0), 0),
    [sets]
  );

  const lastVolume = useMemo(
    () => lastSets.reduce((sum, s) => sum + (s.weight ?? 0) * (s.reps ?? 0), 0),
    [lastSets]
  );

  const restRemainingMs = restEndsAt ? Math.max(0, restEndsAt - Date.now()) : 0;
  const restActive = restEndsAt != null && restRemainingMs > 0;

  const nextSet = sets.find((s) => !s.completed) ?? null;
  const nextSetLastMatch = nextSet
    ? lastSets.find((l) => l.set_index === nextSet.setIndex && l.drop_index === nextSet.dropIndex) ?? null
    : null;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <div className="text-sm text-muted">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper pb-28">
      <div className="mx-auto max-w-md px-5 pt-3">
        <PageHeader
          title={`${exerciseIndex + 1} / ${totalExercises}`}
          onBack={hasPrev ? onPrev : onBack}
          rightAction={
            <ExerciseMenu
              hasNext={hasNext}
              onSkip={onNext}
              onOverview={onOverview}
              onHome={onHome}
              onEndWorkout={onEndWorkout}
            />
          }
        />

        <WorkoutProgressBar
          value={
            totalExercises > 0
              ? (exerciseIndex +
                  (sets.length > 0 ? sets.filter((s) => s.completed).length / sets.length : 0)) /
                totalExercises
              : 0
          }
        />

        <div className="mt-7">
          <a
            href={googleImagesUrl(exercise.name)}
            target="_blank"
            rel="noopener noreferrer"
            className="block break-words text-[24px] font-bold leading-tight tracking-tight text-ink underline-offset-2 active:underline"
            style={{ textWrap: 'balance' } as React.CSSProperties}
          >
            {exercise.name}
          </a>
          <div className="mt-1 text-sm text-muted">{exercise.body_part}</div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3">
          <Stat label="Target sets" value={String(targetSets)} />
          <Stat label="Rep range" value={exercise.rep_range} />
          <Stat
            label="Tempo"
            value={exercise.tempo ? exercise.tempo.replace(/-/g, '·') : '–'}
            mono
          />
        </div>

        {lastSets.length > 0 && lastTopSet && (
          <div className="mt-4 flex items-center justify-between rounded-xl bg-paper-card px-3.5 py-2.5 shadow-card">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
              Last time
            </span>
            <span className="text-xs font-medium text-ink">
              {lastSets.length} sets · top{' '}
              {lastTopSet.weight != null ? `${lastTopSet.weight} kg` : '–'} ×{' '}
              {lastTopSet.reps ?? '–'}
            </span>
          </div>
        )}

        <div className="mt-6 space-y-3">
          {(() => {
            const groups: { setIndex: number; rows: { row: SetState; idx: number }[] }[] = [];
            sets.forEach((s, i) => {
              const last = groups[groups.length - 1];
              if (last && last.setIndex === s.setIndex) {
                last.rows.push({ row: s, idx: i });
              } else {
                groups.push({ setIndex: s.setIndex, rows: [{ row: s, idx: i }] });
              }
            });
            return groups.map((group) => (
              <SetGroup
                key={group.setIndex}
                rows={group.rows}
                activeIndex={activeIndex}
                savingIdx={savingIdx}
                shakeIdx={shakeIdx}
                onChange={update}
                onComplete={handleComplete}
                onEdit={handleEdit}
                onOpenCalculator={(idx) => setCalcOpen(idx)}
              />
            ));
          })()}
        </div>

        {error && <div className="mt-3 text-sm text-red-700">{error}</div>}

        {!USE_REST_OVERLAY && restActive && (
          <div className="mt-6">
            <RestTimer
              remainingMs={restRemainingMs}
              totalMs={restSeconds * 1000}
              onSkip={() => setRestEndsAt(null)}
              onAdd={() => setRestEndsAt((t) => (t ?? Date.now()) + 15000)}
            />
            <div className="mt-4 flex justify-center">
              <RestPicker value={restSeconds} onChange={setRestSeconds} />
            </div>
          </div>
        )}
        {!USE_REST_OVERLAY && !restActive && (
          <div className="mt-5 flex items-center justify-center">
            <RestPicker value={restSeconds} onChange={setRestSeconds} compact />
          </div>
        )}

        {exercise.notes && (
          <div className="mt-7 border-t border-line">
            <button
              onClick={() => setNotesOpen((v) => !v)}
              className="flex w-full items-center justify-between py-4 text-left active:opacity-60"
            >
              <span className="flex items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.12em] text-ink">
                <NotesIcon />
                Coach notes
              </span>
              <Chevron rotate={notesOpen ? 90 : 0} />
            </button>
            {notesOpen && (
              <div className="pb-4 text-sm leading-relaxed text-ink">
                {exercise.notes}
              </div>
            )}
          </div>
        )}

        {allDone && (
          <Improvements
            totalVolume={totalVolume}
            lastVolume={lastVolume}
            sets={sets}
            lastSets={lastSets}
          />
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper/95 px-5 py-4 backdrop-blur">
        <div className="mx-auto max-w-md">
          {hasNext ? (
            <button
              onClick={onNext}
              disabled={!allDone}
              className="w-full rounded-pill bg-ink py-4 text-base font-semibold text-white active:opacity-80 disabled:opacity-40"
            >
              Next exercise
            </button>
          ) : (
            <button
              onClick={onFinish}
              disabled={!allDone}
              className="w-full rounded-pill bg-ink py-4 text-base font-semibold text-white active:opacity-80 disabled:opacity-40"
            >
              Finish workout
            </button>
          )}
        </div>
      </div>

      {USE_REST_OVERLAY && restActive && (
        <RestOverlay
          dayName={dayName ?? exercise.body_part ?? 'Rest'}
          sessionStartedAt={sessionStartedAt ?? null}
          remainingMs={restRemainingMs}
          totalMs={restSeconds * 1000}
          restSeconds={restSeconds}
          onSetRestSeconds={setRestSeconds}
          onAdd={() => setRestEndsAt((t) => (t ?? Date.now()) + 15000)}
          onSubtract={() =>
            setRestEndsAt((t) => {
              if (t == null) return t;
              const next = t - 15000;
              return next <= Date.now() ? null : next;
            })
          }
          onSkip={() => setRestEndsAt(null)}
          nextSetName={nextSet ? exercise.name : null}
          nextSetWeight={nextSet?.weight ?? ''}
          nextSetReps={nextSet?.reps ?? ''}
          lastSetWeight={nextSetLastMatch?.weight ?? null}
          lastSetReps={nextSetLastMatch?.reps ?? null}
        />
      )}

      <BarbellCalculator
        open={calcOpen !== null}
        initialKg={calcOpen !== null ? Number(sets[calcOpen]?.weight) || undefined : undefined}
        onClose={() => setCalcOpen(null)}
        onConfirm={(kg) => {
          if (calcOpen !== null) update(calcOpen, { weight: String(kg) });
        }}
      />
    </div>
  );
}

function ExerciseMenu({
  hasNext,
  onSkip,
  onOverview,
  onHome,
  onEndWorkout,
}: {
  hasNext: boolean;
  onSkip: () => void;
  onOverview: () => void;
  onHome: () => void;
  onEndWorkout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  function pick(fn: () => void) {
    setOpen(false);
    fn();
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="More options"
        className="flex h-11 w-11 items-center justify-center rounded-full text-ink active:bg-line/60"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <circle cx="5" cy="12" r="1.6" fill="currentColor" />
          <circle cx="12" cy="12" r="1.6" fill="currentColor" />
          <circle cx="19" cy="12" r="1.6" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-40 w-52 overflow-hidden rounded-card border border-line bg-paper-card shadow-card">
          {hasNext && (
            <button
              onClick={() => pick(onSkip)}
              className="block w-full px-4 py-3 text-left text-sm font-semibold text-ink active:bg-line/40"
            >
              Skip exercise
            </button>
          )}
          {hasNext && <div className="border-t border-line/60" />}
          <button
            onClick={() => pick(onOverview)}
            className="block w-full px-4 py-3 text-left text-sm font-semibold text-ink active:bg-line/40"
          >
            Back to overview
          </button>
          <div className="border-t border-line/60" />
          <button
            onClick={() => pick(onHome)}
            className="block w-full px-4 py-3 text-left text-sm font-semibold text-ink active:bg-line/40"
          >
            Back to home
          </button>
          <div className="border-t border-line/60" />
          <button
            onClick={() => pick(onEndWorkout)}
            className="block w-full px-4 py-3 text-left text-sm font-semibold text-red-600 active:bg-red-50"
          >
            End workout
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
  compact,
}: {
  label: string;
  value: string;
  mono?: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl bg-paper-card ${compact ? 'p-2' : 'p-3'} text-center shadow-card`}
    >
      <div className={`text-[10px] font-semibold uppercase tracking-wider text-muted`}>
        {label}
      </div>
      <div
        className={`mt-1 ${mono ? 'font-mono' : ''} text-lg font-bold tracking-tight text-ink`}
      >
        {value}
      </div>
    </div>
  );
}

function SetGroup({
  rows,
  activeIndex,
  savingIdx,
  shakeIdx,
  onChange,
  onComplete,
  onEdit,
  onOpenCalculator,
}: {
  rows: { row: SetState; idx: number }[];
  activeIndex: number;
  savingIdx: number | null;
  shakeIdx: number | null;
  onChange: (idx: number, patch: Partial<SetState>) => void;
  onComplete: (idx: number) => void;
  onEdit: (idx: number) => void;
  onOpenCalculator: (idx: number) => void;
}) {
  const setIndex = rows[0].row.setIndex;
  const mainRow = rows[0].row;
  const hasDrops = rows.some((r) => r.row.dropIndex > 0);
  const scheme = mainRow.scheme;
  const schemeDetail = mainRow.schemeDetail;
  const footerLabel =
    scheme === 'intensifier'
      ? 'Dumbbell intensifier · work down and back up, no rest'
      : scheme === 'muscle_round'
        ? `Muscle round${schemeDetail ? ` · ${schemeDetail}` : ''}`
        : scheme === 'dropset' || hasDrops
          ? 'Dropset · no rest between drops'
          : null;
  return (
    <div className="overflow-hidden rounded-2xl bg-paper-card shadow-card">
      {rows.map(({ row, idx }, ri) => {
        const isMain = row.dropIndex === 0;
        const isActive = !row.completed && idx === activeIndex;
        const isLastInGroup = ri === rows.length - 1;
        const shaking = shakeIdx === idx;
        const showBackOffHeader = isMain && row.scheme === 'back_off' && !!row.repRangeLabel;
        return (
          <div key={idx}>
            {showBackOffHeader && (
              <div className="px-5 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                Back off · {row.repRangeLabel}
              </div>
            )}
            <div
              className={`relative flex items-center gap-3 px-5 py-3 transition-colors ${
                !isMain ? 'pl-11 bg-line/30' : ''
              } ${row.completed ? 'opacity-70' : ''} ${
                isActive ? 'ring-1 ring-inset ring-ink rounded-2xl' : ''
              } ${!isLastInGroup ? 'border-b border-line/60' : ''} ${shaking ? 'animate-shake' : ''}`}
            >
              {!isMain && (
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-semibold uppercase tracking-wider text-muted">
                  Drop
                </div>
              )}
              <div className="w-12 text-xs font-semibold uppercase tracking-wider text-muted">
                {isMain ? `Set ${setIndex}` : ''}
              </div>
            <input
              type="number"
              inputMode="decimal"
              step="0.5"
              value={row.weight}
              disabled={row.completed}
              onChange={(e) => onChange(idx, { weight: e.target.value })}
              onFocus={(e) => {
                if (row.weight === row.weightSuggested && row.weightSuggested !== '') {
                  onChange(idx, { weight: '' });
                }
                e.target.select();
              }}
              placeholder="kg"
              className={`w-20 rounded-xl border border-line bg-paper px-3 py-2 text-base font-semibold focus:border-ink focus:outline-none disabled:bg-line/40 ${
                row.weight === row.weightSuggested && row.weightSuggested !== ''
                  ? 'text-ink/40'
                  : 'text-ink'
              }`}
            />
            <span className="text-xs text-muted">×</span>
            <input
              type="number"
              inputMode="numeric"
              max={100}
              value={row.reps}
              disabled={row.completed}
              onChange={(e) => onChange(idx, { reps: e.target.value })}
              onFocus={(e) => {
                if (row.reps === row.repsSuggested && row.repsSuggested !== '') {
                  onChange(idx, { reps: '' });
                }
                e.target.select();
              }}
              placeholder="reps"
              className={`w-16 rounded-xl border border-line bg-paper px-3 py-2 text-base font-semibold focus:border-ink focus:outline-none disabled:bg-line/40 ${
                row.reps === row.repsSuggested && row.repsSuggested !== ''
                  ? 'text-ink/40'
                  : 'text-ink'
              }`}
            />
            <div className="flex-1" />
            {row.completed ? (
              <button
                onClick={() => onEdit(idx)}
                aria-label="Edit set"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-white active:opacity-70"
              >
                <Check />
              </button>
            ) : (
              <>
                <button
                  onClick={() => onOpenCalculator(idx)}
                  aria-label="Open barbell calculator"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-ink active:opacity-70"
                >
                  <PlateIcon />
                </button>
                <button
                  onClick={() => onComplete(idx)}
                  disabled={savingIdx === idx}
                  className="rounded-pill bg-ink px-4 py-2 text-xs font-semibold text-white active:opacity-80 disabled:opacity-50"
                >
                  {savingIdx === idx ? '…' : 'Done'}
                </button>
              </>
            )}
            </div>
          </div>
        );
      })}
      {footerLabel && (hasDrops || scheme === 'muscle_round' || scheme === 'intensifier') && (
        <div className="border-t border-line/60 bg-line/30 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
          {footerLabel}
        </div>
      )}
    </div>
  );
}


// Original inline rest timer — preserved as a fallback in case we want to revert.
// Gated by USE_REST_OVERLAY at the top of this file.
function RestTimer({
  remainingMs,
  totalMs,
  onSkip,
  onAdd,
}: {
  remainingMs: number;
  totalMs: number;
  onSkip: () => void;
  onAdd: () => void;
}) {
  const seconds = Math.ceil(remainingMs / 1000);
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const progress = Math.min(1, Math.max(0, remainingMs / totalMs));
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - progress);

  return (
    <div className="flex items-center gap-4">
      <div className="flex flex-col">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink">
          Rest
        </span>
        <span className="mt-0.5 text-[11px] text-muted">Next set in</span>
      </div>
      <div className="relative">
        <svg width="120" height="120" viewBox="0 0 120 120">
          <defs>
            <linearGradient id="restRingGradient" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#0A0A0A" />
              <stop offset="100%" stopColor="#4A4A4A" />
            </linearGradient>
          </defs>
          <circle cx="60" cy="60" r={radius} stroke="#E5E5EA" strokeWidth="5" fill="none" />
          <circle
            cx="60"
            cy="60"
            r={radius}
            stroke="url(#restRingGradient)"
            strokeWidth="5"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform="rotate(-90 60 60)"
            style={{ transition: 'stroke-dashoffset 250ms linear' }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="font-mono text-xl font-bold tabular-nums text-ink">
            {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <button
          onClick={onSkip}
          className="rounded-pill bg-ink px-4 py-1.5 text-xs font-semibold text-white active:opacity-80"
        >
          Skip
        </button>
        <button
          onClick={onAdd}
          className="rounded-pill border border-line bg-paper-card px-4 py-1.5 text-xs font-semibold text-ink active:opacity-80"
        >
          +15s
        </button>
      </div>
    </div>
  );
}

function RestOverlay({
  dayName,
  sessionStartedAt,
  remainingMs,
  totalMs,
  restSeconds,
  onSetRestSeconds,
  onAdd,
  onSubtract,
  onSkip,
  nextSetName,
  nextSetWeight,
  nextSetReps,
  lastSetWeight,
  lastSetReps,
}: {
  dayName: string;
  sessionStartedAt: string | null;
  remainingMs: number;
  totalMs: number;
  restSeconds: number;
  onSetRestSeconds: (s: number) => void;
  onAdd: () => void;
  onSubtract: () => void;
  onSkip: () => void;
  nextSetName: string | null;
  nextSetWeight: string;
  nextSetReps: string;
  lastSetWeight: number | null;
  lastSetReps: number | null;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!sessionStartedAt) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [sessionStartedAt]);

  const seconds = Math.ceil(remainingMs / 1000);
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const progress = Math.min(1, Math.max(0, remainingMs / totalMs));
  const radius = 130;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - progress);

  const elapsed = sessionStartedAt
    ? Math.max(0, Math.floor((Date.now() - new Date(sessionStartedAt).getTime()) / 1000))
    : null;
  const elapsedLabel =
    elapsed != null
      ? `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`
      : null;

  // Unused props after layout simplification — keep variable refs so TS doesn't complain.
  void dayName;
  void lastSetWeight;
  void lastSetReps;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0A0A0A] text-white">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 pt-3">
        <div className="flex items-center justify-center py-2">
          <div className="text-base font-semibold tracking-tight">Rest</div>
        </div>

        {elapsedLabel && (
          <div className="mt-3 flex flex-col items-center">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/50">
              Workout time
            </div>
            <div className="mt-1 font-mono text-base font-semibold tabular-nums">
              {elapsedLabel}
            </div>
          </div>
        )}

        <div className="flex-1" />

        <div className="flex -translate-y-3 flex-col items-center">
          <div className="relative h-[300px] w-[300px]">
            <svg width="300" height="300" viewBox="0 0 300 300">
              <circle
                cx="150"
                cy="150"
                r={radius}
                stroke="rgba(255,255,255,0.15)"
                strokeWidth="3"
                fill="none"
              />
              <circle
                cx="150"
                cy="150"
                r={radius}
                stroke="#FFFFFF"
                strokeWidth="3"
                fill="none"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                transform="rotate(-90 150 150)"
                style={{ transition: 'stroke-dashoffset 250ms linear' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="font-mono text-[64px] font-bold leading-none tabular-nums">
                {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
              </div>
              <div className="mt-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/60">
                Until next set
              </div>
            </div>
          </div>

          {nextSetName && (
            <div className="mt-6 flex flex-col items-center">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/50">
                Next set
              </div>
              <div className="mt-1 text-lg font-bold tracking-tight">{nextSetName}</div>
              {(nextSetWeight || nextSetReps) && (
                <div className="mt-0.5 text-sm text-white/70">
                  {nextSetWeight || '–'}kg × {nextSetReps || '–'}
                </div>
              )}
            </div>
          )}

          <div className="mt-6 flex flex-col items-center">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/50">
              Default rest time
            </div>
            <div className="mt-2 flex items-center gap-2">
              {REST_OPTIONS.map((s) => {
                const active = s === restSeconds;
                return (
                  <button
                    key={s}
                    onClick={() => onSetRestSeconds(s)}
                    className={`rounded-pill px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                      active
                        ? 'bg-white text-ink'
                        : 'border border-white/30 text-white/80 active:bg-white/10'
                    }`}
                  >
                    {s} sec
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex-1" />

        <div className="flex items-start justify-around pb-[max(env(safe-area-inset-bottom),20px)] pt-6">
          <RoundAction label="Subtract 15" onClick={onSubtract}>
            <span className="text-xl font-bold leading-none">−15</span>
          </RoundAction>
          <RoundAction label="Add 15" onClick={onAdd}>
            <span className="text-xl font-bold leading-none">+15</span>
          </RoundAction>
          <RoundAction label="Skip rest" onClick={onSkip}>
            <FastForward />
          </RoundAction>
        </div>
      </div>
    </div>
  );
}

function RoundAction({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-2 active:opacity-70">
      <div className="flex h-16 w-16 items-center justify-center rounded-full border border-white/30 text-white">
        {children}
      </div>
      <div className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.14em] text-white/70">
        {label}
      </div>
    </button>
  );
}

function FastForward() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M5 5l7 7-7 7M13 5l7 7-7 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WorkoutProgressBar({ value }: { value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-line">
      <div
        className="h-full rounded-full"
        style={{
          width: `${pct}%`,
          background: 'linear-gradient(90deg, #0A0A0A 0%, #4A4A4A 100%)',
          transition: 'width 400ms ease',
        }}
      />
    </div>
  );
}

const REST_OPTIONS = [30, 60, 90, 120, 180];

function RestPicker({
  value,
  onChange,
  compact,
}: {
  value: number;
  onChange: (s: number) => void;
  compact?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {!compact && (
        <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
          Rest
        </span>
      )}
      {REST_OPTIONS.map((s) => {
        const active = s === value;
        return (
          <button
            key={s}
            onClick={() => onChange(s)}
            className={`rounded-pill px-2.5 py-1 text-[11px] font-semibold transition-colors ${
              active ? 'bg-ink text-white' : 'bg-line text-muted active:text-ink'
            }`}
          >
            {s}s
          </button>
        );
      })}
    </div>
  );
}

function Improvements({
  totalVolume,
  lastVolume,
  sets,
  lastSets,
}: {
  totalVolume: number;
  lastVolume: number;
  sets: SetState[];
  lastSets: LoggedSet[];
}) {
  // First time logging this exercise — no comparison possible.
  if (lastSets.length === 0) {
    return (
      <div className="mt-7 rounded-card bg-paper-card p-5 shadow-card">
        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
          Nice work
        </div>
        <div className="mt-1 text-lg font-bold tracking-tight text-ink">
          Baseline set — beat it next time.
        </div>
      </div>
    );
  }

  // Per-set rep improvements
  const repPRs: { setIndex: number; delta: number }[] = [];
  for (const s of sets) {
    const last = lastSets.find((l) => l.set_index === s.setIndex && l.drop_index === s.dropIndex);
    const reps = parseInt(s.reps, 10) || 0;
    if (last && last.reps != null && reps > last.reps) {
      repPRs.push({ setIndex: s.setIndex, delta: reps - last.reps });
    }
  }
  const totalExtraReps = repPRs.reduce((sum, r) => sum + r.delta, 0);

  // Top set weight comparison
  const lastTop = Math.max(...lastSets.map((l) => l.weight ?? 0), 0);
  const thisTop = Math.max(...sets.map((s) => parseFloat(s.weight) || 0), 0);
  const topDelta = thisTop - lastTop;

  // Volume
  const volumeDelta = totalVolume - lastVolume;
  const volumePct = lastVolume > 0 ? Math.round((volumeDelta / lastVolume) * 100) : null;

  // Pick the headline — prioritise the most encouraging signal.
  let headline: string;
  let detail: string | null = null;

  if (totalExtraReps > 0) {
    const setsWord = repPRs.length === 1 ? `set ${repPRs[0].setIndex}` : `${repPRs.length} sets`;
    headline = `+${totalExtraReps} rep${totalExtraReps === 1 ? '' : 's'} vs last time. Keep it up!`;
    detail = `Extra reps on ${setsWord}.`;
  } else if (topDelta > 0) {
    headline = `+${topDelta} kg on your top set. Strong work!`;
  } else if (lastTop > 0 && thisTop === lastTop) {
    headline = 'Matched your top set — momentum building.';
  } else if (volumePct != null && volumePct > 0) {
    headline = `Volume up ${volumePct}% — solid session.`;
  } else if (volumePct != null && volumePct === 0) {
    headline = 'Held the line — same as last time.';
  } else {
    headline = 'Logged. Next time, aim for one more rep.';
  }

  return (
    <div className="mt-7 rounded-card bg-paper-card p-5 shadow-card">
      <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
        Great work
      </div>
      <div className="mt-1 text-lg font-bold leading-snug tracking-tight text-ink">
        {headline}
      </div>
      {detail && <div className="mt-1 text-sm text-muted">{detail}</div>}
    </div>
  );
}

function PlateIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <rect x="2" y="11" width="20" height="2" fill="currentColor" />
      <rect x="6" y="6" width="2.5" height="12" rx="0.5" fill="currentColor" />
      <rect x="15.5" y="6" width="2.5" height="12" rx="0.5" fill="currentColor" />
    </svg>
  );
}

function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M3 7l3 3 5-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function NotesIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path
        d="M4 2.5h6l2.5 2.5v8.5a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5z M10 2.5V5h2.5 M5.5 7.5h5 M5.5 10h5 M5.5 12.5h3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function parseIntensifier(notes: string | null | undefined): { weight: number; reps: number }[] | null {
  if (!notes) return null;
  if (!/intensifier/i.test(notes)) return null;
  const re = /([\d.]+)\s*kg\s*[x×]\s*(\d+)/gi;
  const pairs: { weight: number; reps: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(notes)) !== null) {
    const weight = parseFloat(m[1]);
    const reps = parseInt(m[2], 10);
    if (!Number.isNaN(weight) && !Number.isNaN(reps)) pairs.push({ weight, reps });
  }
  return pairs.length >= 3 ? pairs : null;
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
