import { useEffect, useRef, useState } from 'react';
import { BODY_PART_OPTIONS, type ExerciseDraft } from '../lib/planRepair';

// The two editor sheets for repairing an import on the upload review screen.
// Both are plain forms: the person using them is fixing what the parser got
// wrong, and the fastest fix is a field they can type into.

interface SheetFrameProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

function SheetFrame({ title, onClose, children }: SheetFrameProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-card bg-paper-card p-6 shadow-card"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold tracking-tight text-ink">{title}</h2>
          <button
            onClick={onClose}
            className="-mr-2 flex h-9 w-9 items-center justify-center rounded-full text-muted active:bg-line/60"
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const inputClass =
  'mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-sm text-ink placeholder:text-muted focus:border-ink focus:outline-none';
const labelClass = 'block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted';

// --- Exercise --------------------------------------------------------------------

interface ExerciseEditorProps {
  title: string;
  initial: ExerciseDraft;
  /** Days the row can live in, and which one it's in now. */
  dayOptions: { idx: number; name: string }[];
  dayIdx: number;
  /** Raw text the guess came from, shown so the user can check it. */
  sourceText?: string | null;
  onSave: (draft: ExerciseDraft, dayIdx: number) => void;
  onDelete?: () => void;
  onClose: () => void;
}

export function ExerciseEditorSheet({
  title,
  initial,
  dayOptions,
  dayIdx: initialDayIdx,
  sourceText,
  onSave,
  onDelete,
  onClose,
}: ExerciseEditorProps) {
  const [draft, setDraft] = useState<ExerciseDraft>(initial);
  const [dayIdx, setDayIdx] = useState(initialDayIdx);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!initial.name) {
      const t = window.setTimeout(() => nameRef.current?.focus(), 120);
      return () => window.clearTimeout(t);
    }
  }, [initial.name]);

  const canSave = draft.name.trim().length > 0;

  function set<K extends keyof ExerciseDraft>(key: K, value: ExerciseDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  return (
    <SheetFrame title={title} onClose={onClose}>
      {sourceText && (
        <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <div className="font-semibold">From the PDF</div>
          <div className="mt-0.5 break-words font-mono text-[11px]">{sourceText}</div>
        </div>
      )}

      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) onSave(draft, dayIdx);
        }}
      >
        <label className="block">
          <span className={labelClass}>Exercise</span>
          <input
            ref={nameRef}
            type="text"
            value={draft.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="Incline bench press"
            className={inputClass}
            autoCapitalize="sentences"
          />
        </label>

        <label className="block">
          <span className={labelClass}>Body part</span>
          <input
            type="text"
            list="reps-body-parts"
            value={draft.bodyPart}
            onChange={(e) => set('bodyPart', e.target.value)}
            placeholder="Chest"
            className={inputClass}
          />
          <datalist id="reps-body-parts">
            {BODY_PART_OPTIONS.map((bp) => (
              <option key={bp} value={bp} />
            ))}
          </datalist>
        </label>

        <div className="grid grid-cols-3 gap-2">
          <label className="block">
            <span className={labelClass}>Sets</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={20}
              value={draft.totalSets ?? ''}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                set('totalSets', Number.isNaN(n) ? null : n);
              }}
              className={`${inputClass} tabular-nums`}
            />
          </label>
          <label className="block">
            <span className={labelClass}>Reps</span>
            <input
              type="text"
              inputMode="numeric"
              value={draft.repRange}
              onChange={(e) => set('repRange', e.target.value)}
              placeholder="8-10"
              className={`${inputClass} tabular-nums`}
            />
          </label>
          <label className="block">
            <span className={labelClass}>Tempo</span>
            <input
              type="text"
              inputMode="numeric"
              value={draft.tempo ?? ''}
              onChange={(e) => set('tempo', e.target.value || null)}
              placeholder="2-0-1-0"
              className={`${inputClass} tabular-nums`}
            />
          </label>
        </div>

        <label className="block">
          <span className={labelClass}>Coach notes</span>
          <textarea
            value={draft.notes}
            onChange={(e) => set('notes', e.target.value)}
            rows={3}
            placeholder="Optional — supersets, drop sets, rest, cues"
            className={`${inputClass} resize-none`}
          />
        </label>

        {dayOptions.length > 1 && (
          <label className="block">
            <span className={labelClass}>Day</span>
            <select
              value={dayIdx}
              onChange={(e) => setDayIdx(parseInt(e.target.value, 10))}
              className={inputClass}
            >
              {dayOptions.map((d) => (
                <option key={d.idx} value={d.idx}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <button
          type="submit"
          disabled={!canSave}
          className="mt-2 w-full rounded-pill bg-ink py-3.5 text-base font-semibold text-white transition-opacity active:opacity-80 disabled:opacity-40"
        >
          Save
        </button>

        {onDelete &&
          (confirmDelete ? (
            <div className="flex items-center justify-between gap-3 rounded-xl bg-red-50 px-3 py-2.5">
              <span className="text-xs text-red-700">Remove this exercise from the plan?</span>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-pill px-3 py-1.5 text-xs font-semibold text-muted"
                >
                  Keep
                </button>
                <button
                  type="button"
                  onClick={onDelete}
                  className="rounded-pill bg-red-600 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="w-full py-2 text-center text-sm font-semibold text-red-600 active:opacity-70"
            >
              Remove exercise
            </button>
          ))}
      </form>
    </SheetFrame>
  );
}

// --- Day -------------------------------------------------------------------------

interface DayEditorProps {
  title: string;
  initialName: string;
  initialWeek: number | null;
  /** Rotation weeks the plan has, e.g. [1, 2]. Empty hides the week control. */
  weekOptions: number[];
  exerciseCount: number;
  onSave: (name: string, weekIndex: number | null) => void;
  onDelete?: () => void;
  onClose: () => void;
}

export function DayEditorSheet({
  title,
  initialName,
  initialWeek,
  weekOptions,
  exerciseCount,
  onSave,
  onDelete,
  onClose,
}: DayEditorProps) {
  const [name, setName] = useState(initialName);
  const [week, setWeek] = useState<number | null>(initialWeek);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canSave = name.trim().length > 0;

  // Offer one more week than the plan has, so a two-week plan can grow a third.
  const weeks = weekOptions.length > 0 ? [...weekOptions, Math.max(...weekOptions) + 1] : [1, 2];

  return (
    <SheetFrame title={title} onClose={onClose}>
      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) onSave(name, week);
        }}
      >
        <label className="block">
          <span className={labelClass}>Day name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Push"
            className={inputClass}
            autoFocus={!initialName}
          />
        </label>

        <div>
          <span className={labelClass}>Week</span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <WeekPill active={week == null} onClick={() => setWeek(null)}>
              Every week
            </WeekPill>
            {weeks.map((w) => (
              <WeekPill key={w} active={week === w} onClick={() => setWeek(w)}>
                Week {w}
              </WeekPill>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted">
            For plans that alternate: "Legs" in week 1 and a different "Legs" in week 2.
            Every-week days run regardless.
          </p>
        </div>

        <button
          type="submit"
          disabled={!canSave}
          className="mt-2 w-full rounded-pill bg-ink py-3.5 text-base font-semibold text-white transition-opacity active:opacity-80 disabled:opacity-40"
        >
          Save
        </button>

        {onDelete &&
          (confirmDelete ? (
            <div className="flex items-center justify-between gap-3 rounded-xl bg-red-50 px-3 py-2.5">
              <span className="text-xs text-red-700">
                {exerciseCount > 0
                  ? `Remove this day and its ${exerciseCount} ${exerciseCount === 1 ? 'exercise' : 'exercises'}?`
                  : 'Remove this day?'}
              </span>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-pill px-3 py-1.5 text-xs font-semibold text-muted"
                >
                  Keep
                </button>
                <button
                  type="button"
                  onClick={onDelete}
                  className="rounded-pill bg-red-600 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="w-full py-2 text-center text-sm font-semibold text-red-600 active:opacity-70"
            >
              Remove day
            </button>
          ))}
      </form>
    </SheetFrame>
  );
}

function WeekPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-pill px-3 py-1.5 text-xs font-semibold ${
        active ? 'bg-ink text-white' : 'border border-line bg-paper text-muted'
      }`}
    >
      {children}
    </button>
  );
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}
