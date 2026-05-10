import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import {
  logSet,
  getSessionSets,
  getLastSessionSetsForExercise,
  type LoggedSet,
} from '../lib/sessionsApi';
import { parseSetMods } from '../lib/parseSetMods';
import type { PlanExerciseRow } from '../lib/plansApi';

interface Props {
  sessionId: string;
  exercise: PlanExerciseRow;
  hasNext: boolean;
  hasPrev: boolean;
  totalExercises: number;
  exerciseIndex: number;
  onBack: () => void;
  onPrev: () => void;
  onNext: () => void;
  onFinish: () => void;
}

interface SetState {
  setIndex: number;
  dropIndex: number; // 0 = main, 1+ = drop
  weight: string;
  reps: string;
  weightSuggested: string;
  repsSuggested: string;
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
  lastSets: LoggedSet[]
): SetState[] {
  const target = parseTargetReps(repRange);
  const targetStr = target != null ? String(target) : '';
  return Array.from({ length: Math.max(1, totalSets) }, (_, i) => {
    const last = lastSets.find((s) => s.set_index === i + 1);
    const weightSuggested = last?.weight != null ? String(last.weight) : '';
    const repsSuggested =
      last?.reps != null ? String(last.reps) : targetStr;
    return {
      setIndex: i + 1,
      weight: weightSuggested,
      reps: repsSuggested,
      weightSuggested,
      repsSuggested,
      completed: false,
    };
  });
}

function googleImagesUrl(name: string): string {
  return `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(name + ' gym machine')}`;
}

