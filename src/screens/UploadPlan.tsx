import { useEffect, useMemo, useState } from 'react';
import { extractPdfText } from '../lib/extractPdfText';
import {
  parseTrainingPlan,
  type ParsedExercise,
  type ParsedPlan,
  type WeeklyAlternative,
} from '../lib/parseTrainingPlan';
import { parseSetMods } from '../lib/parseSetMods';
import { rotationWeeks, savePlan } from '../lib/plansApi';
import { listMachines } from '../lib/machinesApi';
import { normalizeExerciseName } from '../lib/normalizeExerciseName';
import { restLabel, restSecondsForExercises } from '../lib/restDefaults';
import { formatNameList, groupedSetLabel } from '../lib/supersets';
import { PageHeader } from '../components/PageHeader';
import { DayEditorSheet, ExerciseEditorSheet } from '../components/PlanRepairSheets';
import {
  EMPTY_DRAFT,
  buildExercise,
  draftFromExercise,
  guessDraftFromText,
  newDay,
  normalizePositions,
  planProblems,
  splitUnparsed,
  withUids,
  type ExerciseDraft,
} from '../lib/planRepair';

/** Stable identity for a row while it's being edited (see planRepair.withUids). */
const keyOf = (e: ParsedExercise): string => e.uid ?? `${e.name}#${e.position}`;

type EditorState =
  | null
  | { mode: 'edit'; dayIdx: number; exIdx: number }
  | { mode: 'new'; dayIdx: number; prefill?: ExerciseDraft; sourceRaw?: string };

function parseTargetReps(repRange: string): number | null {
  const match = repRange.match(/(\d+)\s*(?:-\s*(\d+))?/);
  if (!match) return null;
  const hi = match[2] ? parseInt(match[2], 10) : parseInt(match[1], 10);
  return Number.isFinite(hi) ? hi : null;
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 2)
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

type PreviousExercise = {
  name: string;
  normalizedName: string;
  // How many sets you've logged on it, used to break ties between equally
  // similar candidates — the machine you actually train is the likelier match.
  setCount: number;
};
type MatchKind = 'exact' | 'fuzzy' | 'none';
type Match = {
  kind: MatchKind;
  candidate?: PreviousExercise;
  decision: 'pending' | 'same' | 'different';
};

const FUZZY_THRESHOLD = 0.5;

function computeMatch(
  ex: ParsedExercise,
  previous: PreviousExercise[]
): Match {
  if (previous.length === 0) return { kind: 'none', decision: 'pending' };
  const exact = previous.find((p) => p.normalizedName === ex.normalizedName);
  if (exact) return { kind: 'exact', candidate: exact, decision: 'same' };
  const newTokens = tokenize(ex.name);
  let best: { p: PreviousExercise; score: number } | null = null;
  for (const p of previous) {
    const score = jaccard(newTokens, tokenize(p.name));
    if (!best || score > best.score) {
      best = { p, score };
    } else if (score === best.score && p.setCount > best.p.setCount) {
      // Matching against your whole history means near-ties are more common
      // than they were against a single plan; prefer the better-used machine.
      best = { p, score };
    }
  }
  if (best && best.score >= FUZZY_THRESHOLD) {
    return { kind: 'fuzzy', candidate: best.p, decision: 'pending' };
  }
  return { kind: 'none', decision: 'pending' };
}

// An exercise "carries history" when it's been tied to a machine from the previous
// plan — either an exact name match, or a fuzzy match the user confirmed is the same
// machine. Those are the only exercises where keep-vs-reset is a meaningful choice.
function carriesHistory(match?: Match): boolean {
  if (!match) return false;
  return (
    match.kind === 'exact' || (match.kind === 'fuzzy' && match.decision === 'same')
  );
}

interface Props {
  onCancel: () => void;
  onSaved: () => void;
}

