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
import { describePlanFileProblem } from '../lib/planUpload';
import {
  carriesHistory,
  computeMatch,
  isAnswerable,
  type Match,
  type PreviousExercise,
} from '../lib/machineMatch';
import { restLabel, restSecondsForExercises } from '../lib/restDefaults';
import { formatNameList, groupedSetLabel } from '../lib/supersets';
import { ConfirmModal } from '../components/ConfirmModal';
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
  // The repair sheets: fixing a row the parser got wrong, or a day's name/week.
  const [editor, setEditor] = useState<EditorState>(null);
  const [dayEditor, setDayEditor] = useState<{ dayIdx: number } | 'new' | null>(null);
  // Saving with lines still unread is allowed, but not by accident.
  const [confirmDrop, setConfirmDrop] = useState(false);


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
  }, [parsed, previousExercises]);

  async function handleFile(f: File) {
    const problem = describePlanFileProblem(f);
    if (problem) {
      // Leave the previous selection alone — nothing about this file was read.
      setError(problem);
      return;
    }
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
      // A new plan starts every machine you've trained before at zero: the
      // logger stops pre-filling last block's weight, and the new rep ranges
      // are worked up to instead of chased. Nothing is deleted — every set
      // stays in history and the all-time bests on the Performance tab.
      // Rows may have been added, moved or deleted, so positions are made
      // contiguous first; savePlan keys the reset by final position.
      const normalized = normalizePositions(parsed);
      const historyResetKeys = new Set<string>();
      for (const d of normalized.days) {
        for (const e of d.exercises) {
          if (carriesHistory(matches.get(keyOf(e)))) {
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

  /**
   * Tie this row to a machine already in the history.
   *
   * `adoptName` also takes the old spelling. That matters for a typo: the
   * Machines screen shows whichever name the newest plan used, so accepting
   * "Dedlift" as the same machine without this would keep the history and
   * rename the machine to the typo everywhere.
   */
  function answerSameMachine(dayIdx: number, exIdx: number, adoptName = false) {
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
                  j !== exIdx
                    ? e
                    : {
                        ...e,
                        normalizedName: candidate.normalizedName,
                        ...(adoptName ? { name: candidate.name } : {}),
                      }
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
  // Lines the parser couldn't read and the user hasn't dealt with. Adding one as
  // an exercise or ignoring it takes it off this list, so what's left is only
  // what hasn't been decided.
  const droppedCount = unparsed.length;
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

  // How many exercises are tied to a machine already in the user's history.
  const carrierCount = [...matches.values()].filter(carriesHistory).length;

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
      if (isAnswerable(m) && m.decision === 'pending') n += 1;
    }
    return n;
  }, [matches]);

  return (
    <div className={`min-h-screen bg-paper ${parsed ? 'pb-32' : 'pb-12'}`}>
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
                  <div className="mt-0.5 text-xs text-muted">Max 10MB</div>
                </>
              )}
            </div>
          </label>
        )}

        {error && (
          <div className="mt-4 rounded-panel bg-danger-soft px-4 py-3 text-sm text-danger">
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
                className="w-full rounded-panel border border-line bg-paper-card px-4 py-3.5 text-base text-ink focus:border-ink focus:outline-none"
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
              {carrierCount > 0 && (
                <div className="mt-2 text-xs text-muted">
                  <span className="font-semibold text-ink">{carrierCount}</span>{' '}
                  {carrierCount === 1 ? 'machine you' : 'machines you'} already train{' '}
                  {carrierCount === 1 ? 'starts' : 'start'} at zero on the new plan. Your PRs
                  stay on the Performance tab.
                </div>
              )}
              {pendingMatchCount > 0 && (
                <div className="mt-2 text-xs text-muted">
                  <span className="font-semibold text-ink">{pendingMatchCount}</span>{' '}
                  {pendingMatchCount === 1 ? 'exercise matches' : 'exercises match'} a machine
                  you already train, give or take the spelling — confirm each one below so its
                  history follows it.
                </div>
              )}
              {weeklyAltCount > 0 && (
                <div className="mt-2 text-xs text-muted">
                  <span className="font-semibold text-ink">{weeklyAltCount}</span>{' '}
                  {weeklyAltCount === 1 ? 'exercise alternates' : 'exercises alternate'} weekly with another machine — confirm the name below and Reps will offer to rotate it for you.
                </div>
              )}
            </div>


            <div className="mt-4 space-y-4">
              {parsed.days.map((day, dayIdx) => (
                <div key={`${day.name}#${dayIdx}`} className="rounded-card bg-paper-card shadow-card">
                  <div className="flex items-start justify-between gap-3 border-b border-line/60 px-5 py-3">
                    <div className="min-w-0">
                      <div className="text-label font-semibold uppercase tracking-[0.14em] text-muted">
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
                      className="pressable -mr-2 shrink-0 rounded-pill px-2.5 py-1 text-xs font-semibold text-muted active:text-ink"
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
                          match={matches.get(keyOf(ex))}
                          onEdit={() => setEditor({ mode: 'edit', dayIdx, exIdx })}
                          onNotesChange={(notes) => setExerciseNotes(dayIdx, exIdx, notes)}
                          onSameMachine={(adoptName) => answerSameMachine(dayIdx, exIdx, adoptName)}
                          onDifferentMachine={() => answerDifferentMachine(dayIdx, exIdx)}
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
                    className="flex w-full items-center justify-center gap-1.5 border-t border-line/60 py-3 text-sm font-semibold text-ink active:bg-surface"
                  >
                    <PlusIcon /> Add exercise
                  </button>
                </div>
              ))}

              {orphanLines.length > 0 && (
                <div className="rounded-card border border-warn-line bg-warn-soft p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-warn">
                    {orphanLines.length} {orphanLines.length === 1 ? 'line' : 'lines'} not under any day
                  </div>
                  <p className="mt-1 text-xs text-warn">
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
                className="flex w-full items-center justify-center gap-1.5 rounded-card border border-dashed border-line py-3.5 text-sm font-semibold text-muted active:bg-surface"
              >
                <PlusIcon /> Add a day
              </button>
            </div>

            {visibleWarnings.length > 0 && (
              <div className="mt-4 rounded-panel bg-warn-soft px-4 py-3 text-sm text-warn">
                <div className="font-semibold">Warnings</div>
                <ul className="mt-1 list-inside list-disc">
                  {visibleWarnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {problems.length > 0 && (
              <div className="mt-4 rounded-panel bg-danger-soft px-4 py-3 text-sm text-danger">
                <div className="font-semibold">Before this can be saved</div>
                <ul className="mt-1 list-inside list-disc">
                  {problems.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

          </>
        )}
      </div>

      {/* Save sits on the screen rather than at the end of it: the plan under
          review is long, and the one action that finishes the job shouldn't
          need scrolling to reach. Same bar as the one in a workout. */}
      {parsed && (
        <div
          className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper/95 px-5 pt-4 backdrop-blur"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}
        >
          <div className="mx-auto max-w-md">
            {/* The lines that couldn't be read are shown where they were found,
                which can be a long way up a long page. Saving drops them, so
                the count belongs next to the button that does it. */}
            {droppedCount > 0 && (
              <div className="mb-2.5 flex items-start gap-2 text-xs text-warn">
                <WarnGlyph />
                <span>
                  <span className="font-semibold">{droppedCount}</span>{' '}
                  {droppedCount === 1 ? 'line' : 'lines'} couldn't be read and won't be
                  imported.
                </span>
              </div>
            )}
            <button
              onClick={() => (droppedCount > 0 ? setConfirmDrop(true) : handleSave())}
              disabled={saving || !planName || problems.length > 0}
              className="pressable w-full rounded-pill bg-ink py-4 text-base font-semibold text-white transition-opacity active:opacity-80 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save plan'}
            </button>
          </div>
        </div>
      )}

      {confirmDrop && (
        <ConfirmModal
          title={`${droppedCount} ${droppedCount === 1 ? 'line' : 'lines'} won't be imported`}
          message={
            droppedCount === 1
              ? "One line couldn't be read as an exercise. Save now and it's left out of the plan — you can add it by hand first instead."
              : `${droppedCount} lines couldn't be read as exercises. Save now and they're left out of the plan — you can add them by hand first instead.`
          }
          confirmLabel="Save anyway"
          cancelLabel="Go back"
          onConfirm={() => {
            setConfirmDrop(false);
            handleSave();
          }}
          onCancel={() => setConfirmDrop(false)}
        />
      )}

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
      <div className="text-label font-semibold uppercase tracking-wider text-warn">
        Couldn't read this line
      </div>
      <div className="mt-1 break-words font-mono text-caption text-ink/80">{text}</div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={onAdd}
          disabled={addDisabled}
          className="pressable rounded-pill bg-ink px-3 py-1.5 text-xs font-semibold text-white active:opacity-80 disabled:opacity-40"
        >
          Add as exercise
        </button>
        <button
          type="button"
          onClick={onIgnore}
          className="pressable rounded-pill px-3 py-1.5 text-xs font-semibold text-muted active:text-ink"
        >
          Ignore
        </button>
      </div>
    </>
  );
  if (tone === 'plain') return <li className="rounded-control bg-paper-card px-3 py-2.5">{body}</li>;
  return <div className="border-t border-line/60 bg-warn-soft/60 px-5 py-3">{body}</div>;
}

function WarnGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden className="mt-px shrink-0">
      <path
        d="M8 1.5 15 14H1L8 1.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M8 6v3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="11.75" r="0.75" fill="currentColor" />
    </svg>
  );
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
    <div className="mt-3 rounded-control bg-ink/5 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-label font-semibold uppercase tracking-wider text-muted">
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
            className="w-full rounded-control border border-line bg-paper px-2.5 py-1.5 text-sm text-ink focus:border-ink focus:outline-none"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              onClick={() => {
                setDraft(alternative.name);
                setEditing(false);
              }}
              className="pressable rounded-pill px-3 py-1.5 text-xs font-semibold text-muted active:text-ink"
            >
              Cancel
            </button>
            <button
              onClick={commit}
              className="pressable rounded-pill bg-ink px-3 py-1.5 text-xs font-semibold text-white active:opacity-80"
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
              className="text-muted active:text-danger-strong"
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
  match,
  onNotesChange,
  onSameMachine,
  onDifferentMachine,
  onAlternativeChange,
  onEdit,
}: {
  exercise: ParsedExercise;
  restSeconds: number | null;
  match?: Match;
  onNotesChange: (notes: string) => void;
  onSameMachine: (adoptName: boolean) => void;
  onDifferentMachine: () => void;
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
          <div className="truncate text-base font-semibold text-ink">
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
            className="pressable -mr-2 -mt-1 flex h-8 w-8 items-center justify-center rounded-full text-muted active:bg-surface-strong"
          >
            <PencilIcon />
          </button>
        </div>
      </div>

      {(exercise.supersetPartnerNames ?? []).length === 0 &&
        (exercise.supersetWith ?? []).length > 0 && (
          <div className="mt-2 rounded-control bg-ink/5 px-3 py-2 text-xs text-ink/80">
            The notes superset this with{' '}
            <span className="font-semibold text-ink">
              {formatNameList(exercise.supersetWith ?? [])}
            </span>
            , which isn't a row in this day — so it stays as a coach note rather
            than a tracked pairing.
          </div>
        )}

      {(exercise.supersetPartnerNames ?? []).length > 0 && (
        <div className="mt-2 rounded-control bg-ink/5 px-3 py-2 text-xs text-ink/80">
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

      {isAnswerable(match) && (
        <div className="mt-3">
          {match?.decision === 'pending' && (
            // Both names, side by side, then yes or no. The answer decides
            // whether this row inherits the other name's history and PRs.
            <div className="rounded-control bg-ink/5 px-3 py-2.5">
              <div className="text-xs font-semibold text-ink">
                {match.kind === 'typo'
                  ? 'Is this a spelling of one you already train?'
                  : 'Is this the same machine?'}
              </div>
              <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                <dt className="text-muted">This plan</dt>
                <dd className="min-w-0 break-words font-semibold text-ink">{exercise.name}</dd>
                <dt className="text-muted">Your history</dt>
                <dd className="min-w-0 break-words font-semibold text-ink">
                  {match.candidate?.name}
                </dd>
              </dl>
              <div className="mt-2.5 flex gap-2">
                <button
                  onClick={() => onSameMachine(match.kind === 'typo')}
                  className="pressable flex-1 rounded-pill bg-ink py-1.5 text-xs font-semibold text-white active:opacity-80"
                >
                  {match.kind === 'typo' ? 'Yes, fix the spelling' : 'Yes, same machine'}
                </button>
                <button
                  onClick={onDifferentMachine}
                  className="pressable flex-1 rounded-pill border border-line bg-paper py-1.5 text-xs font-semibold text-ink active:bg-pressed"
                >
                  No, different
                </button>
              </div>
              {match.kind === 'typo' && (
                // The plan's spelling can be the deliberate one — a different
                // machine whose name happens to be a character away.
                <button
                  onClick={() => onSameMachine(false)}
                  className="pressable mt-2 w-full text-center text-label font-semibold text-muted active:text-ink"
                >
                  Same machine, but keep “{exercise.name}”
                </button>
              )}
            </div>
          )}
          {match?.decision === 'same' && (
            <div className="text-xs text-muted">
              Same machine as{' '}
              <span className="font-medium text-ink">{match.candidate?.name}</span> — its
              history and PRs carry on.
            </div>
          )}
          {match?.decision === 'different' && (
            <div className="text-xs text-muted">Treated as a new machine.</div>
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
              <span className="ml-1 rounded-pill bg-ink/10 px-1.5 text-label font-semibold uppercase tracking-wider text-ink">
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
                className="w-full rounded-control border border-line bg-paper px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none"
              />
              <div className="mt-2 flex justify-end gap-2">
                <button
                  onClick={() => {
                    setDraft(exercise.notes ?? '');
                    setEditing(false);
                  }}
                  className="pressable rounded-pill px-3 py-1.5 text-xs font-semibold text-muted active:text-ink"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    onNotesChange(draft);
                    setEditing(false);
                  }}
                  className="pressable rounded-pill bg-ink px-3 py-1.5 text-xs font-semibold text-white active:opacity-80"
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
              className="block w-full rounded-control bg-paper px-3 py-2 text-left text-xs text-muted active:bg-pressed"
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
