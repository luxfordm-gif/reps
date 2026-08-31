import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { ConfirmModal } from '../components/ConfirmModal';
import { reorderPlanExercises, type FullPlan, type PlanExerciseRow } from '../lib/plansApi';
import { hapticBuzz } from '../lib/haptics';
import {
  formatNameList,
  groupedSetLabel,
  supersetPartnerNames,
} from '../lib/supersets';
import {
  getActiveSessionForDay,
  getSessionStats,
  deleteSession,
  prefetchLastSetsForDay,
  type PrefetchExercise,
} from '../lib/sessionsApi';
import { prefetchAlternativesForExercises } from '../lib/alternativesApi';
import { lastSetsWarmth, warmLastSetsForPlan } from '../lib/sessionsApi';
import { useNetStatus } from '../lib/offline/net';

type TrainingDay = FullPlan['training_days'][number];

interface Props {
  day: TrainingDay;
  onBack: () => void;
  onTapExercise?: (exercise: PlanExerciseRow, existingSessionId?: string) => void;
  /**
   * Called after the user reorders a body-part group and taps Done. Receives the
   * whole day with its exercises re-sorted into the new order and the affected
   * rows' baseline_reset_at bumped, so the parent can keep the workout flow in
   * sync with what was just saved.
   */
  onDayUpdate?: (day: TrainingDay) => void;
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

export function DayView({ day, onBack, onTapExercise, onDayUpdate }: Props) {
  // A workout listed for reference — done at home, in your own time, with no
  // session to start and no sets to log.
  const referenceOnly = day.reference_only === true;
  // Memoised so the effects below key off the day's exercises, not a fresh
  // empty array on every render.
  const exercises = useMemo(() => day.plan_exercises ?? [], [day.plan_exercises]);
  const groups = groupByBodyPart(exercises);
  const totalSets = totalSetsForDay(exercises);

  // Track which body part sections are expanded. First one open by default.
  const [expanded, setExpanded] = useState<Set<string>>(
    new Set(groups[0] ? [groups[0].bodyPart] : [])
  );

  // Reorder state. `editingKey` is the id of the first exercise in the group
  // being edited (unique per group even if a body part repeats); `draft` is the
  // working order for that group while the user shuffles rows. `saving` guards
  // the Done tap from double-fires.
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<PlanExerciseRow[]>([]);
  const [saving, setSaving] = useState(false);

  function startEdit(group: BodyPartGroup) {
    hapticBuzz(10);
    setExpanded((prev) => new Set(prev).add(group.bodyPart));
    setEditingKey(group.exercises[0]?.id ?? null);
    setDraft(group.exercises);
  }

  function cancelEdit() {
    setEditingKey(null);
    setDraft([]);
  }

  function moveDraft(from: number, to: number) {
    if (to < 0 || to >= draft.length) return;
    hapticBuzz(10);
    setDraft((prev) => {
      const next = [...prev];
      const [row] = next.splice(from, 1);
      next.splice(to, 0, row);
      return next;
    });
  }

  async function saveEdit(group: BodyPartGroup) {
    const original = group.exercises;
    const changed = draft.some((ex, i) => ex.id !== original[i]?.id);
    if (!changed) {
      cancelEdit();
      return;
    }
    setSaving(true);
    try {
      // Reuse the slots' existing position values (sorted) so the group stays
      // contiguous within the day and neighbouring groups aren't shifted.
      const slots = original.map((e) => e.position).sort((a, b) => a - b);
      const updates = draft.map((ex, i) => ({ id: ex.id, position: slots[i] }));
      const resetAt = await reorderPlanExercises(updates);

      const posById = new Map(updates.map((u) => [u.id, u.position]));
      const nextExercises = exercises
        .map((ex) =>
          posById.has(ex.id)
            ? { ...ex, position: posById.get(ex.id)!, baseline_reset_at: resetAt }
            : ex
        )
        .sort((a, b) => a.position - b.position);
      onDayUpdate?.({ ...day, plan_exercises: nextExercises });
      hapticBuzz([12, 40, 12]);
      cancelEdit();
    } catch (e) {
      console.error(e);
      hapticBuzz([40, 30, 40]);
    } finally {
      setSaving(false);
    }
  }

  // In-progress session for this day, if any
  const [inProgress, setInProgress] = useState<{
    sessionId: string;
    setsLogged: number;
    lastExerciseIdx: number;
  } | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Bumped whenever a warm finishes, so the coverage line re-reads the device.
  const [warmKey, setWarmKey] = useState(0);
  const [warming, setWarming] = useState(false);
  const { reachable } = useNetStatus();

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

  // Pull this workout's history onto the device while there's still signal.
  //
  // Opening the day is the last reliably-connected moment before training —
  // once you're on the gym floor the requests time out, and "LAST TIME" is the
  // one thing you can't log without. Warming every exercise (and every
  // alternative) here means the weights and reps are already on the phone.
  useEffect(() => {
    if (exercises.length === 0) return;
    let cancelled = false;
    (async () => {
      const targets: PrefetchExercise[] = exercises.map((ex) => ({
        normalizedName: ex.normalized_name,
        baselineResetAt: ex.baseline_reset_at,
      }));
      const alts = await prefetchAlternativesForExercises(exercises.map((ex) => ex.id));
      if (cancelled) return;
      const byId = new Map(exercises.map((ex) => [ex.id, ex]));
      for (const alt of alts) {
        targets.push({
          normalizedName: alt.normalized_name,
          // An alternative shares its slot's baseline, so a reorder resets both.
          baselineResetAt: byId.get(alt.plan_exercise_id)?.baseline_reset_at ?? null,
        });
      }
      await prefetchLastSetsForDay(targets);
      if (!cancelled) setWarmKey((k) => k + 1);
    })();
    return () => {
      cancelled = true;
    };
    // `reachable` is in here on purpose: a warm that failed on the walk in
    // should be retried the moment the phone finds a connection again.
  }, [exercises, reachable]);

  // What can be logged with no signal. Shown only when something is missing —
  // when it's all there, there is nothing worth saying.
  const warmth = useMemo(
    () => lastSetsWarmth(exercises),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [exercises, warmKey]
  );
  const missingWarmth = warmth.total - warmth.covered;

  async function handleDiscard() {
    if (!inProgress) return;
    await deleteSession(inProgress.sessionId);
    setInProgress(null);
    setConfirmDiscard(false);
  }

  async function handleWarmNow() {
    if (warming) return;
    setWarming(true);
    try {
      await warmLastSetsForPlan({ force: true });
    } finally {
      setWarming(false);
      setWarmKey((k) => k + 1);
    }
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

        <div className="mt-3 flex items-center gap-3 text-sm text-muted">
          <span>{exercises.length} exercises</span>
          <span className="h-1 w-1 rounded-full bg-muted/50" />
          <span>{totalSets} working sets</span>
          <span className="h-1 w-1 rounded-full bg-muted/50" />
          <span>~{estimatedMinutes(totalSets)} min</span>
        </div>

        {missingWarmth > 0 && reachable && (
          <button
            onClick={handleWarmNow}
            disabled={warming}
            className="mt-3 flex w-full items-center gap-2 rounded-pill bg-line/70 px-3 py-1.5 text-left text-xs font-medium text-muted disabled:opacity-60"
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted" />
            <span className="truncate">
              {warming
                ? 'Saving last time\u2019s weights\u2026'
                : `Last time\u2019s weights aren\u2019t saved for ${missingWarmth} ${
                    missingWarmth === 1 ? 'exercise' : 'exercises'
                  } \u2014 tap to load now`}
            </span>
          </button>
        )}

        {referenceOnly && (
          <div className="mt-6 rounded-card bg-paper-card px-5 py-4 text-center shadow-card">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
              Reference
            </div>
            <div className="mt-1 text-sm text-ink">
              Do this one at home in your own time — it isn't tracked set by set.
            </div>
          </div>
        )}

        {!referenceOnly && (
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
        )}
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
            const groupKey = group.exercises[0]?.id ?? group.bodyPart;
            const isEditing = editingKey === groupKey;
            const canReorder = group.exercises.length > 1;
            return (
              <div key={groupKey} className="overflow-hidden rounded-card bg-paper-card shadow-card">
                <div className="flex w-full items-center justify-between px-5 py-4">
                  <button
                    onClick={() => toggle(group.bodyPart)}
                    disabled={isEditing}
                    className="flex flex-1 items-center gap-3 text-left disabled:cursor-default"
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
                  </button>
                  <div className="flex items-center gap-3">
                    {isEditing ? (
                      <>
                        <button
                          onClick={cancelEdit}
                          disabled={saving}
                          className="text-sm font-medium text-muted active:text-ink disabled:opacity-50"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => saveEdit(group)}
                          disabled={saving}
                          className="rounded-pill bg-ink px-4 py-1.5 text-sm font-semibold text-white active:opacity-80 disabled:opacity-50"
                        >
                          {saving ? 'Saving…' : 'Done'}
                        </button>
                      </>
                    ) : (
                      <>
                        {isOpen && canReorder && (
                          <button
                            onClick={() => startEdit(group)}
                            className="text-sm font-semibold text-ink active:opacity-60"
                          >
                            Edit
                          </button>
                        )}
                        <button
                          onClick={() => toggle(group.bodyPart)}
                          className="text-muted"
                          aria-label={isOpen ? 'Collapse' : 'Expand'}
                        >
                          <Chevron rotate={isOpen ? 90 : 0} />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {isOpen && isEditing && (
                  <div className="border-t border-line">
                    <p className="px-5 pt-3 text-xs leading-relaxed text-muted">
                      Reordering resets weight &amp; reps to base for {group.bodyPart}.
                    </p>
                    {draft.map((ex, i) => (
                      <ReorderRow
                        key={ex.id}
                        exercise={ex}
                        isFirst={i === 0}
                        isLast={i === draft.length - 1}
                        disabled={saving}
                        onUp={() => moveDraft(i, i - 1)}
                        onDown={() => moveDraft(i, i + 1)}
                      />
                    ))}
                  </div>
                )}

                {isOpen && !isEditing && (
                  <div className="border-t border-line">
                    {group.exercises.map((ex, i) => (
                      <ExerciseRow
                        key={ex.id}
                        exercise={ex}
                        partnerNames={supersetPartnerNames(ex, exercises)}
                        readOnly={referenceOnly}
                        isLast={i === group.exercises.length - 1}
                        onTap={() => {
                          if (referenceOnly) return;
                          onTapExercise?.(ex);
                        }}
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
  partnerNames,
  isLast,
  onTap,
  readOnly,
}: {
  exercise: PlanExerciseRow;
  // The rest of this exercise's superset / tri-set / giant set, if it's in one.
  partnerNames: string[];
  isLast: boolean;
  onTap: () => void;
  // Reference days have nothing to open, so the row loses its chevron.
  readOnly?: boolean;
}) {
  const [notesOpen, setNotesOpen] = useState(false);
  const hasNotes = !!exercise.notes && exercise.notes.trim().length > 0;
  const schemeLabel =
    partnerNames.length > 0
      ? groupedSetLabel(partnerNames.length + 1)
      : schemeToLabel(exercise.set_scheme);

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
          {partnerNames.length > 0 && (
            <div onClick={onTap} className="mt-1 cursor-pointer text-xs text-muted">
              Alternates with{' '}
              <span className="font-medium text-ink">
                {formatNameList(partnerNames)}
              </span>
            </div>
          )}
        </div>
        {!readOnly && (
          <button onClick={onTap} className="mt-0.5 text-muted" aria-label="Open exercise">
            <ChevronSmall />
          </button>
        )}
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

function ReorderRow({
  exercise,
  isFirst,
  isLast,
  disabled,
  onUp,
  onDown,
}: {
  exercise: PlanExerciseRow;
  isFirst: boolean;
  isLast: boolean;
  disabled: boolean;
  onUp: () => void;
  onDown: () => void;
}) {
  return (
    <div className={`flex items-center gap-3 px-5 py-3.5 ${!isLast ? 'border-b border-line' : ''}`}>
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-semibold leading-tight text-ink">
          {exercise.name}
        </div>
        <div className="mt-1 text-xs text-muted">
          {exercise.total_sets ?? '–'} × {exercise.rep_range}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          onClick={onUp}
          disabled={disabled || isFirst}
          aria-label="Move up"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-line text-ink active:opacity-70 disabled:opacity-30"
        >
          <MoveArrow up />
        </button>
        <button
          onClick={onDown}
          disabled={disabled || isLast}
          aria-label="Move down"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-line text-ink active:opacity-70 disabled:opacity-30"
        >
          <MoveArrow />
        </button>
      </div>
    </div>
  );
}

function MoveArrow({ up = false }: { up?: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      style={{ transform: up ? 'none' : 'rotate(180deg)' }}
    >
      <path
        d="M8 12V4M8 4L4.5 7.5M8 4l3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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
