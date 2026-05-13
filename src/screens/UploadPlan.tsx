import { useMemo, useState } from 'react';
import { extractPdfText } from '../lib/extractPdfText';
import {
  parseTrainingPlan,
  type ParsedExercise,
  type ParsedPlan,
} from '../lib/parseTrainingPlan';
import { parseSetMods } from '../lib/parseSetMods';
import { savePlan } from '../lib/plansApi';
import { PageHeader } from '../components/PageHeader';

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
  const [rawText, setRawText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      await savePlan(parsed, planName, rawText);
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

  const totalExercises =
    parsed?.days.reduce((sum, d) => sum + d.exercises.length, 0) ?? 0;

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
            </div>

            <div className="mt-4 space-y-4">
              {parsed.days.map((day, dayIdx) => (
                <div key={day.name} className="rounded-card bg-paper-card shadow-card">
                  <div className="border-b border-line/60 px-5 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                      Day {day.position + 1}
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
                          onNotesChange={(notes) => setExerciseNotes(dayIdx, exIdx, notes)}
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

function ExerciseReviewRow({
  exercise,
  onNotesChange,
}: {
  exercise: ParsedExercise;
  onNotesChange: (notes: string) => void;
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
        </div>
      </div>

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
