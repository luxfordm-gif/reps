import { useState } from 'react';
import { extractPdfText } from '../lib/extractPdfText';
import { parseTrainingPlan, type ParsedPlan } from '../lib/parseTrainingPlan';
import { savePlan } from '../lib/plansApi';
import { PageHeader } from '../components/PageHeader';

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

  const totalExercises =
    parsed?.days.reduce((sum, d) => sum + d.exercises.length, 0) ?? 0;

  return (
    <div className="min-h-screen bg-paper pb-12">
      <div className="mx-auto max-w-md px-5 pt-12">
        <PageHeader title="Upload Plan" onBack={onCancel} />

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
              <div className="mt-4 space-y-1.5">
                {parsed.days.map((d) => (
                  <div key={d.name} className="flex items-baseline justify-between text-sm">
                    <span className="font-medium text-ink">{d.name}</span>
                    <span className="text-muted">
                      {d.exercises.length} {d.exercises.length === 1 ? 'exercise' : 'exercises'}
                    </span>
                  </div>
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