export function ExerciseLogger({
  sessionId,
  exercise,
  hasNext,
  hasPrev,
  totalExercises,
  exerciseIndex,
  onBack,
  onPrev,
  onNext,
  onFinish,
}: Props) {
  const [sets, setSets] = useState<SetState[]>([]);
  const [lastSets, setLastSets] = useState<LoggedSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [notesOpen, setNotesOpen] = useState(false);
  const [savingIdx, setSavingIdx] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  // Tick for rest timer
  useEffect(() => {
    if (restEndsAt == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
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

  async function handleComplete(idx: number) {
    const set = sets[idx];
    const weightNum = set.weight ? parseFloat(set.weight) : null;
    const repsNum = set.reps ? parseInt(set.reps, 10) : null;
    if ((weightNum == null || Number.isNaN(weightNum)) && (repsNum == null || Number.isNaN(repsNum))) {
      setError('Enter a weight or reps');
      return;
    }
    setError(null);
    setSavingIdx(idx);
    try {
      await logSet({
        sessionId,
        planExerciseId: exercise.id,
        exerciseDisplayName: exercise.name,
        exerciseNormalizedName: exercise.normalized_name,
        setIndex: set.setIndex,
        dropIndex: set.dropIndex,
        weight: weightNum,
        reps: repsNum,
      });
      update(idx, { completed: true });
      // Auto-advance
      const nextIdx = sets.findIndex((s, i) => i > idx && !s.completed);
      if (nextIdx !== -1) setActiveIndex(nextIdx);
      // Rest timer only when stepping into a NEW set group (not within drops of the same set)
      const next = sets[idx + 1];
      const isLastInGroup = !next || next.setIndex !== set.setIndex;
      if (isLastInGroup) {
        setRestEndsAt(Date.now() + restSeconds * 1000);
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

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <div className="text-sm text-muted">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper pb-28">
      <div className="mx-auto max-w-md px-5 pt-6">
        <PageHeader
          title={`${exerciseIndex + 1} / ${totalExercises}`}
          onBack={hasPrev ? onPrev : onBack}
          rightAction={
            hasNext ? (
              <button
                onClick={onNext}
                className="flex items-center gap-0.5 pr-1 text-sm font-medium text-muted active:text-ink"
              >
                Skip
                <ChevronSmall />
              </button>
            ) : null
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
            className="text-[24px] font-bold leading-tight tracking-tight text-ink underline-offset-2 active:underline"
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
                onChange={update}
                onComplete={handleComplete}
              />
            ));
          })()}
        </div>

        {error && <div className="mt-3 text-sm text-red-700">{error}</div>}

        {restActive && (
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
        {!restActive && (
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
  onChange,
  onComplete,
}: {
  rows: { row: SetState; idx: number }[];
  activeIndex: number;
  savingIdx: number | null;
  onChange: (idx: number, patch: Partial<SetState>) => void;
  onComplete: (idx: number) => void;
}) {
  const setIndex = rows[0].row.setIndex;
  const hasDrops = rows.some((r) => r.row.dropIndex > 0);
  return (
    <div className="overflow-hidden rounded-2xl bg-paper-card shadow-card">
      {rows.map(({ row, idx }, ri) => {
        const isMain = row.dropIndex === 0;
        const isActive = !row.completed && idx === activeIndex;
        const isLastInGroup = ri === rows.length - 1;
        return (
          <div
            key={idx}
            className={`relative flex items-center gap-3 px-3 py-3 transition-colors ${
              !isMain ? 'pl-9 bg-line/30' : ''
            } ${row.completed ? 'opacity-70' : ''} ${
              isActive ? 'ring-1 ring-inset ring-ink rounded-2xl' : ''
            } ${!isLastInGroup ? 'border-b border-line/60' : ''}`}
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
              value={row.reps}
              disabled={row.completed}
              onChange={(e) => onChange(idx, { reps: e.target.value })}
              placeholder="reps"
              className={`w-16 rounded-xl border border-line bg-paper px-3 py-2 text-base font-semibold focus:border-ink focus:outline-none disabled:bg-line/40 ${
                row.reps === row.repsSuggested && row.repsSuggested !== ''
                  ? 'text-ink/40'
                  : 'text-ink'
              }`}
            />
            <div className="flex-1" />
            {row.completed ? (
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-white">
                <Check />
              </div>
            ) : (
              <button
                onClick={() => onComplete(idx)}
                disabled={savingIdx === idx}
                className="rounded-pill bg-ink px-4 py-2 text-xs font-semibold text-white active:opacity-80 disabled:opacity-50"
              >
                {savingIdx === idx ? '…' : 'Done'}
              </button>
            )}
          </div>
        );
      })}
      {hasDrops && (
        <div className="border-t border-line/60 bg-line/30 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
          Dropset · no rest between drops
        </div>
      )}
    </div>
  );
}

// Legacy single-row component, kept in case it's still referenced.
function _SetRow({
  index,
  set,
  isActive,
  saving,
  onChange,
  onComplete,
}: {
  index: number;
  set: SetState;
  isActive: boolean;
  saving: boolean;
  onChange: (patch: Partial<SetState>) => void;
  onComplete: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-2xl px-3 py-3 transition-colors ${
        set.completed
          ? 'bg-paper-card opacity-70 shadow-card'
          : isActive
            ? 'bg-paper-card shadow-card ring-1 ring-ink'
            : 'bg-paper-card shadow-card'
      }`}
    >
      <div className="w-12 text-xs font-semibold uppercase tracking-wider text-muted">
        Set {index + 1}
      </div>
      <input
        type="number"
        inputMode="decimal"
        step="0.5"
        value={set.weight}
        disabled={set.completed}
        onChange={(e) => onChange({ weight: e.target.value })}
        placeholder="kg"
        className={`w-20 rounded-xl border border-line bg-paper px-3 py-2 text-base font-semibold focus:border-ink focus:outline-none disabled:bg-line/40 ${
          set.weight !== '' && set.weight === set.weightSuggested && !set.completed
            ? 'text-ink/35'
            : 'text-ink'
        }`}
      />
      <span className="text-xs text-muted">×</span>
      <input
        type="number"
        inputMode="numeric"
        value={set.reps}
        disabled={set.completed}
        onChange={(e) => onChange({ reps: e.target.value })}
        placeholder="reps"
        className={`w-16 rounded-xl border border-line bg-paper px-3 py-2 text-base font-semibold focus:border-ink focus:outline-none disabled:bg-line/40 ${
          set.reps !== '' && set.reps === set.repsSuggested && !set.completed
            ? 'text-ink/35'
            : 'text-ink'
        }`}
      />
      <div className="flex-1" />
      {set.completed ? (
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-white">
          <Check />
        </div>
      ) : (
        <button
          onClick={onComplete}
          disabled={saving}
          className="rounded-pill bg-ink px-4 py-2 text-xs font-semibold text-white active:opacity-80 disabled:opacity-50"
        >
          {saving ? '…' : 'Done'}
        </button>
      )}
    </div>
  );
}

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
  const volumeDelta = totalVolume - lastVolume;
  const volumePct = lastVolume > 0 ? Math.round((volumeDelta / lastVolume) * 100) : null;

  const repPRs: string[] = [];
  for (const s of sets) {
    const last = lastSets.find((l) => l.set_index === s.setIndex);
    const reps = parseInt(s.reps, 10) || 0;
    if (last && last.reps != null && reps > last.reps) {
      repPRs.push(`+${reps - last.reps} rep${reps - last.reps === 1 ? '' : 's'} on set ${s.setIndex}`);
    }
  }

  const lastTop = Math.max(...lastSets.map((l) => l.weight ?? 0), 0);
  const thisTop = Math.max(...sets.map((s) => parseFloat(s.weight) || 0), 0);
  const matchedTop = lastTop > 0 && thisTop >= lastTop;

  return (
    <div className="mt-7 rounded-card bg-paper-card p-5 shadow-card">
      <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
        Great work
      </div>
      <div className="mt-1 text-2xl font-bold tracking-tight text-ink">
        Volume: {totalVolume.toLocaleString()}
      </div>
      {volumePct != null && (
        <div className="mt-0.5 text-sm text-muted">
          {volumeDelta >= 0 ? '+' : ''}
          {volumePct}% vs last time
        </div>
      )}
      {(repPRs.length > 0 || matchedTop) && (
        <ul className="mt-3 space-y-1.5 text-sm text-ink">
          {repPRs.map((p, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-ink" />
              {p}
            </li>
          ))}
          {matchedTop && (
            <li className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-ink" />
              Matched top set
            </li>
          )}
        </ul>
      )}
    </div>
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

function ChevronSmall({ flip }: { flip?: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      style={flip ? { transform: 'rotate(180deg)' } : undefined}
    >
      <path
        d="M6 4l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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
