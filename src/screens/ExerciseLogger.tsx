import { useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { useThemeColor } from '../lib/useThemeColor';
import {
  logSet,
  updateLoggedSet,
  getSessionSets,
  getLastSessionSetsForExercise,
  type LoggedSet,
} from '../lib/sessionsApi';
import { parseSetMods } from '../lib/parseSetMods';
import { buildKudos } from '../lib/kudos';
import {
  getActivePlan,
  mergeExerciseIntoIdentity,
  swapPlanExerciseIdentity,
  updatePlanExerciseName,
  updatePlanExerciseNotes,
  updatePlanExercisePersonalNote,
  updatePlanExerciseRest,
  type PlanExerciseRow,
} from '../lib/plansApi';
import { listMachines, type MachineRow } from '../lib/machinesApi';
import {
  listAlternativesForExercise,
  addAlternative,
  removeAlternative,
  type ExerciseAlternativeRow,
} from '../lib/alternativesApi';
import { detectSetScheme } from '../lib/parseTrainingPlan';
import { clearHomeCache } from '../lib/homeCache';
import BarbellCalculator from '../components/BarbellCalculator';
import { findCloseMatch, type SimilarityCandidate } from '../lib/stringSimilarity';
import { normalizeExerciseName } from '../lib/normalizeExerciseName';
import { kgToLb, lbToKg, type MachineUnit } from '../lib/units';
import {
  getCachedExerciseUnit,
  getExerciseUnit,
  setExerciseUnit,
} from '../lib/exercisePrefsApi';

// Display: kg as stored; lb rounded to nearest 0.5 to match the input's step.
// Pin units store and display the same number (1:1 — no physical conversion).
function fromKg(kg: number, unit: MachineUnit): number {
  if (unit === 'lb') return Math.round(kgToLb(kg) * 2) / 2;
  return kg;
}
function toKg(n: number, unit: MachineUnit): number {
  return unit === 'lb' ? lbToKg(n) : n;
}
function convertWeightStr(
  s: string,
  prev: MachineUnit,
  next: MachineUnit
): string {
  if (s === '' || prev === next) return s;
  const n = parseFloat(s);
  if (Number.isNaN(n)) return s;
  return String(fromKg(toKg(n, prev), next));
}

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
  scheme?: 'dropset' | 'back_off' | 'muscle_round' | 'intensifier' | 'amrap';
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
  notes: string,
  unit: MachineUnit
): SetState[] {
  const baseTarget = parseTargetReps(repRange);
  const baseTargetStr = baseTarget != null ? String(baseTarget) : '';
  const mods = parseSetMods(notes, Math.max(1, totalSets));
  const intensifier = parseIntensifier(notes);
  const rows: SetState[] = [];
  // lastSets values are kg; seed inputs in the active display unit so the
  // suggested number matches what the user expects to type.
  const fmtW = (kg: number) => String(fromKg(kg, unit));
  for (let i = 0; i < Math.max(1, totalSets); i++) {
    const setIndex = i + 1;
    const mod = mods.bySetIndex.get(setIndex);
    const targetStr =
      mod?.repTarget != null ? String(mod.repTarget) : baseTargetStr;
    // Main set
    const mainLast = lastSets.find((s) => s.set_index === setIndex && s.drop_index === 0);
    const mainWeightSugg = mainLast?.weight != null ? fmtW(mainLast.weight) : '';
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
        const wSugg = dropLast?.weight != null ? fmtW(dropLast.weight) : '';
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
      const w = last?.weight != null ? fmtW(last.weight) : fmtW(p.weight);
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

const REST_VALID = [30, 60, 90, 120, 180] as const;

function initialRestSeconds(stored: number | null | undefined): number {
  if (stored != null && REST_VALID.includes(stored as (typeof REST_VALID)[number])) {
    return stored;
  }
  if (typeof window !== 'undefined') {
    const v = window.localStorage.getItem('reps.restSeconds');
    const n = v ? parseInt(v, 10) : NaN;
    if (REST_VALID.includes(n as (typeof REST_VALID)[number])) return n;
  }
  return 60;
}

// Bell-like "ding" when the rest timer ends. Plays everywhere as the audible
// cue; on iOS Safari (no navigator.vibrate) it's the only signal, and on
// Android it reinforces the haptic.
function playRestDoneBeep() {
  try {
    type WebAudioWindow = Window &
      typeof globalThis & { webkitAudioContext?: typeof AudioContext };
    const w = window as WebAudioWindow;
    const Ctx = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();

    // Bell: a fundamental + a perfect-fifth partial, both with an exponential
    // decay so it reads as a "ding" rather than a sine beep.
    const now = ctx.currentTime;
    const peak = 0.5;
    const tail = 0.8;

    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(peak, now + 0.01);
    master.gain.exponentialRampToValueAtTime(0.0001, now + tail);
    master.connect(ctx.destination);

    function partial(freq: number, mix: number) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.value = mix;
      o.connect(g).connect(master);
      o.start(now);
      o.stop(now + tail + 0.05);
      return o;
    }

    const fundamental = partial(880, 1.0);
    partial(1320, 0.45);
    partial(1760, 0.2);

    fundamental.onended = () => ctx.close().catch(() => {});
  } catch {
    // Autoplay/permission blocked — ignore silently.
  }
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
  const [restMinimised, setRestMinimised] = useState(false);
  const [restSeconds, setRestSecondsState] = useState<number>(() =>
    initialRestSeconds(exercise.rest_seconds)
  );
  const [unit, setUnit] = useState<MachineUnit>(() =>
    getCachedExerciseUnit(exercise.normalized_name)
  );
  // Mirrors `unit` for use inside the async load effect, which captures a
  // stale closure value otherwise (cache-vs-DB reconcile may setUnit between
  // the effect starting and resolving).
  const unitRef = useRef<MachineUnit>(unit);
  useEffect(() => {
    unitRef.current = unit;
  }, [unit]);
  const [, setNow] = useState(Date.now());
  const [displayName, setDisplayName] = useState(exercise.name);
  // Effective machine identity for logging + prefill. Starts as the plan
  // exercise's own identity, but a swap (one-off or persisted) re-points it so
  // sets log against — and "last time" prefills from — the swapped machine.
  const [effectiveNormalized, setEffectiveNormalized] = useState(
    exercise.normalized_name
  );
  const [effectiveBaselineResetAt, setEffectiveBaselineResetAt] = useState<
    string | null
  >(exercise.baseline_reset_at);
  const [swapOpen, setSwapOpen] = useState(false);
  // Alternatives attached to this plan-exercise slot. `activeAltId === null`
  // means the primary plan exercise is selected; otherwise it's the id of the
  // active alternative. The active identity (name/normalized/baseline) is
  // re-pointed via `selectIdentity` so set rows + "last time" prefill reload
  // for the chosen movement while tempo/reps/sets stay from the plan.
  const [alternatives, setAlternatives] = useState<ExerciseAlternativeRow[]>([]);
  const [activeAltId, setActiveAltId] = useState<string | null>(null);
  const [addAltOpen, setAddAltOpen] = useState(false);
  const [personalOpen, setPersonalOpen] = useState(false);
  const [savedPersonal, setSavedPersonal] = useState<string>(
    exercise.personal_notes ?? ''
  );
  const [personalDraft, setPersonalDraft] = useState<string>(
    exercise.personal_notes ?? ''
  );
  const [personalSaving, setPersonalSaving] = useState(false);
  const [savedCoach, setSavedCoach] = useState<string>(exercise.notes ?? '');
  const [coachDraft, setCoachDraft] = useState<string>(exercise.notes ?? '');
  const [coachSaving, setCoachSaving] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameCandidates, setRenameCandidates] = useState<SimilarityCandidate[]>([]);
  const [suggestion, setSuggestion] = useState<
    | { candidate: SimilarityCandidate; typedName: string; resetBaseline: boolean }
    | null
  >(null);

  // When the user switches to a different exercise mid-session, re-pick the
  // initial rest from that exercise's stored value (falling back to local
  // default), and reset the displayed name to the canonical one.
  useEffect(() => {
    setRestSecondsState(initialRestSeconds(exercise.rest_seconds));
    setDisplayName(exercise.name);
    setEffectiveNormalized(exercise.normalized_name);
    setEffectiveBaselineResetAt(exercise.baseline_reset_at);
    // Always reopen on the primary so the plan keeps its priority.
    setActiveAltId(null);
    const note = exercise.personal_notes ?? '';
    setSavedPersonal(note);
    setPersonalDraft(note);
    setPersonalOpen(false);
    const coach = exercise.notes ?? '';
    setSavedCoach(coach);
    setCoachDraft(coach);
    setNotesOpen(false);
  }, [
    exercise.id,
    exercise.rest_seconds,
    exercise.name,
    exercise.normalized_name,
    exercise.baseline_reset_at,
    exercise.personal_notes,
    exercise.notes,
  ]);

  // Load this slot's alternatives. Best-effort — on failure the pill switcher
  // simply doesn't render and the exercise behaves exactly as before.
  useEffect(() => {
    let mounted = true;
    listAlternativesForExercise(exercise.id)
      .then((alts) => {
        if (mounted) setAlternatives(alts);
      })
      .catch(() => {
        if (mounted) setAlternatives([]);
      });
    return () => {
      mounted = false;
    };
  }, [exercise.id]);

  // Switch the active identity between the primary plan exercise (null) and one
  // of its alternatives. Re-points the same effective-state values the one-off
  // swap uses, so the load effect rebuilds set rows + "last time" prefill for
  // the chosen movement. Tempo / rep range / target sets stay from the plan.
  function selectIdentity(alt: ExerciseAlternativeRow | null) {
    setError(null);
    setRestEndsAt(null);
    if (alt === null) {
      setActiveAltId(null);
      setDisplayName(exercise.name);
      setEffectiveBaselineResetAt(exercise.baseline_reset_at);
      setEffectiveNormalized(exercise.normalized_name);
    } else {
      setActiveAltId(alt.id);
      setDisplayName(alt.name);
      // Existing machine → show its history; a brand-new movement simply has no
      // logged sets under its normalized_name, so prefill comes back empty
      // (blank weights, reps from the plan's rep range).
      setEffectiveBaselineResetAt(null);
      setEffectiveNormalized(alt.normalized_name);
    }
  }

  async function handleAddAlternative(name: string, normalizedName: string) {
    try {
      const added = await addAlternative(exercise.id, name, normalizedName);
      setAlternatives((prev) => [...prev, added]);
      setAddAltOpen(false);
      // Jump straight to the new alternative so the user can start logging it.
      selectIdentity(added);
    } catch (e) {
      console.error(e);
      setError('Could not add the alternative. Try again.');
    }
  }

  async function handleRemoveAlternative(id: string) {
    try {
      await removeAlternative(id);
    } catch (e) {
      console.error(e);
      setError('Could not remove the alternative. Try again.');
      return;
    }
    setAlternatives((prev) => prev.filter((a) => a.id !== id));
    // If the removed alternative was active, fall back to the primary.
    if (activeAltId === id) selectIdentity(null);
  }

  function changeUnit(next: MachineUnit) {
    setUnit((prev) => {
      if (prev === next) return prev;
      // Re-seed visible inputs so the digits match the new label. Round-trip
      // through kg using the previous unit. Keep weight === weightSuggested
      // after the swap so the muted-placeholder styling stays correct.
      setSets((prevSets) =>
        prevSets.map((r) => ({
          ...r,
          weight: convertWeightStr(r.weight, prev, next),
          weightSuggested: convertWeightStr(r.weightSuggested, prev, next),
        }))
      );
      return next;
    });
  }

  // Per-machine weight unit: instant read from cache, then reconcile with DB
  // (in case the user set the unit on another device).
  useEffect(() => {
    changeUnit(getCachedExerciseUnit(effectiveNormalized));
    let cancelled = false;
    getExerciseUnit(effectiveNormalized)
      .then((u) => {
        if (!cancelled) changeUnit(u);
      })
      .catch(() => {
        // Best-effort — fall back to the cached value.
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveNormalized]);

  function handleSelectUnit(next: MachineUnit) {
    if (next === unit) return;
    changeUnit(next);
    setExerciseUnit(effectiveNormalized, next).catch(() => {
      // localStorage cache already updated by setExerciseUnit; ignore DB error.
    });
  }

  function setRestSeconds(s: number) {
    setRestSecondsState(s);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('reps.restSeconds', String(s));
    }
    // Fire-and-forget — persists the per-exercise preference.
    updatePlanExerciseRest(exercise.id, s).catch(() => {
      // Ignore; localStorage still keeps the value for this session.
    });
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

  // Start each new rest expanded, even if the previous one was minimised.
  useEffect(() => {
    if (restEndsAt != null) setRestMinimised(false);
  }, [restEndsAt]);

  // Tick for rest timer + buzz/beep at zero
  useEffect(() => {
    if (restEndsAt == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    const remaining = restEndsAt - Date.now();
    const fireAt = Math.max(0, remaining);
    const buzz = window.setTimeout(() => {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try {
          navigator.vibrate([400, 120, 400, 120, 400]);
        } catch {
          // ignore
        }
      }
      playRestDoneBeep();
    }, fireAt);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(buzz);
    };
  }, [restEndsAt]);

  useEffect(() => {
    if (!renameOpen) return;
    let mounted = true;
    getActivePlan()
      .then((plan) => {
        if (!mounted || !plan) return;
        const list: SimilarityCandidate[] = [];
        for (const day of plan.training_days ?? []) {
          for (const ex of day.plan_exercises ?? []) {
            list.push({ name: ex.name, normalizedName: ex.normalized_name });
          }
        }
        setRenameCandidates(list);
      })
      .catch(() => {
        // Suggestion is best-effort — if the plan fails to load, fall back
        // to the existing rename flow without a suggestion.
      });
    return () => {
      mounted = false;
    };
  }, [renameOpen]);

  // Load existing sets for this exercise + last session's sets
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    Promise.all([
      getSessionSets(sessionId, exercise.id, effectiveNormalized),
      getLastSessionSetsForExercise(
        effectiveNormalized,
        sessionId,
        effectiveBaselineResetAt
      ),
    ])
      .then(([existing, last]) => {
        if (!mounted) return;
        setLastSets(last);
        // Read the latest unit (may have been reconciled to a different
        // value by the DB after this effect kicked off).
        const u = unitRef.current;
        const initial = buildInitialSets(
          exercise.total_sets ?? 1,
          exercise.rep_range,
          last,
          exercise.notes ?? '',
          u
        );
        // Mark as completed any rows already logged in this session. The DB
        // stores kg, so convert to the active unit for display.
        for (const s of existing) {
          const idx = initial.findIndex(
            (x) => x.setIndex === s.set_index && x.dropIndex === s.drop_index
          );
          if (idx >= 0) {
            initial[idx] = {
              ...initial[idx],
              weight:
                s.weight != null ? String(fromKg(s.weight, u)) : initial[idx].weight,
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
    effectiveNormalized,
    effectiveBaselineResetAt,
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

  async function handleSavePersonal() {
    const trimmed = personalDraft.trim();
    setPersonalSaving(true);
    try {
      await updatePlanExercisePersonalNote(
        exercise.id,
        trimmed === '' ? null : trimmed
      );
      setSavedPersonal(trimmed);
      setPersonalDraft(trimmed);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save notes');
    } finally {
      setPersonalSaving(false);
    }
  }

  async function handleClearPersonal() {
    setPersonalSaving(true);
    try {
      await updatePlanExercisePersonalNote(exercise.id, null);
      setSavedPersonal('');
      setPersonalDraft('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not clear notes');
    } finally {
      setPersonalSaving(false);
    }
  }

  async function handleSaveCoach() {
    const trimmed = coachDraft.trim();
    setCoachSaving(true);
    try {
      const scheme = detectSetScheme(trimmed, exercise.rep_range);
      await updatePlanExerciseNotes(
        exercise.id,
        trimmed === '' ? null : trimmed,
        scheme
      );
      setSavedCoach(trimmed);
      setCoachDraft(trimmed);
      clearHomeCache();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save coach notes');
    } finally {
      setCoachSaving(false);
    }
  }

  async function handleClearCoach() {
    setCoachSaving(true);
    try {
      const scheme = detectSetScheme('', exercise.rep_range);
      await updatePlanExerciseNotes(exercise.id, null, scheme);
      setSavedCoach('');
      setCoachDraft('');
      clearHomeCache();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not clear coach notes');
    } finally {
      setCoachSaving(false);
    }
  }

  async function handleSwap(result: SwapResult) {
    const { name, normalizedName, isNew, scope } = result;
    if (scope === 'plan') {
      try {
        // New exercise → baseline fresh; existing machine → keep its history.
        const baseline = await swapPlanExerciseIdentity(
          exercise.id,
          name,
          normalizedName,
          { resetBaseline: isNew }
        );
        setEffectiveBaselineResetAt(baseline);
      } catch (e) {
        console.error(e);
        setError('Could not swap the machine. Try again.');
        return;
      }
    } else {
      // One-off: nothing persisted to the plan. A brand-new machine has no
      // history, so baseline at now; an existing machine shows its full history.
      setEffectiveBaselineResetAt(isNew ? new Date().toISOString() : null);
    }
    setError(null);
    setDisplayName(name);
    // Changing the effective identity re-runs the load effect, re-prefilling
    // "last time" from the swapped machine (or empty for a new one).
    setEffectiveNormalized(normalizedName);
    setSwapOpen(false);
  }

  async function handleComplete(idx: number) {
    const set = sets[idx];
    const weightStr = set.weight.trim();
    const repsStr = set.reps.trim();
    const weightNum = weightStr === '' ? NaN : parseFloat(weightStr);
    const repsNum = repsStr === '' ? NaN : parseInt(repsStr, 10);
    if (weightStr === '' || repsStr === '' || Number.isNaN(weightNum) || Number.isNaN(repsNum)) {
      setError(`Enter both weight and reps (use 0 ${unit} for body weight)`);
      triggerShake(idx);
      return;
    }
    if (repsNum > 100) {
      setError('Reps capped at 100 — check the number');
      triggerShake(idx);
      return;
    }
    // DB stores kg always; convert from the active display unit at the boundary.
    const weightKg = toKg(weightNum, unit);
    setError(null);
    setSavingIdx(idx);
    const isEdit = !!set.loggedId;
    try {
      if (set.loggedId) {
        await updateLoggedSet(set.loggedId, { weight: weightKg, reps: repsNum });
        update(idx, { completed: true });
      } else {
        const logged = await logSet({
          sessionId,
          planExerciseId: exercise.id,
          exerciseDisplayName: displayName,
          exerciseNormalizedName: effectiveNormalized,
          setIndex: set.setIndex,
          dropIndex: set.dropIndex,
          weight: weightKg,
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
          large={false}
          title={`${exerciseIndex + 1} / ${totalExercises}`}
          onBack={hasPrev ? onPrev : onBack}
          rightAction={
            <ExerciseMenu
              hasNext={hasNext}
              onSkip={hasNext ? onNext : onFinish}
              onOverview={onOverview}
              onHome={onHome}
              onEndWorkout={onEndWorkout}
              onSwap={() => setSwapOpen(true)}
              onEditName={() => setRenameOpen(true)}
              onAddAlternative={() => setAddAltOpen(true)}
              weightUnit={unit}
              onSelectUnit={handleSelectUnit}
            />
          }
          bottomSlot={
            <WorkoutProgressBar
              value={
                totalExercises > 0
                  ? (exerciseIndex +
                      (sets.length > 0
                        ? sets.filter((s) => s.completed).length / sets.length
                        : 0)) /
                    totalExercises
                  : 0
              }
            />
          }
        />

        <div className="mt-4">
          <a
            href={googleImagesUrl(displayName)}
            target="_blank"
            rel="noopener noreferrer"
            className="block break-words text-[24px] font-bold leading-tight tracking-tight text-ink underline-offset-2 active:underline"
            style={{ textWrap: 'balance' } as React.CSSProperties}
          >
            {displayName}
          </a>
          <div className="mt-1 text-sm text-muted">{exercise.body_part}</div>
        </div>

        {alternatives.length > 0 && (
          <AlternativeSwitcher
            primaryName={exercise.name}
            alternatives={alternatives}
            activeAltId={activeAltId}
            onSelect={selectIdentity}
            onAdd={() => setAddAltOpen(true)}
            onRemove={handleRemoveAlternative}
          />
        )}

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
          <LastTimeRow lastSets={lastSets} lastTopSet={lastTopSet} unit={unit} />
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
                unit={unit}
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

        <div className="mt-7 border-t border-line">
          <button
            onClick={() => setNotesOpen((v) => !v)}
            className="flex w-full items-center justify-between py-4 text-left active:opacity-60"
          >
            <span className="flex items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.12em] text-ink">
              <NotesIcon />
              Coach notes
              {savedCoach && (
                <span
                  className="ml-1 h-1.5 w-1.5 rounded-full bg-ink"
                  aria-hidden
                />
              )}
            </span>
            <Chevron rotate={notesOpen ? 90 : 0} />
          </button>
          {notesOpen && (
            <div className="pb-4">
              <textarea
                value={coachDraft}
                onChange={(e) => setCoachDraft(e.target.value)}
                maxLength={2000}
                rows={4}
                placeholder="Trainer's instructions for this exercise…"
                className="w-full resize-y rounded-xl border border-line bg-paper-card px-3 py-2.5 text-sm leading-relaxed text-ink focus:border-ink focus:outline-none"
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={handleSaveCoach}
                  disabled={
                    coachSaving ||
                    coachDraft.trim() === savedCoach.trim()
                  }
                  className="rounded-pill bg-ink px-4 py-2 text-xs font-semibold text-white active:opacity-80 disabled:opacity-40"
                >
                  {coachSaving ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={handleClearCoach}
                  disabled={
                    coachSaving ||
                    (savedCoach === '' && coachDraft === '')
                  }
                  className="rounded-pill border border-line bg-paper-card px-4 py-2 text-xs font-semibold text-ink active:bg-line/40 disabled:opacity-40"
                >
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-line">
          <button
            onClick={() => setPersonalOpen((v) => !v)}
            className="flex w-full items-center justify-between py-4 text-left active:opacity-60"
          >
            <span className="flex items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.12em] text-ink">
              <NotesIcon />
              My notes
              {savedPersonal && (
                <span
                  className="ml-1 h-1.5 w-1.5 rounded-full bg-ink"
                  aria-hidden
                />
              )}
            </span>
            <Chevron rotate={personalOpen ? 90 : 0} />
          </button>
          {personalOpen && (
            <div className="pb-4">
              <textarea
                value={personalDraft}
                onChange={(e) => setPersonalDraft(e.target.value)}
                maxLength={2000}
                rows={4}
                placeholder="Form cues, machine settings, weekly tweaks…"
                className="w-full resize-y rounded-xl border border-line bg-paper-card px-3 py-2.5 text-sm leading-relaxed text-ink focus:border-ink focus:outline-none"
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={handleSavePersonal}
                  disabled={
                    personalSaving ||
                    personalDraft.trim() === savedPersonal.trim()
                  }
                  className="rounded-pill bg-ink px-4 py-2 text-xs font-semibold text-white active:opacity-80 disabled:opacity-40"
                >
                  {personalSaving ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={handleClearPersonal}
                  disabled={
                    personalSaving ||
                    (savedPersonal === '' && personalDraft === '')
                  }
                  className="rounded-pill border border-line bg-paper-card px-4 py-2 text-xs font-semibold text-ink active:bg-line/40 disabled:opacity-40"
                >
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>

        {allDone && (
          <Improvements
            sets={sets}
            lastSets={lastSets}
            repRange={exercise.rep_range}
            seed={`${sessionId}:${exercise.id}`}
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

      {USE_REST_OVERLAY && restActive && !restMinimised && (
        <RestOverlay
          dayName={dayName ?? exercise.body_part ?? 'Rest'}
          sessionStartedAt={sessionStartedAt ?? null}
          remainingMs={restRemainingMs}
          totalMs={restSeconds * 1000}
          restSeconds={restSeconds}
          onSetRestSeconds={(s) => {
            setRestSeconds(s);
            if (restEndsAt != null) {
              setRestEndsAt(Date.now() + s * 1000);
            }
          }}
          onAdd={() => setRestEndsAt((t) => (t ?? Date.now()) + 15000)}
          onSubtract={() =>
            setRestEndsAt((t) => {
              if (t == null) return t;
              const next = t - 15000;
              return next <= Date.now() ? null : next;
            })
          }
          onSkip={() => setRestEndsAt(null)}
          onMinimise={() => setRestMinimised(true)}
          nextSetName={nextSet ? displayName : null}
          nextSetWeight={nextSet?.weight ?? ''}
          nextSetReps={nextSet?.reps ?? ''}
          unit={unit}
          lastSetWeight={nextSetLastMatch?.weight ?? null}
          lastSetReps={nextSetLastMatch?.reps ?? null}
        />
      )}

      {USE_REST_OVERLAY && restActive && restMinimised && (
        <MiniRestBar
          remainingMs={restRemainingMs}
          totalMs={restSeconds * 1000}
          onExpand={() => setRestMinimised(false)}
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
      {swapOpen && (
        <SwapMachineModal
          bodyPart={exercise.body_part}
          currentNormalized={effectiveNormalized}
          onCancel={() => setSwapOpen(false)}
          onConfirm={handleSwap}
        />
      )}
      {addAltOpen && (
        <AddAlternativeModal
          bodyPart={exercise.body_part}
          excludeNormalized={[
            exercise.normalized_name,
            ...alternatives.map((a) => a.normalized_name),
          ]}
          onCancel={() => setAddAltOpen(false)}
          onConfirm={handleAddAlternative}
        />
      )}
      {renameOpen && (
        <RenameExerciseModal
          initialName={displayName}
          onCancel={() => setRenameOpen(false)}
          onConfirm={async (newName, resetBaseline) => {
            const match = findCloseMatch(
              newName,
              renameCandidates,
              exercise.normalized_name
            );
            if (match) {
              setSuggestion({ candidate: match, typedName: newName, resetBaseline });
              return;
            }
            let newBaseline: string | null;
            try {
              newBaseline = await updatePlanExerciseName(exercise.id, newName, {
                resetBaseline,
              });
            } catch (e) {
              console.error(e);
              setError('Could not save the new name. Try again.');
              return;
            }
            setDisplayName(newName);
            // Re-baseline: drive the new timestamp into the effective identity so
            // the load effect re-runs and rebuilds the set rows with a blank
            // weight (new machine, no history) while keeping the rep-range reps.
            if (resetBaseline) setEffectiveBaselineResetAt(newBaseline);
            setRenameOpen(false);
          }}
        />
      )}
      {suggestion && (
        <DidYouMeanModal
          typedName={suggestion.typedName}
          candidateName={suggestion.candidate.name}
          onCancel={() => setSuggestion(null)}
          onKeepTyped={async () => {
            const { typedName, resetBaseline } = suggestion;
            let newBaseline: string | null;
            try {
              newBaseline = await updatePlanExerciseName(exercise.id, typedName, {
                resetBaseline,
              });
            } catch (e) {
              console.error(e);
              setError('Could not save the new name. Try again.');
              return;
            }
            setDisplayName(typedName);
            if (resetBaseline) setEffectiveBaselineResetAt(newBaseline);
            setSuggestion(null);
            setRenameOpen(false);
          }}
          onMerge={async () => {
            const target = suggestion.candidate;
            const targetNormalized = normalizeExerciseName(target.name);
            try {
              await mergeExerciseIntoIdentity(
                exercise.id,
                target.name,
                targetNormalized
              );
            } catch (e) {
              console.error(e);
              setError('Could not merge with the suggested exercise. Try again.');
              return;
            }
            setDisplayName(target.name);
            setEffectiveNormalized(targetNormalized);
            try {
              const merged = await getLastSessionSetsForExercise(
                targetNormalized,
                sessionId,
                effectiveBaselineResetAt
              );
              setLastSets(merged);
            } catch {
              setLastSets([]);
            }
            setSuggestion(null);
            setRenameOpen(false);
          }}
        />
      )}
    </div>
  );
}

function ExerciseMenu({
  hasNext,
  onSkip,
  onOverview,
  onHome,
  onEndWorkout,
  onSwap,
  onEditName,
  onAddAlternative,
  weightUnit,
  onSelectUnit,
}: {
  hasNext: boolean;
  onSkip: () => void;
  onOverview: () => void;
  onHome: () => void;
  onEndWorkout: () => void;
  onSwap: () => void;
  onEditName: () => void;
  onAddAlternative: () => void;
  weightUnit: MachineUnit;
  onSelectUnit: (u: MachineUnit) => void;
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
        <div className="absolute right-0 top-11 z-40 w-56 overflow-hidden rounded-card border border-line bg-paper-card shadow-card">
          <div className="px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
              Weight unit
            </div>
            <div className="mt-2 flex rounded-pill bg-line p-0.5">
              {(['kg', 'lb', 'pin'] as const).map((u) => (
                <button
                  key={u}
                  onClick={() => pick(() => onSelectUnit(u))}
                  className={`flex-1 rounded-pill px-2 py-1 text-xs font-semibold uppercase tracking-wider ${
                    weightUnit === u ? 'bg-ink text-white' : 'text-muted'
                  }`}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>
          <div className="border-t border-line/60" />
          <button
            onClick={() => pick(onSwap)}
            className="block w-full px-4 py-3 text-left text-sm font-semibold text-ink active:bg-line/40"
          >
            Swap machine
          </button>
          <div className="border-t border-line/60" />
          <button
            onClick={() => pick(onAddAlternative)}
            className="block w-full px-4 py-3 text-left text-sm font-semibold text-ink active:bg-line/40"
          >
            Add alternative
          </button>
          <div className="border-t border-line/60" />
          <button
            onClick={() => pick(onEditName)}
            className="block w-full px-4 py-3 text-left text-sm font-semibold text-ink active:bg-line/40"
          >
            Edit exercise name
          </button>
          <div className="border-t border-line/60" />
          <button
            onClick={() => pick(onSkip)}
            className="block w-full px-4 py-3 text-left text-sm font-semibold text-ink active:bg-line/40"
          >
            {hasNext ? 'Skip exercise' : 'Skip & finish workout'}
          </button>
          <div className="border-t border-line/60" />
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

// Horizontally-scrollable row of pills letting the user flip between the plan's
// primary exercise and any alternatives they've attached to this slot. The
// primary is always first so it reads as the plan default.
function AlternativeSwitcher({
  primaryName,
  alternatives,
  activeAltId,
  onSelect,
  onAdd,
  onRemove,
}: {
  primaryName: string;
  alternatives: ExerciseAlternativeRow[];
  activeAltId: string | null;
  onSelect: (alt: ExerciseAlternativeRow | null) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="mt-3 -mx-5 overflow-x-auto px-5">
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onSelect(null)}
          className={`shrink-0 rounded-pill px-3 py-1.5 text-xs font-semibold transition-colors ${
            activeAltId === null ? 'bg-ink text-white' : 'bg-line text-muted active:text-ink'
          }`}
        >
          {primaryName}
        </button>
        {alternatives.map((alt) => {
          const active = activeAltId === alt.id;
          return (
            <span
              key={alt.id}
              className={`group flex shrink-0 items-center rounded-pill transition-colors ${
                active ? 'bg-ink text-white' : 'bg-line text-muted'
              }`}
            >
              <button
                onClick={() => onSelect(alt)}
                className="py-1.5 pl-3 pr-1.5 text-xs font-semibold active:opacity-80"
              >
                {alt.name}
              </button>
              <button
                onClick={() => onRemove(alt.id)}
                aria-label={`Remove ${alt.name}`}
                className={`mr-1 flex h-5 w-5 items-center justify-center rounded-full text-sm leading-none active:opacity-60 ${
                  active ? 'text-white/70' : 'text-muted'
                }`}
              >
                ×
              </button>
            </span>
          );
        })}
        <button
          onClick={onAdd}
          aria-label="Add alternative"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line text-ink active:bg-line/40"
        >
          +
        </button>
      </div>
    </div>
  );
}

// Adds a new alternative to the slot. Reuses the SwapMachineModal "choose"
// stage — pick an existing tracked machine (pulls its history) or type a new
// movement (starts at zero) — but adding is always a persisted plan-slot
// addition, so there is no one-off/replace scope step.
function AddAlternativeModal({
  bodyPart,
  excludeNormalized,
  onCancel,
  onConfirm,
}: {
  bodyPart: string | null;
  excludeNormalized: string[];
  onCancel: () => void;
  onConfirm: (name: string, normalizedName: string) => void;
}) {
  const [machines, setMachines] = useState<MachineRow[] | null>(null);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    let mounted = true;
    listMachines()
      .then((all) => {
        if (!mounted) return;
        const bp = (bodyPart ?? '').trim().toLowerCase();
        const exclude = new Set(excludeNormalized);
        const filtered = all
          .filter((m) => !exclude.has(m.normalizedName))
          .filter((m) =>
            bp ? (m.bodyPart ?? '').trim().toLowerCase() === bp : true
          )
          .sort((a, b) => a.displayName.localeCompare(b.displayName));
        setMachines(filtered);
      })
      .catch(() => {
        if (mounted) setMachines([]);
      });
    return () => {
      mounted = false;
    };
    // excludeNormalized is rebuilt each render; key off its contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyPart, excludeNormalized.join('|')]);

  const trimmedNew = newName.trim();

  function chooseNew() {
    if (!trimmedNew) return;
    onConfirm(trimmedNew, normalizeExerciseName(trimmedNew));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center"
      onClick={onCancel}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-t-3xl bg-paper p-5 sm:rounded-3xl"
        style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-ink">Add alternative</h2>
        <p className="mt-1 text-xs text-muted">
          A backup movement for when the planned machine is taken. It keeps the
          same tempo and rep range, and you can switch to it any time. The plan
          always defaults back to the original.
        </p>

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
          {machines === null ? (
            <div className="py-6 text-center text-sm text-muted">Loading…</div>
          ) : machines.length === 0 ? (
            <div className="py-2 text-center text-xs text-muted">
              No other machines for this body part yet — add a new exercise
              below.
            </div>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-paper-card">
              {machines.map((m) => (
                <li key={m.normalizedName}>
                  <button
                    onClick={() => onConfirm(m.displayName, m.normalizedName)}
                    className="flex w-full items-center justify-between px-4 py-3 text-left active:bg-line/40"
                  >
                    <span className="text-sm font-semibold text-ink">
                      {m.displayName}
                    </span>
                    {m.setCount > 0 && (
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                        history
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="mt-5 text-[10px] font-semibold uppercase tracking-wider text-muted">
          Add a new exercise
        </p>
        <div className="mt-2 flex items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New exercise name"
            className="min-w-0 flex-1 rounded-xl border border-line bg-paper-card px-3 py-3 text-base text-ink focus:border-ink focus:outline-none"
          />
          <button
            onClick={chooseNew}
            disabled={!trimmedNew}
            className="shrink-0 rounded-pill bg-ink px-4 py-3 text-sm font-semibold text-white disabled:opacity-40 active:opacity-80"
          >
            Add
          </button>
        </div>

        <button
          onClick={onCancel}
          className="mt-4 w-full rounded-pill py-3 text-sm font-semibold text-muted active:text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

interface SwapResult {
  name: string;
  normalizedName: string;
  isNew: boolean;
  scope: 'plan' | 'oneoff';
}

function SwapMachineModal({
  bodyPart,
  currentNormalized,
  onCancel,
  onConfirm,
}: {
  bodyPart: string | null;
  currentNormalized: string;
  onCancel: () => void;
  onConfirm: (result: SwapResult) => void;
}) {
  const [stage, setStage] = useState<'choose' | 'scope'>('choose');
  const [machines, setMachines] = useState<MachineRow[] | null>(null);
  const [newName, setNewName] = useState('');
  const [pending, setPending] = useState<{
    name: string;
    normalizedName: string;
    isNew: boolean;
  } | null>(null);

  // Load the user's machines for this body part (case-insensitive), excluding
  // the one currently in the slot. Best-effort — on failure show an empty list
  // and let the user add a new exercise instead.
  useEffect(() => {
    let mounted = true;
    listMachines()
      .then((all) => {
        if (!mounted) return;
        const bp = (bodyPart ?? '').trim().toLowerCase();
        const filtered = all
          .filter((m) => m.normalizedName !== currentNormalized)
          .filter((m) =>
            bp ? (m.bodyPart ?? '').trim().toLowerCase() === bp : true
          )
          .sort((a, b) => a.displayName.localeCompare(b.displayName));
        setMachines(filtered);
      })
      .catch(() => {
        if (mounted) setMachines([]);
      });
    return () => {
      mounted = false;
    };
  }, [bodyPart, currentNormalized]);

  const trimmedNew = newName.trim();

  function chooseExisting(m: MachineRow) {
    setPending({
      name: m.displayName,
      normalizedName: m.normalizedName,
      isNew: false,
    });
    setStage('scope');
  }

  function chooseNew() {
    if (!trimmedNew) return;
    setPending({
      name: trimmedNew,
      normalizedName: normalizeExerciseName(trimmedNew),
      isNew: true,
    });
    setStage('scope');
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center"
      onClick={onCancel}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-t-3xl bg-paper p-5 sm:rounded-3xl"
        style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))' }}
        onClick={(e) => e.stopPropagation()}
      >
        {stage === 'choose' ? (
          <>
            <h2 className="text-base font-semibold text-ink">Swap machine</h2>
            <p className="mt-1 text-xs text-muted">
              Pick another {bodyPart ? `${bodyPart.toLowerCase()} ` : ''}machine,
              or add a brand-new exercise.
            </p>

            <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
              {machines === null ? (
                <div className="py-6 text-center text-sm text-muted">Loading…</div>
              ) : machines.length === 0 ? (
                <div className="py-2 text-center text-xs text-muted">
                  No other machines for this body part yet — add a new exercise
                  below.
                </div>
              ) : (
                <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-paper-card">
                  {machines.map((m) => (
                    <li key={m.normalizedName}>
                      <button
                        onClick={() => chooseExisting(m)}
                        className="flex w-full items-center justify-between px-4 py-3 text-left active:bg-line/40"
                      >
                        <span className="text-sm font-semibold text-ink">
                          {m.displayName}
                        </span>
                        {m.setCount > 0 && (
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                            history
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <p className="mt-5 text-[10px] font-semibold uppercase tracking-wider text-muted">
              Add a new exercise
            </p>
            <div className="mt-2 flex items-center gap-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="New exercise name"
                className="min-w-0 flex-1 rounded-xl border border-line bg-paper-card px-3 py-3 text-base text-ink focus:border-ink focus:outline-none"
              />
              <button
                onClick={chooseNew}
                disabled={!trimmedNew}
                className="shrink-0 rounded-pill bg-ink px-4 py-3 text-sm font-semibold text-white disabled:opacity-40 active:opacity-80"
              >
                Add
              </button>
            </div>

            <button
              onClick={onCancel}
              className="mt-4 w-full rounded-pill py-3 text-sm font-semibold text-muted active:text-ink"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <h2 className="text-base font-semibold text-ink">
              Swap to “{pending?.name}”
            </h2>
            <p className="mt-1 text-xs text-muted">
              {pending?.isNew
                ? 'New exercise — it starts fresh and baselines from this workout.'
                : "Pulls up that machine's own history so you can pick up where you left off."}
            </p>
            <p className="mt-5 text-[10px] font-semibold uppercase tracking-wider text-muted">
              Is this a one-off?
            </p>
            <div className="mt-2 grid gap-2">
              <button
                onClick={() =>
                  pending && onConfirm({ ...pending, scope: 'plan' })
                }
                className="w-full rounded-pill bg-ink py-3 text-sm font-semibold text-white active:opacity-80"
              >
                Update the workout plan
              </button>
              <button
                onClick={() =>
                  pending && onConfirm({ ...pending, scope: 'oneoff' })
                }
                className="w-full rounded-pill border border-line bg-paper-card py-3 text-sm font-semibold text-ink active:bg-line/40"
              >
                Just this workout
              </button>
              <button
                onClick={() => {
                  setPending(null);
                  setStage('choose');
                }}
                className="w-full rounded-pill py-3 text-sm font-semibold text-muted active:text-ink"
              >
                Back
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function RenameExerciseModal({
  initialName,
  onCancel,
  onConfirm,
}: {
  initialName: string;
  onCancel: () => void;
  onConfirm: (newName: string, resetBaseline: boolean) => void;
}) {
  const [name, setName] = useState(initialName);
  const trimmed = name.trim();
  const valid = trimmed.length > 0 && trimmed !== initialName.trim();

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-t-3xl bg-paper p-5 sm:rounded-3xl"
        style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-ink">Edit exercise name</h2>
        <p className="mt-1 text-xs text-muted">
          Renames this exercise across your plan.
        </p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-4 w-full rounded-xl border border-line bg-paper-card px-3 py-3 text-base text-ink focus:border-ink focus:outline-none"
        />
        <p className="mt-5 text-[10px] font-semibold uppercase tracking-wider text-muted">
          Is this the same machine?
        </p>
        <div className="mt-2 grid gap-2">
          <button
            onClick={() => onConfirm(trimmed, false)}
            disabled={!valid}
            className="w-full rounded-pill bg-ink py-3 text-sm font-semibold text-white disabled:opacity-40 active:opacity-80"
          >
            Same machine — keep history
          </button>
          <button
            onClick={() => onConfirm(trimmed, true)}
            disabled={!valid}
            className="w-full rounded-pill border border-line bg-paper-card py-3 text-sm font-semibold text-ink disabled:opacity-40 active:bg-line/40"
          >
            Different machine — reset to baseline
          </button>
          <button
            onClick={onCancel}
            className="w-full rounded-pill py-3 text-sm font-semibold text-muted active:text-ink"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function DidYouMeanModal({
  typedName,
  candidateName,
  onCancel,
  onKeepTyped,
  onMerge,
}: {
  typedName: string;
  candidateName: string;
  onCancel: () => void;
  onKeepTyped: () => void;
  onMerge: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-t-3xl bg-paper p-5 sm:rounded-3xl"
        style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-ink">Did you mean…?</h2>
        <p className="mt-1 text-xs text-muted">
          Looks like you already have an exercise with a similar name.
        </p>

        <label className="mt-4 flex items-start gap-3 rounded-xl border border-line bg-paper-card px-3 py-3">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-ink"
          />
          <span className="text-sm text-ink">
            Yes, this is the same as{' '}
            <span className="font-semibold">{candidateName}</span>.
          </span>
        </label>

        <div className="mt-5 grid gap-2">
          <button
            onClick={onMerge}
            disabled={!confirmed}
            className="w-full rounded-pill bg-ink py-3 text-sm font-semibold text-white disabled:opacity-40 active:opacity-80"
          >
            Use “{candidateName}” and merge history
          </button>
          <button
            onClick={onKeepTyped}
            className="w-full rounded-pill border border-line bg-paper-card py-3 text-sm font-semibold text-ink active:bg-line/40"
          >
            No — keep “{typedName}”
          </button>
          <button
            onClick={onCancel}
            className="w-full rounded-pill py-3 text-sm font-semibold text-muted active:text-ink"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function LastTimeRow({
  lastSets,
  lastTopSet,
  unit,
}: {
  lastSets: LoggedSet[];
  lastTopSet: LoggedSet;
  unit: MachineUnit;
}) {
  const [open, setOpen] = useState(false);
  const groups: { setIndex: number; rows: LoggedSet[] }[] = [];
  for (const s of [...lastSets].sort(
    (a, b) => a.set_index - b.set_index || a.drop_index - b.drop_index
  )) {
    const tail = groups[groups.length - 1];
    if (tail && tail.setIndex === s.set_index) tail.rows.push(s);
    else groups.push({ setIndex: s.set_index, rows: [s] });
  }
  const fmt = (s: LoggedSet) =>
    `${s.weight != null ? `${fromKg(s.weight, unit)} ${unit}` : '–'} × ${s.reps ?? '–'}`;

  return (
    <div className="mt-4 overflow-hidden rounded-xl bg-paper-card shadow-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3.5 py-2.5 text-left active:bg-line/40"
      >
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
          Last time
        </span>
        <span className="flex items-center gap-2 text-xs font-medium text-ink">
          <span>
            {lastSets.length} sets · top{' '}
            {lastTopSet.weight != null
              ? `${fromKg(lastTopSet.weight, unit)} ${unit}`
              : '–'}{' '}
            × {lastTopSet.reps ?? '–'}
          </span>
          <Chevron rotate={open ? 90 : 0} />
        </span>
      </button>
      {open && (
        <div className="border-t border-line px-3.5 py-2.5">
          <ul className="space-y-1">
            {groups.map((g) => (
              <li key={g.setIndex} className="text-xs text-ink">
                {g.rows.map((r, i) =>
                  i === 0 ? (
                    <div key={r.id} className="flex justify-between">
                      <span className="font-semibold text-muted">Set {g.setIndex}</span>
                      <span>{fmt(r)}</span>
                    </div>
                  ) : (
                    <div key={r.id} className="flex justify-between pl-3 text-muted">
                      <span>↳ drop</span>
                      <span>{fmt(r)}</span>
                    </div>
                  )
                )}
              </li>
            ))}
          </ul>
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
  unit,
  onChange,
  onComplete,
  onEdit,
  onOpenCalculator,
}: {
  rows: { row: SetState; idx: number }[];
  activeIndex: number;
  savingIdx: number | null;
  shakeIdx: number | null;
  unit: MachineUnit;
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
              placeholder={unit}
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
  onMinimise,
  nextSetName,
  nextSetWeight,
  nextSetReps,
  unit,
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
  onMinimise: () => void;
  nextSetName: string | null;
  nextSetWeight: string;
  nextSetReps: string;
  unit: MachineUnit;
  lastSetWeight: number | null;
  lastSetReps: number | null;
}) {
  useThemeColor('#0A0A0A');
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
      <div
        className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 pt-3"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
      >
        <div className="relative flex items-center justify-center py-2">
          <div className="text-base font-semibold tracking-tight">Rest</div>
          <button
            onClick={onMinimise}
            aria-label="Minimise rest timer"
            className="absolute right-0 flex h-11 w-11 items-center justify-center rounded-full text-white/80 active:bg-white/10 active:text-white"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path
                d="M6 9l6 6 6-6"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
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
                  {nextSetWeight || '–'} {unit} × {nextSetReps || '–'}
                </div>
              )}
            </div>
          )}

          <div className="mt-5 flex flex-col items-center">
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

function MiniRestBar({
  remainingMs,
  totalMs,
  onExpand,
}: {
  remainingMs: number;
  totalMs: number;
  onExpand: () => void;
}) {
  const seconds = Math.ceil(remainingMs / 1000);
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const progress = Math.min(1, Math.max(0, remainingMs / totalMs));
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4"
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
    >
      <button
        onClick={onExpand}
        aria-label="Expand rest timer"
        className="pointer-events-auto relative flex items-center gap-3 overflow-hidden rounded-pill bg-[#0A0A0A] py-2 pl-4 pr-3 text-white shadow-card active:opacity-80"
      >
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/60">
          Rest
        </span>
        <span className="font-mono text-base font-bold tabular-nums">
          {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
        </span>
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path
              d="M6 15l6-6 6 6"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-[2px] bg-white/70"
          style={{ width: `${progress * 100}%`, transition: 'width 250ms linear' }}
        />
      </button>
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
    <div className="h-px w-full overflow-hidden bg-line/60">
      <div
        className="h-full bg-ink"
        style={{
          width: `${pct}%`,
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
  sets,
  lastSets,
  repRange,
  seed,
}: {
  sets: SetState[];
  lastSets: LoggedSet[];
  repRange: string;
  seed: string;
}) {
  const kudos = buildKudos({ thisSets: sets, lastSets, repRange, seed });
  return (
    <div className="mt-7 rounded-card bg-paper-card p-5 shadow-card">
      <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
        {kudos.label}
      </div>
      <div className="mt-1 text-lg font-bold leading-snug tracking-tight text-ink">
        {kudos.headline}
      </div>
      {kudos.detail && <div className="mt-1 text-sm text-muted">{kudos.detail}</div>}
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
