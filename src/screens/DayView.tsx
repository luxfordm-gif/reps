import { useEffect, useMemo, useRef, useState } from 'react';
import { ConfirmModal } from '../components/ConfirmModal';
import { reorderPlanExercises, type FullPlan, type PlanExerciseRow } from '../lib/plansApi';
import { haptics } from '../lib/haptics';
import { baseDayName } from '../lib/daySlots';
import {
  formatNameList,
  exerciseBadges,
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
import {
  completeSession,
  createSession,
  getLastCompletedAtByTrainingDay,
  mondayOfWeek,
} from '../lib/sessionsApi';
import { clearHomeCache } from '../lib/homeCache';
import { useNetStatus } from '../lib/offline/net';
import ExerciseName from '../components/ExerciseName';
import { DumbbellIcon } from '../components/Tile';
import { imageForDay } from '../lib/dayImages';
import { useThemeColor } from '../lib/useThemeColor';

type TrainingDay = FullPlan['training_days'][number];

interface Props {
  day: TrainingDay;
  /**
   * The other week's version of this day type, when the plan rotates. Its
   * presence turns on the week line under the header with a switch to it.
   */
  siblingDay?: TrainingDay | null;
  onSwitchToSibling?: () => void;
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

/**
 * "chest, shoulders and triceps" — what this day works, in the order it's
 * trained, each body part named once however many groups carry it.
 */
function summariseBodyParts(groups: BodyPartGroup[]): string {
  const seen: string[] = [];
  for (const group of groups) {
    const name = group.bodyPart.toLowerCase();
    if (!seen.includes(name)) seen.push(name);
  }
  return formatNameList(seen);
}

function estimatedMinutes(setsCount: number): number {
  // ~2.5 minutes per working set incl rest, rounded to nearest 5
  const m = setsCount * 2.5;
  return Math.max(15, Math.round(m / 5) * 5);
}

export function DayView({
  day,
  siblingDay,
  onSwitchToSibling,
  onBack,
  onTapExercise,
  onDayUpdate,
}: Props) {
  // A workout listed for reference — done at home, in your own time, with no
  // session to start and no sets to log.
  const referenceOnly = day.reference_only === true;

  // A reference day can still be ticked off. "Done" is a completed session
  // with no sets, which is exactly what Home counts for its weekly tick and
  // what history shows — so marking it is one write, and undo is one delete.
  const [referenceDoneAt, setReferenceDoneAt] = useState<string | null>(null);
  // The session created from this screen, so it can be undone here.
  const [referenceSessionId, setReferenceSessionId] = useState<string | null>(null);
  const [markingDone, setMarkingDone] = useState(false);
  useEffect(() => {
    if (!referenceOnly) return;
    let cancelled = false;
    getLastCompletedAtByTrainingDay([day.id]).then((by) => {
      if (cancelled) return;
      const at = by[day.id];
      // Only this week counts as "done"; last week's tick shouldn't linger.
      if (at && new Date(at) >= mondayOfWeek(0)) setReferenceDoneAt(at);
    });
    return () => {
      cancelled = true;
    };
  }, [referenceOnly, day.id]);

  async function markReferenceDone() {
    if (markingDone) return;
    setMarkingDone(true);
    haptics.tap();
    try {
      const sess = await createSession(day.id);
      await completeSession(sess.id);
      setReferenceSessionId(sess.id);
      setReferenceDoneAt(new Date().toISOString());
      // Home's cache holds last week's ticks; drop it so the card updates.
      clearHomeCache();
    } finally {
      setMarkingDone(false);
    }
  }

  async function undoReferenceDone() {
    if (!referenceSessionId || markingDone) return;
    setMarkingDone(true);
    try {
      await deleteSession(referenceSessionId);
      setReferenceSessionId(null);
      setReferenceDoneAt(null);
      clearHomeCache();
    } finally {
      setMarkingDone(false);
    }
  }
  // Memoised so the effects below key off the day's exercises, not a fresh
  // empty array on every render.
  const exercises = useMemo(() => day.plan_exercises ?? [], [day.plan_exercises]);
  const groups = groupByBodyPart(exercises);
  const totalSets = totalSetsForDay(exercises);
  const bodyPartSummary = summariseBodyParts(groups);

  // Track which body part sections are expanded. First one open by default.
  const [expanded, setExpanded] = useState<Set<string>>(
    new Set(groups[0] ? [groups[0].bodyPart] : [])
  );

  // Reorder state. One Edit for the whole plan: every group opens at once and
  // each can be shuffled within itself. `drafts` holds the working order per
  // group, keyed by the id of the group's first exercise (unique even when a
  // body part repeats). `saving` guards the Done tap from double-fires.
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, PlanExerciseRow[]>>({});
  const [saving, setSaving] = useState(false);
  const canReorder = !referenceOnly && groups.some((g) => g.exercises.length > 1);

  function groupKeyOf(group: BodyPartGroup): string {
    return group.exercises[0]?.id ?? group.bodyPart;
  }

  function startEdit() {
    haptics.tap();
    setDrafts(Object.fromEntries(groups.map((g) => [groupKeyOf(g), g.exercises])));
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setDrafts({});
  }

  function moveDraft(key: string, from: number, to: number) {
    const rows = drafts[key];
    if (!rows || to < 0 || to >= rows.length) return;
    haptics.tap();
    const next = [...rows];
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row);
    setDrafts((prev) => ({ ...prev, [key]: next }));
  }

  async function saveEdit() {
    // Only groups whose order actually moved are written, so an untouched
    // group keeps its baseline.
    const updates: { id: string; position: number }[] = [];
    for (const group of groups) {
      const draft = drafts[groupKeyOf(group)] ?? group.exercises;
      const original = group.exercises;
      if (!draft.some((ex, i) => ex.id !== original[i]?.id)) continue;
      // Reuse the slots' existing position values (sorted) so the group stays
      // contiguous within the day and neighbouring groups aren't shifted.
      const slots = original.map((e) => e.position).sort((a, b) => a - b);
      draft.forEach((ex, i) => updates.push({ id: ex.id, position: slots[i] }));
    }
    if (updates.length === 0) {
      cancelEdit();
      return;
    }
    setSaving(true);
    try {
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
      haptics.commit();
      cancelEdit();
    } catch (e) {
      console.error(e);
      haptics.alert();
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
    })();
    return () => {
      cancelled = true;
    };
    // `reachable` is in here on purpose: a warm that failed on the walk in
    // should be retried the moment the phone finds a connection again.
  }, [exercises, reachable]);

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

  const title = baseDayName(day.name);
  const image = imageForDay(day.name);

  // The hero is dark and runs up under the status bar, so the bar over it is
  // see-through with a white back button. Once the hero has scrolled away the
  // bar turns back into the ordinary paper one with the day's name in it.
  const heroRef = useRef<HTMLElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [heroGone, setHeroGone] = useState(false);
  const heroImageRef = useRef<HTMLImageElement | null>(null);
  const heroTextRef = useRef<HTMLDivElement | null>(null);
  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const hero = heroRef.current;
      if (!hero) return;
      const barHeight = barRef.current?.getBoundingClientRect().height ?? 44;
      const rect = hero.getBoundingClientRect();
      setHeroGone(rect.bottom <= barHeight + 8);
      // The photo moves at its own pace. Scrolling up, it drifts at a third of
      // the page's speed and eases in slightly, so the copy slides over it. On
      // iOS's pull-down bounce it grows from its bottom edge to fill the gap.
      // Written straight to the element: this runs every frame of a scroll.
      // Each part of the copy fades as it slides up under the bar, so the
      // back button never sits on top of half-read text — and the start
      // button stays solid for as long as it's clear of the bar.
      for (const el of [heroTextRef.current, heroCtaRef.current]) {
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const p = (r.bottom - barHeight) / Math.max(1, r.height);
        el.style.opacity = String(Math.min(1, Math.max(0, p)));
      }
      const img = heroImageRef.current;
      if (img && !reduceMotion) {
        const y = window.scrollY;
        if (y < 0) {
          img.style.transform = `scale(${1 + -y / rect.height})`;
        } else {
          const t = Math.min(y, rect.height);
          img.style.transform = `translate3d(0, ${t * 0.35}px, 0) scale(${1 + (t / rect.height) * 0.12})`;
        }
      }
    };
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [reduceMotion]);
  // Status bar matches whatever is under it: ink over the hero, paper after.
  useThemeColor(heroGone ? '#FAFAFA' : '#0A0A0A');

  // The start button lives in the hero. When it scrolls out of sight a copy
  // rises from the bottom, so the action is never more than a thumb away on a
  // long plan — but the screen doesn't open with the same button twice.
  const heroCtaRef = useRef<HTMLDivElement | null>(null);
  const [heroCtaVisible, setHeroCtaVisible] = useState(true);
  useEffect(() => {
    const el = heroCtaRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setHeroCtaVisible(entry.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [referenceOnly]);

  const ctaLabel = loadingSession ? 'Loading…' : inProgress ? 'Continue workout' : 'Start workout';
  function startOrContinue() {
    haptics.commit();
    if (inProgress) {
      const target = exercises[inProgress.lastExerciseIdx] ?? groups[0]?.exercises[0];
      if (target) onTapExercise?.(target, inProgress.sessionId);
    } else {
      const first = groups[0]?.exercises[0];
      if (first) onTapExercise?.(first);
    }
  }

  return (
    <div className={`min-h-screen bg-paper ${referenceOnly ? 'pb-12' : 'pb-32'}`}>
      <div
        ref={barRef}
        className={`fixed inset-x-0 top-0 z-30 transition-[background-color,box-shadow] duration-pop ease-snap ${
          heroGone ? 'bg-paper shadow-hairline' : 'bg-transparent'
        }`}
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="relative mx-auto flex h-11 max-w-md items-center justify-center px-5">
          <button
            onClick={onBack}
            className={`pressable absolute left-2 flex h-10 w-10 items-center justify-center rounded-full transition-colors duration-pop ${
              heroGone
                ? 'text-ink active:bg-surface-strong'
                : 'bg-black/30 text-white backdrop-blur-md active:bg-black/45'
            }`}
            aria-label="Back"
          >
            <BackIcon />
          </button>
          <div
            className={`text-nav font-semibold leading-none tracking-title text-ink transition-opacity duration-pop ease-snap ${
              heroGone ? 'opacity-100' : 'opacity-0'
            }`}
          >
            {title}
          </div>
        </div>
      </div>

      <header
        ref={heroRef}
        className="relative rounded-b-card bg-ink text-white shadow-lift"
        // Clipped to the rounded bottom but open above, so the photo can grow
        // up into the pull-down bounce rather than being cut at the hero's top.
        style={{ clipPath: 'inset(-100vh 0 0 0 round 0 0 24px 24px)' }}
      >
        {image && (
          <>
            <img
              src={image}
              alt=""
              aria-hidden
              ref={heroImageRef}
              className="absolute inset-0 h-full w-full origin-bottom object-cover opacity-60 will-change-transform"
            />
            {/* Light at the top so the photo reads, near-solid by the copy so
                the words sit on ink rather than on someone's shoulder. */}
            <div className="absolute inset-0 bg-gradient-to-b from-ink/20 via-ink/70 to-ink" />
          </>
        )}
        <div
          className="relative mx-auto max-w-md px-5 pb-6"
          style={{ paddingTop: `calc(env(safe-area-inset-top, 0px) + ${image ? 140 : 68}px)` }}
        >
          <div ref={heroTextRef}>
            {siblingDay && day.week_index != null && onSwitchToSibling ? (
              // Switches which workout the whole screen shows, so it sits above
              // the title it changes.
              <div className="mb-3 inline-flex rounded-pill bg-white/15 p-0.5 backdrop-blur-md">
                {[day, siblingDay]
                  .sort((a, b) => (a.week_index ?? 0) - (b.week_index ?? 0))
                  .map((variant) => {
                    const active = variant.id === day.id;
                    return (
                      <button
                        key={variant.id}
                        onClick={active ? undefined : onSwitchToSibling}
                        className={`pressable rounded-pill px-3 py-1.5 text-xs font-semibold transition-colors duration-150 ${
                          active ? 'bg-white text-ink' : 'text-white/75'
                        }`}
                      >
                        Week {variant.week_index}
                      </button>
                    );
                  })}
              </div>
            ) : day.week_index != null ? (
              <div className="mb-3">
                <span className="rounded-pill bg-white/15 px-2 py-0.5 text-label font-semibold uppercase tracking-eyebrow text-white/90">
                  Week {day.week_index}
                </span>
              </div>
            ) : null}

            <h1 className="text-display font-bold leading-tight tracking-title">{title}</h1>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm font-medium text-white/80">
              <HeroStat icon={<DumbbellIcon />}>{exercises.length} exercises</HeroStat>
              <HeroStat icon={<LayersIcon />}>{totalSets} sets</HeroStat>
              <HeroStat icon={<ClockIcon />}>~{estimatedMinutes(totalSets)} min</HeroStat>
            </div>

            {bodyPartSummary && (
              <p className="mt-3 text-sm leading-relaxed text-white/65">
                A focused session for {bodyPartSummary}.
              </p>
            )}
          </div>

          {!referenceOnly && (
            <div ref={heroCtaRef} className="mt-5">
              <button
                className="pressable w-full rounded-pill bg-white py-4 text-base font-semibold text-ink transition-opacity active:opacity-80 disabled:opacity-50"
                disabled={loadingSession}
                onClick={startOrContinue}
              >
                {ctaLabel}
              </button>
              {inProgress && (
                <div className="mt-3 flex items-center justify-center gap-2 text-xs text-white/65">
                  <span>{inProgress.setsLogged} sets logged so far</span>
                  <span className="h-1 w-1 rounded-full bg-white/40" />
                  <button
                    onClick={() => setConfirmDiscard(true)}
                    className="font-medium underline-offset-2 active:underline"
                  >
                    Discard workout
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-md px-5">
        {referenceOnly && (
          <div className="mt-6 rounded-card bg-paper-card px-5 py-4 shadow-card">
            <div className="text-label font-semibold uppercase tracking-eyebrow text-muted">
              Reference
            </div>
            <div className="mt-1 text-sm text-ink">
              Do this one at home in your own time — it isn't tracked set by set.
            </div>
            {referenceDoneAt ? (
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <TickBadge />
                  Done this week
                  <span className="font-normal text-muted">
                    ·{' '}
                    {new Date(referenceDoneAt).toLocaleDateString('en-GB', {
                      weekday: 'short',
                    })}
                  </span>
                </div>
                {referenceSessionId && (
                  <button
                    type="button"
                    onClick={undoReferenceDone}
                    disabled={markingDone}
                    className="text-xs font-semibold text-muted active:text-ink disabled:opacity-50"
                  >
                    Undo
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={markReferenceDone}
                disabled={markingDone}
                className="pressable mt-3 w-full rounded-pill bg-ink py-3 text-sm font-semibold text-white transition-opacity active:opacity-80 disabled:opacity-50"
              >
                {markingDone ? 'Saving…' : 'Mark as done'}
              </button>
            )}
          </div>
        )}

        <div className="mt-7 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-ink">Exercise plan</h2>
            <p className="mt-1 text-sm text-muted">
              {groups.length} {groups.length === 1 ? 'group' : 'groups'} · {exercises.length}{' '}
              {exercises.length === 1 ? 'exercise' : 'exercises'}
            </p>
          </div>
          {canReorder && (
            <div className="flex shrink-0 items-center gap-3 pb-0.5">
              {editing ? (
                <>
                  <button
                    onClick={cancelEdit}
                    disabled={saving}
                    className="text-sm font-medium text-muted active:text-ink disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveEdit}
                    disabled={saving}
                    className="pressable rounded-pill bg-ink px-4 py-1.5 text-sm font-semibold text-white active:opacity-80 disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : 'Done'}
                  </button>
                </>
              ) : (
                <button
                  onClick={startEdit}
                  className="pressable rounded-pill bg-surface-strong px-4 py-1.5 text-sm font-semibold text-ink active:opacity-70"
                >
                  Edit
                </button>
              )}
            </div>
          )}
        </div>
        {editing && (
          <p className="mt-3 text-xs leading-relaxed text-muted">
            Reordering a group resets its weight and reps to base.
          </p>
        )}

        <div className="mt-4 space-y-3">
          {groups.map((group) => {
            const groupKey = groupKeyOf(group);
            const draft = editing ? drafts[groupKey] : undefined;
            const isOpen = editing || expanded.has(group.bodyPart);
            return (
              <div key={groupKey} className="overflow-hidden rounded-card bg-paper-card shadow-card">
                <button
                  onClick={() => toggle(group.bodyPart)}
                  disabled={editing}
                  className="flex w-full items-center justify-between px-5 py-4 text-left disabled:cursor-default"
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
                  {!editing && (
                    <span className="text-muted" aria-label={isOpen ? 'Collapse' : 'Expand'}>
                      <Chevron rotate={isOpen ? -90 : 0} />
                    </span>
                  )}
                </button>

                {draft && (
                  <div className="border-t border-line">
                    {draft.map((ex, i) => (
                      <ReorderRow
                        key={ex.id}
                        exercise={ex}
                        isFirst={i === 0}
                        isLast={i === draft.length - 1}
                        disabled={saving}
                        onUp={() => moveDraft(groupKey, i, i - 1)}
                        onDown={() => moveDraft(groupKey, i, i + 1)}
                      />
                    ))}
                  </div>
                )}

                {isOpen && !draft && (
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
      {/* The action stays on screen however long the plan runs. The strip
          above it blurs and fades the page into the footer, so a card
          scrolling underneath reads as passing behind the button rather than
          being cut off by it — the same footer the completion screen uses. */}
      {!referenceOnly && (
        <div
          aria-hidden={heroCtaVisible}
          className={`pointer-events-none fixed inset-x-0 bottom-0 z-30 transition-[opacity,transform] duration-sheet ease-snap ${
            heroCtaVisible ? 'translate-y-4 opacity-0' : 'translate-y-0 opacity-100'
          }`}
        >
          <div className="h-10 bg-gradient-to-t from-paper to-transparent backdrop-blur-[2px]" />
          <div className="bg-paper px-5 pt-2 pb-[max(env(safe-area-inset-bottom),24px)]">
            <div className="mx-auto w-full max-w-md">
              <button
                tabIndex={heroCtaVisible ? -1 : 0}
                className={`pressable w-full rounded-pill bg-ink py-4 text-base font-semibold text-white transition-opacity active:opacity-80 disabled:opacity-50 ${
                  heroCtaVisible ? '' : 'pointer-events-auto'
                }`}
                disabled={loadingSession}
                onClick={startOrContinue}
              >
                {ctaLabel}
              </button>
            </div>
          </div>
        </div>
      )}
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
  // The group it's performed in, and what happens inside its own sets — an
  // exercise can have both, and only one used to show.
  const badges = exerciseBadges(partnerNames.length, exercise.set_scheme);

  function openImages(e: React.MouseEvent) {
    e.stopPropagation();
    window.open(googleImagesUrl(exercise.name), '_blank', 'noopener,noreferrer');
  }

  return (
    <div className={`px-5 py-4 ${!isLast ? 'border-b border-line' : ''}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={openImages}
            className="text-left text-base font-semibold leading-tight text-ink underline-offset-2 active:underline"
          >
            <ExerciseName name={exercise.name} />
          </button>
          <div
            onClick={onTap}
            className="mt-1 flex cursor-pointer flex-wrap items-center gap-1.5 text-xs text-muted"
          >
            <span>
              {exercise.total_sets ?? '–'} × {exercise.rep_range}
            </span>
            {badges.map((badge, i) => (
              // The first badge keeps the weight it always had; a second one
              // sits behind it so the pair reads as one thing and its detail,
              // rather than two competing labels.
              <span
                key={badge}
                className={`rounded-pill px-2 py-0.5 text-label font-semibold uppercase tracking-eyebrow ${
                  i === 0 ? 'bg-ink text-white' : 'bg-ink/10 text-ink'
                }`}
              >
                {badge}
              </span>
            ))}
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
          <button onClick={onTap} className="self-center text-muted" aria-label="Open exercise">
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
            <NoteIcon />
            <span>Coach notes</span>
            <Chevron rotate={notesOpen ? 90 : 0} small />
          </button>
          {notesOpen && (
            <div className="mt-2 rounded-control bg-paper p-3 text-xs leading-relaxed text-ink">
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
          <ExerciseName name={exercise.name} variant="inline" />
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
          className="pressable flex h-9 w-9 items-center justify-center rounded-full bg-line text-ink active:opacity-70 disabled:opacity-30"
        >
          <MoveArrow up />
        </button>
        <button
          onClick={onDown}
          disabled={disabled || isLast}
          aria-label="Move down"
          className="pressable flex h-9 w-9 items-center justify-center rounded-full bg-line text-ink active:opacity-70 disabled:opacity-30"
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

function NoteIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M4 2.5h5L12 5.5v8a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M8.75 2.75V5.5H11.5M6 9h4M6 11h2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
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

function TickBadge() {
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ink text-white">
      <svg width="12" height="12" viewBox="0 0 22 22" fill="none" aria-hidden="true">
        <path
          d="M5 11.5l4 4 8-9"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function HeroStat({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      <span className="flex text-white/55 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      {children}
    </span>
  );
}

function BackIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M15 5l-7 7 7 7"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LayersIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M9 2.5 2.5 6 9 9.5 15.5 6 9 2.5ZM2.5 9 9 12.5 15.5 9M2.5 12 9 15.5 15.5 12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="6.75" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9 5.5V9l2.5 1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
