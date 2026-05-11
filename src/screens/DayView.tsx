import { useEffect, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { ConfirmModal } from '../components/ConfirmModal';
import type { FullPlan, PlanExerciseRow } from '../lib/plansApi';
import {
  getActiveSessionForDay,
  getSessionStats,
  deleteSession,
} from '../lib/sessionsApi';

interface Props {
  day: FullPlan['training_days'][number];
  onBack: () => void;
  onTapExercise?: (exercise: PlanExerciseRow, existingSessionId?: string) => void;
}

interface BodyPartGroup {
  bodyPart: string;
  exercises: PlanExerciseRow[];
}

function groupByBodyPart(exercises: PlanExerciseRow[]): BodyPartGroup[] {
  const groups: BodyPartGroup[] = [];
  for (const ex of exercises) {
    const bp = ex.body_part ?? 'Other';
    const last = groups[groups.length - 1];
    if (last && last.bodyPart === bp) {
      last.exercises.push(ex);
    } else {
      groups.push({ bodyPart: bp, exercises: [ex] });
    }
  }
  return groups;
}

function googleImagesUrl(name: string): string {
  return `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(name + ' gym machine')}`;
}

function totalSetsForDay(exercises: PlanExerciseRow[]): number {
  return exercises.reduce((sum, e) => sum + (e.total_sets ?? 0), 0);
}

function estimatedMinutes(setsCount: number): number {
  // ~2.5 minutes per working set incl rest, rounded to nearest 5
  const m = setsCount * 2.5;
  return Math.max(15, Math.round(m / 5) * 5);
}

export function DayView({ day, onBack, onTapExercise }: Props) {
  const exercises = day.plan_exercises ?? [];
  const groups = groupByBodyPart(exercises);
  const totalSets = totalSetsForDay(exercises);

  // Track which body part sections are expanded. First one open by default.
  const [expanded, setExpanded] = useState<Set<string>>(
    new Set(groups[0] ? [groups[0].bodyPart] : [])
  );

  // In-progress session for this day, if any
  const [inProgress, setInProgress] = useState<{
    sessionId: string;
    setsLogged: number;
    lastExerciseIdx: number;
  } | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoadingSession(true);
    (async () => {
      try {
        const sess = await getActiveSessionForDay(day.id);
        if (!sess) {
          if (mounted) setInProgress(null);
          return;
        }
        const stats = await getSessionStats(sess.id);
        const lastIdx = stats.lastPlanExerciseId
          ? exercises.findIndex((e) => e.id === stats.lastPlanExerciseId)
          : 0;
        if (mounted) {
          setInProgress({
            sessionId: sess.id,
            setsLogged: stats.setsLogged,
            lastExerciseIdx: Math.max(0, lastIdx),
          });
        }
      } finally {
        if (mounted) setLoadingSession(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [day.id, exercises]);

  async function handleDiscard() {
    if (!inProgress) return;
    await deleteSession(inProgress.sessionId);
    setInProgress(null);
    setConfirmDiscard(false);
  }

  function toggle(bp: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(bp)) next.delete(bp);
      else next.add(bp);
      return next;
    });
  }

  return (
    <div className="min-h-screen bg-paper pb-28">
      <div className="mx-auto max-w-md px-5 pt-3">
        <PageHeader title={day.name} onBack={onBack} />

        <div className="mt-8">
          <h1 className="text-[32px] font-bold leading-[1.1] tracking-tight text-ink">
            {day.name}
          </h1>
          <div className="mt-1.5 flex items-center gap-3 text-sm text-muted">
            <span>{exercises.length} exercises</span>
            <span className="h-1 w-1 rounded-full bg-muted/50" />
            <span>{totalSets} working sets</span>
            <span className="h-1 w-1 rounded-full bg-muted/50" />
            <span>~{estimatedMinutes(totalSets)} min</span>
          </div>
        </div>

        <button
          className="mt-6 w-full rounded-pill bg-ink py-4 text-base font-semibold text-white transition-opacity active:opacity-80 disabled:opacity-50"
          disabled={loadingSession}
          onClick={() => {
            if (inProgress) {
              const target =
                exercises[inProgress.lastExerciseIdx] ?? groups[0]?.exercises[0];
              if (target) onTapExercise?.(target, inProgress.sessionId);
            } else {
              const first = groups[0]?.exercises[0];
              if (first) onTapExercise?.(first);
            }
          }}
        >
          {loadingSession ? 'Loading…' : inProgress ? 'Continue workout' : 'Start workout'}
        </button>
        {inProgress && (
          <div className="mt-2 flex items-center justify-center gap-2 text-xs text-muted">
            <span>{inProgress.setsLogged} sets logged so far</span>
            <span className="h-1 w-1 rounded-full bg-muted/50" />
            <button
              onClick={() => setConfirmDiscard(true)}
              className="font-medium underline-offset-2 active:underline"
            >
              Discard workout
            </button>
          </div>
        )}

        <div className="mt-[26px] space-y-3">
          {groups.map((group) => {
            const isOpen = expanded.has(group.bodyPart);
            return (
              <div key={group.bodyPart} className="overflow-hidden rounded-card bg-paper-card shadow-card">
                <button
                  onClick={() => toggle(group.bodyPart)}
                  className="flex w-full items-center justify-between px-5 py-4 text-left active:bg-line/40"
                >
                  <div>
                    <div className="text-base font-bold tracking-tight text-ink">
                      {group.bodyPart}
                    </div>
                    <div className="mt-0.5 text-xs text-muted">
                      {group.exercises.length}{' '}
                      {group.exercises.length === 1 ? 'exercise' : 'exercises'}
                    </div>
                  </div>
                  <Chevron rotate={isOpen ? 90 : 0} />
                </button>

                {isOpen && (
                  <div className="border-t border-line">
                    {group.exercises.map((ex, i) => (
                      <ExerciseRow
                        key={ex.id}
                        exercise={ex}
                        isLast={i === group.exercises.length - 1}
                        onTap={() => onTapExercise?.(ex)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {confirmDiscard && (
        <ConfirmModal
          title="Discard this workout?"
          message="Logged sets will be deleted."
          confirmLabel="Discard"
          onCancel={() => setConfirmDiscard(false)}
          onConfirm={handleDiscard}
        />
      )}
    </div>
  );
}

function ExerciseRow({
  exercise,
  isLast,
  onTap,
}: {
  exercise: PlanExerciseRow;
  isLast: boolean;
  onTap: () => void;
}) {
  const [notesOpen, setNotesOpen] = useState(false);
  const hasNotes = !!exercise.notes && exercise.notes.trim().length > 0;
  const schemeLabel = schemeToLabel(exercise.set_scheme);

  function openImages(e: React.MouseEvent) {
    e.stopPropagation();
    window.open(googleImagesUrl(exercise.name), '_blank', 'noopener,noreferrer');
  }

  return (
    <div className={`px-5 py-4 ${!isLast ? 'border-b border-line' : ''}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <button
            type="button"
            onClick={openImages}
            className="text-left text-base font-semibold leading-tight text-ink underline-offset-2 active:underline"
          >
            {exercise.name}
          </button>
          <div
            onClick={onTap}
            className="mt-1 flex cursor-pointer flex-wrap items-center gap-1.5 text-xs text-muted"
          >
            <span>
              {exercise.total_sets ?? '–'} × {exercise.rep_range}
            </span>
            {schemeLabel && (
              <span className="rounded-pill bg-ink px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                {schemeLabel}
              </span>
            )}
          </div>
        </div>
        <button onClick={onTap} className="mt-0.5 text-muted" aria-label="Open exercise">
          <ChevronSmall />
        </button>
      </div>

      {hasNotes && (
        <div className="mt-2.5">
          <button
            onClick={() => setNotesOpen((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-medium text-muted active:text-ink"
          >
            <span>Coach notes</span>
            <Chevron rotate={notesOpen ? 90 : 0} small />
          </button>
          {notesOpen && (
            <div className="mt-2 rounded-xl bg-paper p-3 text-xs leading-relaxed text-ink">
              {exercise.notes}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function schemeToLabel(scheme: string | null | undefined): string | null {
  switch (scheme) {
    case 'dropset':
      return 'Dropset';
    case 'superset':
      return 'Superset';
    case 'muscle_round':
      return 'Muscle Round';
    case 'rest_pause':
      return 'Rest-Pause';
    case 'hold':
      return 'Hold';
    default:
      return null;
  }
}

function Chevron({ rotate = 0, small = false }: { rotate?: number; small?: boolean }) {
  const size = small ? 12 : 18;
  return (
    <svg
      width={size}
      height={size}
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

function ChevronSmall() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
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
