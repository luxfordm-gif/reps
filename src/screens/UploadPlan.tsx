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
    parsed?.days.forEach((day, dayIdx) => {
      restSecondsForExercises(
        day.exercises.map((e) => ({
          name: e.name,
          notes: e.notes,
          setScheme: e.setScheme,
          supersetGroup: e.supersetGroup ?? null,
        }))
      ).forEach((rest, exIdx) => map.set(`${dayIdx}:${exIdx}`, rest));
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

  // Keys of carried-over machines whose history is KEPT. Default is to keep every
  // match: a new block is usually the same machines with a different set and rep
  // prescription, and walking up to a familiar machine with a blank weight field
  // is friction. Nothing is deleted either way — a reset only cuts off the "last
  // time" prefill, so untick anything you'd rather restart from zero.
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
    parsed.days.forEach((day, dayIdx) => {
      day.exercises.forEach((ex, exIdx) => {
        next.set(`${dayIdx}:${exIdx}`, computeMatch(ex, previousExercises));
      });
    });
    setMatches(next);
    // New parse → carry history over on every machine that matched.
    const carriers: string[] = [];
    for (const [key, m] of next) {
      if (carriesHistory(m)) carriers.push(key);
    }
    setKeepHistory(new Set(carriers));
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
      setParsed(result);
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
      // Default is to carry history over: reset only the machines the user
      // explicitly unticked.
      const historyResetKeys = new Set(
        historyCarrierKeys.filter((k) => !keepHistory.has(k))
      );
      await savePlan(parsed, planName, rawText, { historyResetKeys });
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
    const key = `${dayIdx}:${exIdx}`;
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
    // It's a carried-over machine now, so it takes the same default as the rest.
    setKeepHistory((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }

  function answerDifferentMachine(dayIdx: number, exIdx: number) {
    const key = `${dayIdx}:${exIdx}`;
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
    const key = `${dayIdx}:${exIdx}`;
    setKeepHistory((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

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
                {parsed.days.length} days · {totalExercises} exercises
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
                  Previous history
                </div>
                <div className="mt-1 text-sm text-ink">
                  <span className="font-semibold">{historyCarrierKeys.length}</span>{' '}
                  {historyCarrierKeys.length === 1
                    ? "machine matches one you've"
                    : "machines match ones you've"}{' '}
                  trained before. Your weights{' '}
                  <span className="font-semibold">carry over</span> by default — untick
                  “Keep history” on any you'd rather restart at zero.
                </div>
                <div className="mt-2 text-xs text-muted">
                  Keeping {keptCount} · resetting {resetCount}. Nothing is deleted either
                  way — a reset only clears the weights the logger pre-fills.
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => setKeepHistory(new Set(historyCarrierKeys))}
                    disabled={keptCount === historyCarrierKeys.length}
                    className="flex-1 rounded-pill border border-line bg-paper py-1.5 text-xs font-semibold text-ink active:bg-line/40 disabled:opacity-40"
                  >
                    Keep all history
                  </button>
                  <button
                    onClick={() => setKeepHistory(new Set())}
                    disabled={keptCount === 0}
                    className="flex-1 rounded-pill border border-line bg-paper py-1.5 text-xs font-semibold text-ink active:bg-line/40 disabled:opacity-40"
                  >
                    Reset all to zero
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
                <div key={day.name} className="rounded-card bg-paper-card shadow-card">
                  <div className="border-b border-line/60 px-5 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                      Day {day.position + 1}
                      {day.weekIndex != null && ` · Rotation week ${day.weekIndex}`}
                      {day.weekIndex == null && rotates && ' · Every week'}
                    </div>
                    <div className="mt-0.5 text-base font-semibold text-ink">
                      {day.name}
                    </div>
                  </div>
                  <ul className="divide-y divide-line/60">
                    {day.exercises.map((ex, exIdx) => (
                      <li key={`${ex.name}-${ex.position}`}>
                        <ExerciseReviewRow
                          exercise={ex}
                          restSeconds={restByKey.get(`${dayIdx}:${exIdx}`) ?? null}
                          showHistoryControl={adjustHistoryOpen}
                          match={matches.get(`${dayIdx}:${exIdx}`)}
                          keepHistory={keepHistory.has(`${dayIdx}:${exIdx}`)}
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
                </div>
              ))}
            </div>

            {parsed.warnings.length > 0 && (
              <div className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <div className="font-semibold">Warnings</div>
                <ul className="mt-1 list-inside list-disc">
                  {parsed.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {parsed.unparsedLines.length > 0 && (
              <div className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-xs text-amber-800">
                <div className="font-semibold">Lines that didn't fit a row:</div>
                <ul className="mt-1 list-inside list-disc">
                  {parsed.unparsedLines.slice(0, 5).map((u, i) => (
                    <li key={i} className="truncate">
                      {u}
                    </li>
                  ))}
                  {parsed.unparsedLines.length > 5 && (
                    <li className="font-semibold">
                      …and {parsed.unparsedLines.length - 5} more
                    </li>
                  )}
                </ul>
              </div>
            )}

            <button
              onClick={handleSave}
              disabled={saving || !planName}
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
    </div>
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
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold text-ink">
            {exercise.name}
          </div>
          {exercise.bodyPart && (
            <div className="mt-0.5 text-xs text-muted">{exercise.bodyPart}</div>
          )}
        </div>
        <div className="shrink-0 text-right text-xs text-muted">
          <div>
            <span className="text-ink">{exercise.totalSets ?? '—'}</span> sets
          </div>
          <div>{exercise.repRange || '—'} reps</div>
          {restSeconds != null && <div>{restLabel(restSeconds)} rest</div>}
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
