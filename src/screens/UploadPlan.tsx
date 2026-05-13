import { useState } from 'react';
import { extractPdfText } from '../lib/extractPdfText';
import { parseTrainingPlan, type ParsedPlan } from '../lib/parseTrainingPlan';
import { savePlan, getActivePlan } from '../lib/plansApi';
import { PageHeader } from '../components/PageHeader';
import { ConfirmModal } from '../components/ConfirmModal';

interface Props {
  onCancel: () => void;
  onSaved: () => void;
}

type Stage =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'parsing'; stages: string[] }
  | { kind: 'preview' }
  | { kind: 'saved'; daysCount: number; exercisesCount: number };

export function UploadPlan({ onCancel, onSaved }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [planName, setPlanName] = useState('');
  const [parsed, setParsed] = useState<ParsedPlan | null>(null);
  const [rawText, setRawText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [replaceConfirm, setReplaceConfirm] = useState<{ oldName: string } | null>(null);

  async function handleFile(f: File) {
    setError(null);
    setFile(f);
    if (!planName) {
      setPlanName(f.name.replace(/\.pdf$/i, ''));
    }
    setStage({ kind: 'reading' });
    try {
      const text = await extractPdfText(f);
      setRawText(text);
      // Short pause so the user sees the stages animate; this is feedback-only.
      const stages: string[] = ['Reading PDF…'];
      setStage({ kind: 'parsing', stages: [...stages] });
      await tinyDelay();
      const result = parseTrainingPlan(text);
      stages.push(`Found ${result.days.length} training ${result.days.length === 1 ? 'day' : 'days'}`);
      setStage({ kind: 'parsing', stages: [...stages] });
      await tinyDelay();
      const totalExercises = result.days.reduce((s, d) => s + d.exercises.length, 0);
      stages.push(`Found ${totalExercises} ${totalExercises === 1 ? 'exercise' : 'exercises'}`);
      setStage({ kind: 'parsing', stages: [...stages] });
      const flagged = countFlagged(result);
      if (flagged > 0) {
        await tinyDelay();
        stages.push(`Flagged ${flagged} for review`);
        setStage({ kind: 'parsing', stages: [...stages] });
      }
      await tinyDelay(250);
      setParsed(result);
      setStage({ kind: 'preview' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to parse PDF');
      setStage({ kind: 'idle' });
    }
  }

  async function actuallySave() {
    if (!parsed || !planName) return;
    setSaving(true);
    setError(null);
    try {
      await savePlan(parsed, planName.trim(), rawText);
      const totalExercises = parsed.days.reduce((s, d) => s + d.exercises.length, 0);
      setStage({ kind: 'saved', daysCount: parsed.days.length, exercisesCount: totalExercises });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save plan');
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    if (!parsed || !planName) return;
    setError(null);
    try {
      const current = await getActivePlan();
      if (current) {
        setReplaceConfirm({ oldName: current.name });
        return;
      }
    } catch {
      // If we can't check, just proceed — the user can re-activate via Plans.
    }
    actuallySave();
  }

  function resetForNewUpload() {
    setParsed(null);
    setFile(null);
    setRawText('');
    setStage({ kind: 'idle' });
    setError(null);
  }

  const totalExercises =
    parsed?.days.reduce((sum, d) => sum + d.exercises.length, 0) ?? 0;

  return (
    <div className="min-h-screen bg-paper pb-12">
      <div className="mx-auto max-w-md px-5 pt-3">
        <PageHeader title="Upload plan" onBack={onCancel} />

        {stage.kind === 'saved' ? (
          <SuccessCard
            planName={planName}
            daysCount={stage.daysCount}
            exercisesCount={stage.exercisesCount}
            onDone={onSaved}
          />
        ) : (
          <>
            <p className="mt-6 text-base text-muted">
              Drop in the PDF from your trainer. Reps will turn it into your training days.
            </p>

            {!parsed && (
              <label
                className={`mt-8 flex h-44 cursor-pointer items-center justify-center rounded-card border-2 border-dashed border-line bg-paper-card px-5 text-center transition-colors ${
                  stage.kind === 'reading' || stage.kind === 'parsing'
                    ? 'opacity-60'
                    : 'active:border-ink'
                }`}
              >
                <input
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  disabled={stage.kind === 'reading' || stage.kind === 'parsing'}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                  }}
                />
                <div className="w-full">
                  {stage.kind === 'parsing' ? (
                    <StageList stages={stage.stages} />
                  ) : stage.kind === 'reading' ? (
                    <StageList stages={['Reading PDF…']} />
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

            {parsed && stage.kind === 'preview' && (
              <>
                <div className="mt-8">
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                    Plan name
                  </label>
                  <input
                    type="text"
                    value={planName}
                    onChange={(e) => setPlanName(e.target.value)}
                    maxLength={80}
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
                  <div className="mt-4 space-y-3">
                    {parsed.days.map((d) => (
                      <DayPreview key={d.name} day={d} />
                    ))}
                  </div>
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
                  disabled={saving || !planName.trim()}
                  className="mt-6 w-full rounded-pill bg-ink py-4 text-base font-semibold text-white transition-opacity active:opacity-80 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save plan'}
                </button>
                <button
                  onClick={resetForNewUpload}
                  className="mt-3 w-full text-center text-sm text-muted"
                >
                  Upload a different PDF
                </button>
              </>
            )}
          </>
        )}
      </div>

      {replaceConfirm && (
        <ConfirmModal
          title={`Replace "${replaceConfirm.oldName}"?`}
          message={`Saving will set "${planName.trim()}" as your active plan. "${replaceConfirm.oldName}" will stay in your plan library — you can switch back any time.`}
          confirmLabel="Replace"
          cancelLabel="Cancel"
          onConfirm={() => {
            setReplaceConfirm(null);
            actuallySave();
          }}
          onCancel={() => setReplaceConfirm(null)}
        />
      )}
    </div>
  );
}

function StageList({ stages }: { stages: string[] }) {
  return (
    <ul className="space-y-1.5 text-left">
      {stages.map((s, i) => (
        <li
          key={i}
          className="flex items-center gap-2 text-sm text-ink"
          style={{ animation: 'reps-stage-in 220ms ease-out' }}
        >
          <CheckDot done={i < stages.length - 1} />
          <span className={i < stages.length - 1 ? 'text-muted' : 'font-semibold text-ink'}>
            {s}
          </span>
        </li>
      ))}
      <style>{`
        @keyframes reps-stage-in {
          from { opacity: 0; transform: translateY(2px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </ul>
  );
}

function CheckDot({ done }: { done: boolean }) {
  if (done) {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0 text-ink">
        <circle cx="7" cy="7" r="6" fill="currentColor" />
        <path d="M4 7l2 2 4-4" stroke="white" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <span
      className="inline-block h-2 w-2 shrink-0 rounded-full bg-ink"
      style={{ animation: 'reps-pulse 900ms ease-in-out infinite' }}
    >
      <style>{`
        @keyframes reps-pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50%      { transform: scale(0.65); opacity: 0.55; }
        }
      `}</style>
    </span>
  );
}

function DayPreview({ day }: { day: import('../lib/parseTrainingPlan').ParsedTrainingDay }) {
  const [open, setOpen] = useState(false);
  const flagged = day.exercises.filter((e) => e.repRangeUncertain || e.tempoUncertain).length;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-baseline justify-between gap-2 text-left text-sm"
      >
        <span className="font-medium text-ink">{day.name}</span>
        <span className="flex items-center gap-2 text-muted">
          {flagged > 0 && (
            <span className="inline-flex items-center gap-1 rounded-pill bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              {flagged} to review
            </span>
          )}
          <span>
            {day.exercises.length} {day.exercises.length === 1 ? 'exercise' : 'exercises'}
          </span>
        </span>
      </button>
      {open && (
        <ul className="mt-2 space-y-1 border-l border-line pl-3">
          {day.exercises.map((ex, i) => (
            <li key={i} className="flex items-start gap-2 text-xs">
              <span className="mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{
                background: ex.repRangeUncertain || ex.tempoUncertain ? '#F59E0B' : '#D1D5DB',
              }} />
              <span className="flex-1">
                <span className="text-ink">{ex.name}</span>
                <span className="ml-1 text-muted">
                  · {ex.totalSets ?? '?'} sets · {ex.repRange || '?'}
                  {ex.tempo ? ` · ${ex.tempo}` : ''}
                </span>
                {(ex.repRangeUncertain || ex.tempoUncertain) && (
                  <span className="mt-0.5 block text-[10px] font-medium text-amber-700">
                    {[
                      ex.repRangeUncertain ? 'Rep range unclear' : null,
                      ex.tempoUncertain ? 'Tempo missing' : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SuccessCard({
  planName,
  daysCount,
  exercisesCount,
  onDone,
}: {
  planName: string;
  daysCount: number;
  exercisesCount: number;
  onDone: () => void;
}) {
  return (
    <div className="mt-10 rounded-card bg-paper-card p-8 text-center shadow-card">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#E8F5E9]">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="14" stroke="#2E7D32" strokeWidth="2" />
          <path
            d="M10 16l4 4 8-9"
            stroke="#2E7D32"
            strokeWidth="2.2"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <h2 className="mt-5 text-2xl font-bold tracking-tight text-ink">Plan saved</h2>
      <p className="mt-2 text-sm text-muted">
        <span className="font-semibold text-ink">{planName}</span>
        <br />
        {daysCount} days · {exercisesCount} exercises · Week 1 starts now
      </p>
      <button
        onClick={onDone}
        className="mt-6 w-full rounded-pill bg-ink py-4 text-base font-semibold text-white transition-opacity active:opacity-80"
      >
        Let's go
      </button>
    </div>
  );
}

function tinyDelay(ms = 350): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function countFlagged(p: ParsedPlan): number {
  let n = 0;
  for (const d of p.days) {
    for (const e of d.exercises) {
      if (e.repRangeUncertain || e.tempoUncertain) n++;
    }
  }
  return n;
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
