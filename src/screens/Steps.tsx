import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  ReferenceLine,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
import {
  listSteps,
  logSteps,
  deleteSteps,
  getTodayEntry,
  getStepGoal,
  formatSteps,
  MAX_STEPS,
  type StepRow,
} from '../lib/stepsApi';
import { PageHeader } from '../components/PageHeader';
import { CalendarPopover } from '../components/Calendar';
import { ConfirmModal } from '../components/ConfirmModal';
import { SyncStatus } from '../components/SyncStatus';
import { patchHomeCache } from '../lib/homeCache';
import { hapticBuzz } from '../lib/haptics';
import { isReachable } from '../lib/offline/net';

interface Props {
  onBack: () => void;
}

interface SavedState {
  /** The date + count that were saved, so the button reverts to Save the
   *  moment either of them changes. */
  signature: string;
  /** Whether this replaced an existing entry for that date. */
  replaced: boolean;
  /** Saved to the device with no signal, still waiting to sync. */
  offline: boolean;
  date: string;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function yesterdayISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatEntryDate(iso: string): string {
  if (iso === todayISO()) return 'Today';
  if (iso === yesterdayISO()) return 'Yesterday';
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export function Steps({ onBack }: Props) {
  const [rows, setRows] = useState<StepRow[]>([]);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [date, setDate] = useState<string>(todayISO());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [goal] = useState(() => getStepGoal());
  // What the Save button is showing. Same behaviour as the body weight screen:
  // it settles on `saved` and only re-arms when the count or the date changes.
  const [saved, setSaved] = useState<SavedState | null>(null);

  useEffect(() => {
    let mounted = true;
    listSteps()
      .then((r) => {
        if (!mounted) return;
        setRows(r);
        // Pre-fill with what's already down for the day being logged, so a
        // correction is an edit rather than a retype.
        const today = r.find((x) => x.recorded_on === todayISO());
        if (today) setInput(String(today.steps));
      })
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, []);

  const todayEntry = getTodayEntry(rows);

  const parsed = parseInt(input, 10);
  const inputSteps =
    !Number.isNaN(parsed) && parsed >= 0 && parsed <= MAX_STEPS ? parsed : null;
  const tooBig = !Number.isNaN(parsed) && parsed > MAX_STEPS;

  const saveSignature = `${date}|${inputSteps ?? ''}`;
  const savedNow = saved != null && saved.signature === saveSignature;

  /** Switching the date brings up whatever is already logged for that day. */
  function changeDate(next: string) {
    setDate(next);
    const existing = rows.find((r) => r.recorded_on === next);
    setInput(existing ? String(existing.steps) : '');
  }

  async function handleSave() {
    if (inputSteps == null || savedNow) return;
    setSaving(true);
    setError(null);
    const replaced = rows.some((r) => r.recorded_on === date);
    try {
      const newRow = await logSteps(inputSteps, date);
      const filtered = rows.filter((r) => r.recorded_on !== newRow.recorded_on);
      const nextRows = [newRow, ...filtered].sort((a, b) =>
        a.recorded_on < b.recorded_on ? 1 : -1
      );
      setRows(nextRows);
      // Keep Home's tile honest without waiting for its next fetch.
      if (date === todayISO()) patchHomeCache({ stepCount: inputSteps });
      setSaved({
        signature: `${date}|${inputSteps}`,
        replaced,
        // logSteps banks the entry locally when it can't reach the server;
        // say so rather than implying it's synced.
        offline: !isReachable(),
        date,
      });
      hapticBuzz([12, 40, 12]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    const removed = rows.find((r) => r.id === id);
    await deleteSteps(id);
    setRows((prev) => prev.filter((r) => r.id !== id));
    if (removed?.recorded_on === todayISO()) patchHomeCache({ stepCount: 0 });
    if (removed?.recorded_on === date) {
      setInput('');
      setSaved(null);
    }
    setPendingDeleteId(null);
  }

  // Chart data — chronological, last 14 days' entries.
  const chartData = useMemo(() => {
    return [...rows]
      .slice(0, 14)
      .reverse()
      .map((r) => ({ date: r.recorded_on, steps: r.steps }));
  }, [rows]);

  const weekAverage = useMemo(() => {
    const recent = rows.slice(0, 7);
    if (recent.length === 0) return null;
    return Math.round(recent.reduce((sum, r) => sum + r.steps, 0) / recent.length);
  }, [rows]);

  const todaySteps = todayEntry?.steps ?? 0;
  const remaining = Math.max(0, goal - todaySteps);

  return (
    <div className="min-h-screen bg-paper pb-28">
      <div className="mx-auto max-w-md px-5 pt-3">
        <PageHeader title="Steps" onBack={onBack} />

        <div className="mt-3">
          <div className="text-[15px] font-semibold tracking-tight text-ink">
            {todayEntry ? 'Logged today' : "Log today's steps"}
          </div>
          <p className="mt-1 text-sm text-muted">
            {todayEntry
              ? remaining === 0
                ? `${formatSteps(todaySteps)} steps — goal of ${formatSteps(goal)} smashed`
                : `${formatSteps(todaySteps)} of ${formatSteps(goal)} · ${formatSteps(remaining)} to go`
              : `Your goal is ${formatSteps(goal)} a day. Change it in Profile → Preferences.`}
          </p>
        </div>

        {todayEntry && <GoalBar value={todaySteps} goal={goal} />}

        <div className="mt-6 rounded-card bg-paper-card p-5 shadow-card">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
            {rows.some((r) => r.recorded_on === date) ? 'Update entry' : 'New entry'}
          </div>

          <DateField
            date={date}
            isOpen={calendarOpen}
            onToggle={() => setCalendarOpen((v) => !v)}
          />
          <CalendarPopover
            open={calendarOpen}
            value={date}
            maxISO={todayISO()}
            onSelect={(d) => {
              changeDate(d);
              setCalendarOpen(false);
            }}
          />

          <div className="mt-4 flex items-end gap-3">
            <input
              type="number"
              inputMode="numeric"
              step="1"
              min={0}
              max={MAX_STEPS}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="e.g. 7240"
              className="no-spinner w-full rounded-2xl border border-line bg-paper-card px-4 py-3.5 text-2xl font-bold tracking-tight text-ink focus:border-ink focus:outline-none"
            />
            <div className="pb-3 text-base font-medium text-muted">steps</div>
          </div>

          {inputSteps != null && inputSteps > 0 && (
            <div className="mt-3 text-xs text-muted">
              {inputSteps >= goal
                ? `${formatSteps(inputSteps - goal)} over your ${formatSteps(goal)} goal`
                : `${formatSteps(goal - inputSteps)} short of your ${formatSteps(goal)} goal`}
            </div>
          )}
          {tooBig && (
            <div className="mt-3 text-sm text-red-700">
              That's more than {formatSteps(MAX_STEPS)} — check the number.
            </div>
          )}
          {error && <div className="mt-3 text-sm text-red-700">{error}</div>}
          <SaveButton
            state={saving ? 'saving' : savedNow ? 'saved' : 'idle'}
            disabled={inputSteps == null}
            savedLabel={savedNow && saved ? savedLabel(saved) : ''}
            onClick={handleSave}
          />
          <SyncStatus className="mt-3" />
        </div>

        {chartData.length >= 2 && (
          <div className="mt-7">
            <div className="flex items-baseline justify-between">
              <SectionLabel>Last {chartData.length} entries</SectionLabel>
              {weekAverage != null && (
                <div className="text-xs text-muted">
                  {formatSteps(weekAverage)} avg
                </div>
              )}
            </div>
            <div className="mt-3 rounded-card bg-paper-card p-4 shadow-card">
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={chartData} margin={{ top: 10, right: 8, bottom: 0, left: -8 }}>
                  <XAxis
                    dataKey="date"
                    tick={{ fill: '#8E8E93', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={16}
                    tickFormatter={(d) =>
                      new Date(d + 'T00:00:00').toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                      })
                    }
                  />
                  <YAxis
                    tick={{ fill: '#8E8E93', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    width={40}
                    tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                    contentStyle={{
                      borderRadius: 12,
                      border: '1px solid #E5E5EA',
                      fontSize: 12,
                    }}
                    formatter={(v) => [formatSteps(Number(v)), 'Steps']}
                    labelFormatter={(d) =>
                      new Date(d + 'T00:00:00').toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })
                    }
                  />
                  <ReferenceLine
                    y={goal}
                    stroke="#8E8E93"
                    strokeDasharray="3 3"
                    strokeWidth={1}
                  />
                  <Bar dataKey="steps" radius={[4, 4, 0, 0]} maxBarSize={26}>
                    {chartData.map((d) => (
                      <Cell
                        key={d.date}
                        fill={d.steps >= goal ? '#0A0A0A' : '#C9C9CE'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <div className="mt-7">
          <SectionLabel>History</SectionLabel>
          {loading ? (
            <div className="mt-3 text-sm text-muted">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="mt-3 rounded-card bg-paper-card p-6 text-center text-sm text-muted shadow-card">
              No entries yet. Log your first day above.
            </div>
          ) : (
            <ul className="mt-3 divide-y divide-line overflow-hidden rounded-card bg-paper-card shadow-card">
              {rows.map((r) => (
                <li key={r.id} className="flex items-center justify-between px-5 py-4">
                  <div>
                    <div className="text-sm font-semibold text-ink">
                      {formatEntryDate(r.recorded_on)}
                    </div>
                    <div className="text-xs text-muted">
                      {r.steps >= goal
                        ? `Goal hit · ${formatSteps(r.steps - goal)} over`
                        : `${formatSteps(goal - r.steps)} short`}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-lg font-bold tabular-nums tracking-tight text-ink">
                      {formatSteps(r.steps)}
                    </div>
                    <button
                      onClick={() => setPendingDeleteId(r.id)}
                      className="text-xs text-muted active:text-ink"
                      aria-label="Delete entry"
                    >
                      ✕
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {pendingDeleteId && (
        <ConfirmModal
          title="Delete this entry?"
          message="This cannot be undone."
          confirmLabel="Delete"
          onCancel={() => setPendingDeleteId(null)}
          onConfirm={() => handleDelete(pendingDeleteId)}
        />
      )}
    </div>
  );
}

function GoalBar({ value, goal }: { value: number; goal: number }) {
  const pct = Math.min(1, value / Math.max(1, goal));
  return (
    <div className="mt-3 h-2 overflow-hidden rounded-pill bg-line">
      <div
        className="h-full rounded-pill bg-ink"
        style={{ width: `${pct * 100}%`, transition: 'width 400ms cubic-bezier(.22,.85,.36,1)' }}
      />
    </div>
  );
}

function savedLabel(saved: SavedState): string {
  if (saved.offline) return 'Saved on this phone';
  if (saved.replaced) return 'Updated';
  if (saved.date === todayISO()) return 'Recorded for today';
  if (saved.date === yesterdayISO()) return 'Recorded for yesterday';
  return `Recorded for ${new Date(saved.date + 'T00:00:00').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  })}`;
}

/**
 * Save → Saving… → a greyed-out confirmation that stays put — the same button
 * as the body weight screen, so logging either feels like the same action.
 */
function SaveButton({
  state,
  disabled,
  savedLabel,
  onClick,
}: {
  state: 'idle' | 'saving' | 'saved';
  disabled: boolean;
  savedLabel: string;
  onClick: () => void;
}) {
  const isSaved = state === 'saved';
  return (
    <button
      onClick={onClick}
      disabled={disabled || state !== 'idle'}
      aria-live="polite"
      className={`mt-4 flex w-full items-center justify-center gap-2 rounded-pill py-3.5 text-base font-semibold transition-all duration-300 ${
        isSaved
          ? 'bg-line text-muted'
          : 'bg-ink text-white active:opacity-80 disabled:opacity-50'
      }`}
    >
      {state === 'saving' && (
        <span className="h-4 w-4 animate-spin-slow rounded-full border-2 border-white/30 border-t-white" />
      )}
      {isSaved && (
        <svg
          width="18"
          height="18"
          viewBox="0 0 18 18"
          fill="none"
          className="animate-pop-in text-[#34C759]"
          aria-hidden="true"
        >
          <circle cx="9" cy="9" r="8" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M5.5 9.2l2.3 2.3 4.7-4.9"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      <span key={state} className={isSaved ? 'animate-rise-in' : undefined}>
        {state === 'saving' ? 'Saving…' : isSaved ? savedLabel : 'Save'}
      </span>
    </button>
  );
}

function DateField({
  date,
  isOpen,
  onToggle,
}: {
  date: string;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="mt-3 flex w-full items-center justify-between rounded-2xl bg-paper px-4 py-3 text-left active:bg-line/60"
    >
      <div className="flex items-center gap-2.5">
        <CalendarIcon />
        <div className="text-sm font-semibold text-ink">{formatEntryDate(date)}</div>
      </div>
      <div className="flex items-center gap-1 text-xs text-muted">
        <span>
          {new Date(date + 'T00:00:00').toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
          })}
        </span>
        <ChevronRight rotate={isOpen ? 90 : 0} />
      </div>
    </button>
  );
}

function CalendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="text-ink">
      <rect
        x="2.5"
        y="3.5"
        width="13"
        height="12"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M2.5 7h13 M6 2v3 M12 2v3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChevronRight({ rotate = 0 }: { rotate?: number }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      style={{ transform: `rotate(${rotate}deg)`, transition: 'transform 200ms ease' }}
    >
      <path
        d="M4.5 3l3 3-3 3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
      {children}
    </div>
  );
}