export function UploadPlan({ onCancel, onSaved }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [planName, setPlanName] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedPlan | null>(null);
  // The rest each exercise will be saved with, keyed "dayIdx:exIdx" — the same
  // figures savePlan writes, so the review screen shows what you're getting.
  // Recomputed when notes are edited here, since notes can name a rest.
  const restByKey = useMemo(() => {
    const map = new Map<string, number>();
    parsed?.days.forEach((day) => {
      restSecondsForExercises(
        day.exercises.map((e) => ({
          name: e.name,
          notes: e.notes,
          supersetGroup: e.supersetGroup ?? null,
        }))
      ).forEach((rest, exIdx) => map.set(keyOf(day.exercises[exIdx]), rest));
    });
    return map;
  }, [parsed]);
  const [rawText, setRawText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previousExercises, setPreviousExercises] = useState<PreviousExercise[]>([]);
  const [matches, setMatches] = useState<Map<string, Match>>(new Map());
  // The bulk keep/reset choice covers almost everyone, so the per-machine
  // controls stay hidden until asked for — a row shows a quiet status line
  // instead of a control it doesn't need.
  const [adjustHistoryOpen, setAdjustHistoryOpen] = useState(false);
  // The repair sheets: fixing a row the parser got wrong, or a day's name/week.
  const [editor, setEditor] = useState<EditorState>(null);
  const [dayEditor, setDayEditor] = useState<{ dayIdx: number } | 'new' | null>(null);

  // Keys of carried-over machines whose history is KEPT. Default is empty —
  // every matched machine starts fresh. Uploading a plan means a new block, and
  // the new block's rep ranges rarely suit last block's weights: 6-8 reps at the
  // weight you were pushing for 12 is how people stall or get hurt. Nothing is
  // deleted either way — starting fresh only cuts off the "last time" prefill,
  // and all-time bests are computed from every set ever logged regardless — so
  // tick "Carry over" on anything you'd rather keep rolling.
  const [keepHistory, setKeepHistory] = useState<Set<string>>(new Set());

  // Candidates are every machine you have actually logged sets on, across all
  // plans — not just the plan that happens to be active. The "last time" prefill
  // has always looked at your whole history, so matching only the active plan
  // made the two disagree: a machine in the current plan was reset by default,
  // while one from an older plan silently kept its weights and was never asked
  // about. Machines with no logged sets are left out — there's nothing to carry.
  useEffect(() => {
    let cancelled = false;
    listMachines()
      .then((machines) => {
        if (cancelled) return;
        setPreviousExercises(
          machines
            .filter((m) => m.setCount > 0)
            .map((m) => ({
              name: m.displayName,
              normalizedName: m.normalizedName,
              setCount: m.setCount,
            }))
        );
      })
      .catch(() => {
        // Non-fatal — the matcher just won't surface candidates.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!parsed) {
      setMatches(new Map());
      return;
    }
    const next = new Map<string, Match>();
    for (const day of parsed.days) {
      for (const ex of day.exercises) next.set(keyOf(ex), computeMatch(ex, previousExercises));
    }
    // Any edit on the screen re-runs this, so a decision the user has already
    // made about a row — same machine, different machine — has to survive it.
    setMatches((prev) => {
      const merged = new Map<string, Match>();
      for (const [key, computed] of next) {
        const old = prev.get(key);
        merged.set(
          key,
          old && old.candidate?.normalizedName === computed.candidate?.normalizedName
            ? { ...computed, decision: old.decision }
            : computed
        );
      }
      return merged;
    });
    // Every matched machine starts fresh by default: uploading a plan almost
    // always means a new block, and last block's weight in the box is how you
    // end up chasing a number the new rep range was never meant to hit. Your
    // all-time bests are untouched either way. Choices already made stay;
    // rows that were deleted drop out.
    setKeepHistory((prev) => new Set([...prev].filter((k) => next.has(k))));
  }, [parsed, previousExercises]);

  async function handleFile(f: File) {
    setError(null);
    setParsing(true);
    setFile(f);
    if (!planName) {
      // Default name from filename without extension
      setPlanName(f.name.replace(/\.pdf$/i, ''));
    }
    try {
      const text = await extractPdfText(f);
      setRawText(text);
      const result = parseTrainingPlan(text);
      setParsed(withUids(result));
      setEditor(null);
      setDayEditor(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to parse PDF');
    } finally {
      setParsing(false);
    }
  }

  async function handleSave() {
    if (!parsed || !planName) return;
    setSaving(true);
    setError(null);
    try {
      // Rows may have been added, moved or deleted, so positions are made
      // contiguous first; savePlan keys the history reset by final position.
      const normalized = normalizePositions(parsed);
      const historyResetKeys = new Set<string>();
      for (const d of normalized.days) {
        for (const e of d.exercises) {
          const k = keyOf(e);
          if (historyCarrierKeys.includes(k) && !keepHistory.has(k)) {
            historyResetKeys.add(`${d.position}:${e.position}`);
          }
        }
      }
      await savePlan(normalized, planName, rawText, { historyResetKeys });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save plan');
    } finally {
      setSaving(false);
    }
  }

  function setExerciseNotes(dayIdx: number, exIdx: number, notes: string) {
    setParsed((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        days: prev.days.map((d, i) =>
          i !== dayIdx
            ? d
            : {
                ...d,
                exercises: d.exercises.map((e, j) =>
                  j !== exIdx ? e : { ...e, notes }
                ),
              }
        ),
      };
    });
  }

  // Confirm/tweak or remove the "alternate weeks with X" partner detected from a
  // coach note. Editing the name re-derives its normalized identity so history
  // lines up with the matching movement. Passing null clears it (won't be saved).
  function setExerciseAlternative(
    dayIdx: number,
    exIdx: number,
    alt: WeeklyAlternative | null
  ) {
    setParsed((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        days: prev.days.map((d, i) =>
          i !== dayIdx
            ? d
            : {
                ...d,
                exercises: d.exercises.map((e, j) =>
                  j !== exIdx ? e : { ...e, weeklyAlternative: alt }
                ),
              }
        ),
      };
    });
  }

  function answerSameMachine(dayIdx: number, exIdx: number) {
    const target = parsed?.days[dayIdx]?.exercises[exIdx];
    if (!target) return;
    const key = keyOf(target);
    const match = matches.get(key);
    if (!match || !match.candidate) return;
    const candidate = match.candidate;
    setParsed((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        days: prev.days.map((d, i) =>
          i !== dayIdx
            ? d
            : {
                ...d,
                exercises: d.exercises.map((e, j) =>
                  j !== exIdx ? e : { ...e, normalizedName: candidate.normalizedName }
                ),
              }
        ),
      };
    });
    setMatches((prev) => {
      const next = new Map(prev);
      next.set(key, { ...match, decision: 'same' });
      return next;
    });
    // It's a carried-over machine now, so it takes the same default as the
    // rest: start fresh. The user can still carry it over from the per-machine
    // control, or with "Carry all over".
  }

  function answerDifferentMachine(dayIdx: number, exIdx: number) {
    const target = parsed?.days[dayIdx]?.exercises[exIdx];
    if (!target) return;
    const key = keyOf(target);
    setMatches((prev) => {
      const next = new Map(prev);
      const current = next.get(key);
      if (!current) return prev;
      next.set(key, { ...current, decision: 'different' });
      return next;
    });
    // A different machine has no history to keep — drop any stale keep flag.
    setKeepHistory((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }

  function toggleKeepHistory(dayIdx: number, exIdx: number) {
    const target = parsed?.days[dayIdx]?.exercises[exIdx];
    if (!target) return;
    const key = keyOf(target);
    setKeepHistory((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // --- Repairing the import -------------------------------------------------

  function saveExercise(draft: ExerciseDraft, targetDayIdx: number) {
    const state = editor;
    if (!state) return;
    setParsed((prev) => {
      if (!prev) return prev;
      const days = prev.days.map((d) => ({ ...d, exercises: [...d.exercises] }));
      let unparsedLines = prev.unparsedLines;
      if (state.mode === 'edit') {
        const base = days[state.dayIdx]?.exercises[state.exIdx];
        if (!base) return prev;
        const built = buildExercise(draft, base);
        if (targetDayIdx === state.dayIdx) {
          days[state.dayIdx].exercises[state.exIdx] = built;
        } else {
          // Moved to another day: leaves any superset pairing behind.
          days[state.dayIdx].exercises.splice(state.exIdx, 1);
          days[targetDayIdx]?.exercises.push({
            ...built,
            supersetGroup: null,
            supersetPartnerNames: null,
          });
        }
      } else {
        days[targetDayIdx]?.exercises.push(buildExercise(draft));
        // A line rescued into a row is no longer unparsed.
        if (state.sourceRaw) unparsedLines = unparsedLines.filter((l) => l !== state.sourceRaw);
      }
      return { ...prev, days, unparsedLines };
    });
    setEditor(null);
  }

  function deleteExercise(dayIdx: number, exIdx: number) {
    setParsed((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        days: prev.days.map((d, i) =>
          i !== dayIdx ? d : { ...d, exercises: d.exercises.filter((_, j) => j !== exIdx) }
        ),
      };
    });
    setEditor(null);
  }

  function ignoreUnparsed(raw: string) {
    setParsed((prev) =>
      prev ? { ...prev, unparsedLines: prev.unparsedLines.filter((l) => l !== raw) } : prev
    );
  }

  function saveDay(name: string, weekIndex: number | null) {
    const state = dayEditor;
    if (!state) return;
    setParsed((prev) => {
      if (!prev) return prev;
      if (state === 'new') {
        return { ...prev, days: [...prev.days, newDay(name, weekIndex, prev.days.length)] };
      }
      return {
        ...prev,
        days: prev.days.map((d, i) =>
          i !== state.dayIdx ? d : { ...d, name: name.trim(), weekIndex }
        ),
      };
    });
    setDayEditor(null);
  }

  function deleteDay(dayIdx: number) {
    setParsed((prev) =>
      prev ? { ...prev, days: prev.days.filter((_, i) => i !== dayIdx) } : prev
    );
    setDayEditor(null);
  }

  // Lines the parser couldn't place, split into the day they were found under.
  // Ones under a day that no longer exists (renamed, deleted) join the orphans.
  const unparsed = useMemo(
    () => (parsed?.unparsedLines ?? []).map(splitUnparsed),
    [parsed]
  );
  const dayNames = useMemo(() => new Set((parsed?.days ?? []).map((d) => d.name)), [parsed]);
  const orphanLines = unparsed.filter((u) => u.dayName == null || !dayNames.has(u.dayName));
  const problems = parsed ? planProblems(parsed) : [];
  // "No exercises" is a blocker shown by the save button now, not a warning.
  const visibleWarnings = (parsed?.warnings ?? []).filter(
    (w) => !/has no exercises detected/.test(w)
  );
  const planWeeks = useMemo(() => {
    const ws = new Set<number>();
    for (const d of parsed?.days ?? []) if (d.weekIndex != null) ws.add(d.weekIndex);
    return [...ws].sort((a, b) => a - b);
  }, [parsed]);

  // Keys of every exercise tied to a previous machine — the ones a keep/reset choice
  // applies to.
  const historyCarrierKeys: string[] = [];
  for (const [key, m] of matches) {
    if (carriesHistory(m)) historyCarrierKeys.push(key);
  }
  const keptCount = historyCarrierKeys.filter((k) => keepHistory.has(k)).length;
  const resetCount = historyCarrierKeys.length - keptCount;

  const totalExercises =
    parsed?.days.reduce((sum, d) => sum + d.exercises.length, 0) ?? 0;

  // A rotating plan runs one set of days one week and another the next, so the
  // review screen labels which is which.
  const rotates = useMemo(() => rotationWeeks(parsed ?? { days: [], warnings: [], unparsedLines: [] }).length > 1, [parsed]);

  const weeklyAltCount = useMemo(() => {
    if (!parsed) return 0;
    let n = 0;
    for (const d of parsed.days) {
      for (const e of d.exercises) if (e.weeklyAlternative) n += 1;
    }
    return n;
  }, [parsed]);

  const overrideCount = useMemo(() => {
    if (!parsed) return 0;
    let n = 0;
    for (const d of parsed.days) {
      for (const e of d.exercises) {
        const mods = parseSetMods(e.notes ?? '', e.totalSets ?? 0);
        if (mods.bySetIndex.size > 0) n += 1;
      }
    }
    return n;
  }, [parsed]);

  const pendingMatchCount = useMemo(() => {
    let n = 0;
    for (const m of matches.values()) {
      if (m.kind === 'fuzzy' && m.decision === 'pending') n += 1;
    }
    return n;
  }, [matches]);

  return (
    <div className="min-h-screen bg-paper pb-12">
      <div className="mx-auto max-w-md px-5 pt-3">
        <PageHeader title="Upload plan" onBack={onCancel} />

        <p className="mt-6 text-base text-muted">
          Drop in the PDF from your trainer. Reps will turn it into your training days.
        </p>

        {!parsed && (
          <label
            className={`mt-8 flex h-44 cursor-pointer items-center justify-center rounded-card border-2 border-dashed border-line bg-paper-card px-5 text-center transition-colors ${
              parsing ? 'opacity-60' : 'active:border-ink'
            }`}
          >
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              disabled={parsing}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            <div>
              {parsing ? (
                <div className="text-sm text-muted">Reading PDF…</div>
              ) : file ? (
                <>
                  <div className="text-sm font-semibold text-ink">{file.name}</div>
                  <div className="mt-1 text-xs text-muted">Tap to choose a different file</div>
                </>
              ) : (
                <>
                  <UploadIcon />
                  <div className="mt-2 text-sm font-semibold text-ink">
                    Tap to choose a PDF
                  </div>
                  <div className="mt-0.5 text-xs text-muted">Max ~10MB</div>
                </>
              )}
            </div>
          </label>
        )}

        {error && (
          <div className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {parsed && (
          <>
            <div className="mt-8">
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                Plan name
              </label>
              <input
                type="text"
                value={planName}
                onChange={(e) => setPlanName(e.target.value)}
                className="w-full rounded-2xl border border-line bg-paper-card px-4 py-3.5 text-base text-ink focus:border-ink focus:outline-none"
              />
            </div>

            <div className="mt-6 rounded-card bg-paper-card p-5 shadow-card">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                Detected
              </div>
              <div className="mt-1 text-2xl font-bold tracking-tight text-ink">
                {parsed.days.length} {parsed.days.length === 1 ? 'day' : 'days'} ·{' '}
                {totalExercises} {totalExercises === 1 ? 'exercise' : 'exercises'}
              </div>
              {overrideCount > 0 && (
                <div className="mt-3 text-xs text-muted">
                  Coach notes change the set scheme on{' '}
                  <span className="font-semibold text-ink">{overrideCount}</span>{' '}
                  {overrideCount === 1 ? 'exercise' : 'exercises'} below — give them a quick check.
                </div>
              )}
              {pendingMatchCount > 0 && (
                <div className="mt-2 text-xs text-muted">
                  <span className="font-semibold text-ink">{pendingMatchCount}</span>{' '}
                  {pendingMatchCount === 1 ? 'exercise looks' : 'exercises look'} similar to your previous plan — confirm whether it's the same machine.
                </div>
              )}
              {weeklyAltCount > 0 && (
                <div className="mt-2 text-xs text-muted">
                  <span className="font-semibold text-ink">{weeklyAltCount}</span>{' '}
                  {weeklyAltCount === 1 ? 'exercise alternates' : 'exercises alternate'} weekly with another machine — confirm the name below and Reps will offer to rotate it for you.
                </div>
              )}
            </div>

            {historyCarrierKeys.length > 0 && (
              <div className="mt-4 rounded-card bg-paper-card p-5 shadow-card">
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                  Starting fresh
                </div>
                <div className="mt-1 text-sm text-ink">
                  <span className="font-semibold">{historyCarrierKeys.length}</span>{' '}
                  {historyCarrierKeys.length === 1
                    ? "machine matches one you've"
                    : "machines match ones you've"}{' '}
                  trained before. A new plan{' '}
                  <span className="font-semibold">starts them all at zero</span> so you
                  work up to the new rep ranges instead of chasing last block's numbers.
                </div>
                <div className="mt-2 flex items-start gap-2 rounded-2xl bg-paper px-3 py-2.5">
                  <TrophyIcon />
                  <div className="text-xs text-muted">
                    <span className="font-semibold text-ink">
                      Your personal records are safe.
                    </span>{' '}
                    Nothing is ever deleted — starting fresh only clears the weight the
                    logger pre-fills. Every set you've logged stays in your history and
                    your all-time bests on the Performance tab.
                  </div>
                </div>
                <div className="mt-2 text-xs text-muted">
                  Starting fresh on {resetCount} · carrying over {keptCount}.
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => setKeepHistory(new Set())}
                    disabled={keptCount === 0}
                    className="flex-1 rounded-pill border border-line bg-paper py-1.5 text-xs font-semibold text-ink active:bg-line/40 disabled:opacity-40"
                  >
                    Start all fresh
                  </button>
                  <button
                    onClick={() => setKeepHistory(new Set(historyCarrierKeys))}
                    disabled={keptCount === historyCarrierKeys.length}
                    className="flex-1 rounded-pill border border-line bg-paper py-1.5 text-xs font-semibold text-ink active:bg-line/40 disabled:opacity-40"
                  >
                    Carry all over
                  </button>
                </div>
                <button
                  onClick={() => setAdjustHistoryOpen((v) => !v)}
                  className="mt-3 w-full text-center text-xs font-semibold text-muted underline-offset-2 active:text-ink active:underline"
                >
                  {adjustHistoryOpen ? 'Done adjusting' : 'Adjust machine by machine'}
                </button>
              </div>
            )}

            <div className="mt-4 space-y-4">
              {parsed.days.map((day, dayIdx) => (
                <div key={`${day.name}#${dayIdx}`} className="rounded-card bg-paper-card shadow-card">
                  <div className="flex items-start justify-between gap-3 border-b border-line/60 px-5 py-3">
                    <div className="min-w-0">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                        Day {dayIdx + 1}
                        {day.weekIndex != null && ` · Rotation week ${day.weekIndex}`}
                        {day.weekIndex == null && rotates && ' · Every week'}
                      </div>
                      <div className="mt-0.5 truncate text-base font-semibold text-ink">
                        {day.name}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDayEditor({ dayIdx })}
                      className="-mr-2 shrink-0 rounded-pill px-2.5 py-1 text-xs font-semibold text-muted active:text-ink"
                    >
                      Edit day
                    </button>
                  </div>
                  <ul className="divide-y divide-line/60">
                    {day.exercises.map((ex, exIdx) => (
                      <li key={keyOf(ex)}>
                        <ExerciseReviewRow
                          exercise={ex}
                          restSeconds={restByKey.get(keyOf(ex)) ?? null}
                          showHistoryControl={adjustHistoryOpen}
                          match={matches.get(keyOf(ex))}
                          keepHistory={keepHistory.has(keyOf(ex))}
                          onEdit={() => setEditor({ mode: 'edit', dayIdx, exIdx })}
                          onNotesChange={(notes) => setExerciseNotes(dayIdx, exIdx, notes)}
                          onSameMachine={() => answerSameMachine(dayIdx, exIdx)}
                          onDifferentMachine={() => answerDifferentMachine(dayIdx, exIdx)}
                          onToggleKeepHistory={() => toggleKeepHistory(dayIdx, exIdx)}
                          onAlternativeChange={(alt) =>
                            setExerciseAlternative(dayIdx, exIdx, alt)
                          }
                        />
                      </li>
                    ))}
                  </ul>
                  {unparsed
                    .filter((u) => u.dayName === day.name)
                    .map((u) => (
                      <UnreadLineCard
                        key={u.raw}
                        text={u.text}
                        onAdd={() =>
                          setEditor({
                            mode: 'new',
                            dayIdx,
                            prefill: guessDraftFromText(u.text),
                            sourceRaw: u.raw,
                          })
                        }
                        onIgnore={() => ignoreUnparsed(u.raw)}
                      />
                    ))}
                  <button
                    type="button"
                    onClick={() => setEditor({ mode: 'new', dayIdx, prefill: EMPTY_DRAFT })}
                    className="flex w-full items-center justify-center gap-1.5 border-t border-line/60 py-3 text-sm font-semibold text-ink active:bg-line/30"
                  >
                    <PlusIcon /> Add exercise
                  </button>
                </div>
              ))}

              {orphanLines.length > 0 && (
                <div className="rounded-card border border-amber-200 bg-amber-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-800">
                    {orphanLines.length} {orphanLines.length === 1 ? 'line' : 'lines'} not under any day
                  </div>
                  <p className="mt-1 text-xs text-amber-800">
                    These look like exercises but sat under a heading Reps didn't recognise as a
                    day. Add the day they belong to, then add them to it — or ignore them.
                  </p>
                  <ul className="mt-2 space-y-2">
                    {orphanLines.map((u) => (
                      <UnreadLineCard
                        key={u.raw}
                        text={u.text}
                        tone="plain"
                        onAdd={() =>
                          setEditor({
                            mode: 'new',
                            dayIdx: 0,
                            prefill: guessDraftFromText(u.text),
                            sourceRaw: u.raw,
                          })
                        }
                        addDisabled={parsed.days.length === 0}
                        onIgnore={() => ignoreUnparsed(u.raw)}
                      />
                    ))}
                  </ul>
                </div>
              )}

              <button
                type="button"
                onClick={() => setDayEditor('new')}
                className="flex w-full items-center justify-center gap-1.5 rounded-card border border-dashed border-line py-3.5 text-sm font-semibold text-muted active:bg-line/30"
              >
                <PlusIcon /> Add a day
              </button>
            </div>

            {visibleWarnings.length > 0 && (
              <div className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <div className="font-semibold">Warnings</div>
                <ul className="mt-1 list-inside list-disc">
                  {visibleWarnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {problems.length > 0 && (
              <div className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
                <div className="font-semibold">Before this can be saved</div>
                <ul className="mt-1 list-inside list-disc">
                  {problems.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            <button
              onClick={handleSave}
              disabled={saving || !planName || problems.length > 0}
              className="mt-6 w-full rounded-pill bg-ink py-4 text-base font-semibold text-white transition-opacity active:opacity-80 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save plan'}
            </button>
            <button
              onClick={() => {
                setParsed(null);
                setFile(null);
                setRawText('');
              }}
              className="mt-3 w-full text-center text-sm text-muted"
            >
              Upload a different PDF
            </button>
          </>
        )}
      </div>

      {parsed && editor && (
        <ExerciseEditorSheet
          title={editor.mode === 'edit' ? 'Edit exercise' : 'Add exercise'}
          initial={
            editor.mode === 'edit'
              ? draftFromExercise(parsed.days[editor.dayIdx].exercises[editor.exIdx])
              : editor.prefill ?? EMPTY_DRAFT
          }
          dayOptions={parsed.days.map((d, idx) => ({ idx, name: d.name }))}
          dayIdx={editor.dayIdx}
          sourceText={editor.mode === 'new' && editor.sourceRaw ? splitUnparsed(editor.sourceRaw).text : null}
          onSave={saveExercise}
          onDelete={
            editor.mode === 'edit' ? () => deleteExercise(editor.dayIdx, editor.exIdx) : undefined
          }
          onClose={() => setEditor(null)}
        />
      )}

      {parsed && dayEditor && (
        <DayEditorSheet
          title={dayEditor === 'new' ? 'Add a day' : 'Edit day'}
          initialName={dayEditor === 'new' ? '' : parsed.days[dayEditor.dayIdx].name}
          initialWeek={dayEditor === 'new' ? null : parsed.days[dayEditor.dayIdx].weekIndex}
          weekOptions={planWeeks}
          exerciseCount={dayEditor === 'new' ? 0 : parsed.days[dayEditor.dayIdx].exercises.length}
          onSave={saveDay}
          onDelete={dayEditor === 'new' ? undefined : () => deleteDay(dayEditor.dayIdx)}
          onClose={() => setDayEditor(null)}
        />
      )}
    </div>
  );
}

// A line the parser couldn't turn into a row, shown where it was found so the
// user can rescue it into an exercise or say it isn't one.
function UnreadLineCard({
  text,
  tone = 'inset',
  addDisabled = false,
  onAdd,
  onIgnore,
}: {
  text: string;
  tone?: 'inset' | 'plain';
  addDisabled?: boolean;
  onAdd: () => void;
  onIgnore: () => void;
}) {
  const body = (
    <>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-800">
        Couldn't read this line
      </div>
      <div className="mt-1 break-words font-mono text-[11px] text-ink/80">{text}</div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={onAdd}
          disabled={addDisabled}
          className="rounded-pill bg-ink px-3 py-1.5 text-xs font-semibold text-white active:opacity-80 disabled:opacity-40"
        >
          Add as exercise
        </button>
        <button
          type="button"
          onClick={onIgnore}
          className="rounded-pill px-3 py-1.5 text-xs font-semibold text-muted active:text-ink"
        >
          Ignore
        </button>
      </div>
    </>
  );
  if (tone === 'plain') return <li className="rounded-xl bg-paper-card px-3 py-2.5">{body}</li>;
  return <div className="border-t border-line/60 bg-amber-50/60 px-5 py-3">{body}</div>;
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M7 2.5v9M2.5 7h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M11.3 2.7a1.6 1.6 0 0 1 2.3 2.3L6.2 12.4 3 13l.6-3.2 7.7-7.1Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Confirm-on-upload card for a detected "alternate weeks with X" partner. The
// user can accept the parsed name as-is, tweak it (the parser can over-capture
// from a busy note), or remove it if it isn't really an alternation.
function WeeklyAlternativeCard({
  alternative,
  onChange,
}: {
  alternative: WeeklyAlternative;
  onChange: (alt: WeeklyAlternative | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(alternative.name);

  function commit() {
    const trimmed = draft.trim();
    if (!trimmed) {
      onChange(null);
    } else {
      onChange({ name: trimmed, normalizedName: normalizeExerciseName(trimmed) });
    }
    setEditing(false);
  }

  return (
    <div className="mt-3 rounded-xl bg-ink/5 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
        <RotateGlyph />
        Alternates weekly with
      </div>
      {editing ? (
        <div className="mt-1.5">
          <input
            type="text"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                setDraft(alternative.name);
                setEditing(false);
              }
            }}
            className="w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm text-ink focus:border-ink focus:outline-none"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              onClick={() => {
                setDraft(alternative.name);
                setEditing(false);
              }}
              className="rounded-pill px-3 py-1.5 text-xs font-semibold text-muted active:text-ink"
            >
              Cancel
            </button>
            <button
              onClick={commit}
              className="rounded-pill bg-ink px-3 py-1.5 text-xs font-semibold text-white active:opacity-80"
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-1 flex items-center justify-between gap-3">
          <span className="min-w-0 break-words text-sm font-semibold text-ink">
            {alternative.name}
          </span>
          <div className="flex shrink-0 gap-3 text-xs font-semibold">
            <button
              onClick={() => {
                setDraft(alternative.name);
                setEditing(true);
              }}
              className="text-ink/70 active:text-ink"
            >
              Edit
            </button>
            <button
              onClick={() => onChange(null)}
              className="text-muted active:text-red-600"
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RotateGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 12a8 8 0 0 1 13.5-5.8L20 8M20 4v4h-4M20 12a8 8 0 0 1-13.5 5.8L4 16M4 20v-4h4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ExerciseReviewRow({
  exercise,
  restSeconds,
  showHistoryControl,
  match,
  keepHistory,
  onNotesChange,
  onSameMachine,
  onDifferentMachine,
  onToggleKeepHistory,
  onAlternativeChange,
  onEdit,
}: {
  exercise: ParsedExercise;
  restSeconds: number | null;
  // The bulk choice on the summary card covers the usual case; the per-machine
  // control only renders while the user is explicitly adjusting.
  showHistoryControl: boolean;
  match?: Match;
  keepHistory: boolean;
  onNotesChange: (notes: string) => void;
  onSameMachine: () => void;
  onDifferentMachine: () => void;
  onToggleKeepHistory: () => void;
  onAlternativeChange: (alt: WeeklyAlternative | null) => void;
  onEdit: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(exercise.notes ?? '');

  const sets = useMemo(() => {
    const totalSets = Math.max(1, exercise.totalSets ?? 1);
    const baseTarget = parseTargetReps(exercise.repRange);
    const mods = parseSetMods(exercise.notes ?? '', totalSets);
    const out: { idx: number; reps: string; drops: string[]; tag?: string }[] = [];
    for (let i = 1; i <= totalSets; i++) {
      const m = mods.bySetIndex.get(i);
      const reps =
        m?.repTarget != null
          ? String(m.repTarget)
          : m?.repRangeOverride ?? (baseTarget != null ? String(baseTarget) : '—');
      const drops = (m?.drops ?? []).map((d) =>
        d.repTarget != null ? String(d.repTarget) : '—'
      );
      out.push({
        idx: i,
        reps,
        drops,
        tag: m?.schemeDetail ?? (m?.scheme && m.scheme !== 'dropset' ? m.scheme : undefined),
      });
    }
    return out;
  }, [exercise.notes, exercise.repRange, exercise.totalSets]);

  return (
    <div className="px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold text-ink">
            {exercise.name}
          </div>
          {exercise.bodyPart && (
            <div className="mt-0.5 text-xs text-muted">{exercise.bodyPart}</div>
          )}
        </div>
        <div className="flex shrink-0 items-start gap-1">
          <div className="text-right text-xs text-muted">
            <div>
              <span className="text-ink">{exercise.totalSets ?? '—'}</span> sets
            </div>
            <div>{exercise.repRange || '—'} reps</div>
            {restSeconds != null && <div>{restLabel(restSeconds)} rest</div>}
          </div>
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit ${exercise.name}`}
            className="-mr-2 -mt-1 flex h-8 w-8 items-center justify-center rounded-full text-muted active:bg-line/60"
          >
            <PencilIcon />
          </button>
        </div>
      </div>

      {(exercise.supersetPartnerNames ?? []).length === 0 &&
        (exercise.supersetWith ?? []).length > 0 && (
          <div className="mt-2 rounded-xl bg-ink/5 px-3 py-2 text-xs text-ink/80">
            The notes superset this with{' '}
            <span className="font-semibold text-ink">
              {formatNameList(exercise.supersetWith ?? [])}
            </span>
            , which isn't a row in this day — so it stays as a coach note rather
            than a tracked pairing.
          </div>
        )}

      {(exercise.supersetPartnerNames ?? []).length > 0 && (
        <div className="mt-2 rounded-xl bg-ink/5 px-3 py-2 text-xs text-ink/80">
          <span className="font-semibold text-ink">
            {groupedSetLabel((exercise.supersetPartnerNames?.length ?? 0) + 1)}
          </span>{' '}
          — alternates with{' '}
          <span className="font-semibold text-ink">
            {formatNameList(exercise.supersetPartnerNames ?? [])}
          </span>
          , resting once the round is done.
        </div>
      )}

      {match && match.kind !== 'none' && (
        <div className="mt-3">
          {(match.kind === 'exact' || (match.kind === 'fuzzy' && match.decision === 'same')) &&
            (showHistoryControl ? (
              // Adjusting: a segmented pair, so the chosen state is unmistakable —
              // exactly one side is filled, and it names what happens.
              <div className="flex items-center justify-between gap-3 rounded-xl bg-ink/5 px-3 py-2">
                <span className="min-w-0 truncate text-xs text-ink/80">
                  From{' '}
                  <span className="font-semibold text-ink">
                    {match.candidate?.name ?? 'your history'}
                  </span>
                </span>
                <div className="flex shrink-0 rounded-pill bg-line/60 p-0.5">
                  <button
                    onClick={keepHistory ? undefined : onToggleKeepHistory}
                    className={`rounded-pill px-3 py-1 text-[11px] font-semibold transition-colors duration-150 ${
                      keepHistory ? 'bg-ink text-white shadow-card' : 'text-muted'
                    }`}
                  >
                    Carry over
                  </button>
                  <button
                    onClick={keepHistory ? onToggleKeepHistory : undefined}
                    className={`rounded-pill px-3 py-1 text-[11px] font-semibold transition-colors duration-150 ${
                      !keepHistory ? 'bg-ink text-white shadow-card' : 'text-muted'
                    }`}
                  >
                    Start fresh
                  </button>
                </div>
              </div>
            ) : (
              // Not adjusting: state the outcome, no control to second-guess.
              <div className="text-xs text-muted">
                {keepHistory ? (
                  <>
                    Weights carry over from{' '}
                    <span className="font-medium text-ink">
                      {match.candidate?.name ?? "a machine you've used before"}
                    </span>
                    .
                  </>
                ) : (
                  'Starting fresh at zero.'
                )}
              </div>
            ))}
          {match.kind === 'fuzzy' && match.decision === 'pending' && (
            <div className="rounded-xl bg-ink/5 px-3 py-2.5">
              <div className="text-xs text-ink/80">
                Looks similar to{' '}
                <span className="font-semibold text-ink">{match.candidate?.name}</span>{' '}
                from your history. Same machine?
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={onSameMachine}
                  className="flex-1 rounded-pill border border-line bg-paper py-1.5 text-xs font-semibold text-ink active:bg-line/40"
                >
                  Same machine
                </button>
                <button
                  onClick={onDifferentMachine}
                  className="flex-1 rounded-pill border border-line bg-paper py-1.5 text-xs font-semibold text-ink active:bg-line/40"
                >
                  Different machine
                </button>
              </div>
            </div>
          )}
          {match.kind === 'fuzzy' && match.decision === 'different' && (
            <div className="text-xs text-muted">
              Treated as a new exercise — past history won't carry over.
            </div>
          )}
        </div>
      )}

      {exercise.weeklyAlternative && (
        <WeeklyAlternativeCard
          alternative={exercise.weeklyAlternative}
          onChange={onAlternativeChange}
        />
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {sets.map((s) => (
          <div
            key={s.idx}
            className="flex items-center gap-1 rounded-pill border border-line bg-paper px-2.5 py-1 text-xs"
          >
            <span className="font-semibold text-muted">S{s.idx}</span>
            <span className="text-ink">{s.reps}</span>
            {s.drops.map((d, di) => (
              <span key={di} className="flex items-center gap-1 text-muted">
                <span aria-hidden>↓</span>
                <span className="text-ink">{d}</span>
              </span>
            ))}
            {s.tag && (
              <span className="ml-1 rounded-pill bg-ink/10 px-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink">
                {s.tag}
              </span>
            )}
          </div>
        ))}
      </div>

      {(exercise.notes || editing) && (
        <div className="mt-3">
          {editing ? (
            <div>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={3}
                className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none"
              />
              <div className="mt-2 flex justify-end gap-2">
                <button
                  onClick={() => {
                    setDraft(exercise.notes ?? '');
                    setEditing(false);
                  }}
                  className="rounded-pill px-3 py-1.5 text-xs font-semibold text-muted active:text-ink"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    onNotesChange(draft);
                    setEditing(false);
                  }}
                  className="rounded-pill bg-ink px-3 py-1.5 text-xs font-semibold text-white active:opacity-80"
                >
                  Save notes
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => {
                setDraft(exercise.notes ?? '');
                setEditing(true);
              }}
              className="block w-full rounded-xl bg-paper px-3 py-2 text-left text-xs text-muted active:bg-line/40"
            >
              <span className="font-semibold uppercase tracking-wider">Coach notes</span>
              <div className="mt-1 whitespace-pre-wrap text-ink/80">
                {exercise.notes || 'Tap to add notes'}
              </div>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function UploadIcon() {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 32 32"
      fill="none"
      className="mx-auto text-muted"
    >
      <path
        d="M16 22V8 M10 14l6-6 6 6 M6 24h20"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrophyIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      className="mt-0.5 shrink-0 text-ink"
      aria-hidden="true"
    >
      <path
        d="M4.5 2.5h7v3.25a3.5 3.5 0 0 1-7 0V2.5Z M4.5 3.75H3a1.5 1.5 0 0 0 0 3h.6 M11.5 3.75H13a1.5 1.5 0 0 1 0 3h-.6 M8 9.25v2.5 M5.75 13.5h4.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
