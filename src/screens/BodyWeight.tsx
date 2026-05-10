import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
import {
  listBodyWeights,
  logBodyWeight,
  deleteBodyWeight,
  getTodayEntry,
  type BodyWeightRow,
} from '../lib/bodyWeightApi';
import {
  getBodyWeightUnit,
  setBodyWeightUnit,
  kgToStoneLb,
  stoneLbToKg,
  formatStoneLb,
  type BodyWeightUnit,
} from '../lib/units';
import { BottomNav } from '../components/BottomNav';
import { PageHeader } from '../components/PageHeader';
import { CalendarPopover } from '../components/Calendar';
import { ConfirmModal } from '../components/ConfirmModal';

interface Props {
  onBack: () => void;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatEntryDate(iso: string): string {
  const today = todayISO();
  if (iso === today) return 'Today';
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yIso = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  if (iso === yIso) return 'Yesterday';
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export function BodyWeight({ onBack }: Props) {
  const [rows, setRows] = useState<BodyWeightRow[]>([]);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [unit, setUnitState] = useState<BodyWeightUnit>(getBodyWeightUnit());
  const [kgInput, setKgInput] = useState('');
  const [stInput, setStInput] = useState('');
  const [lbInput, setLbInput] = useState('');
  const [date, setDate] = useState<string>(todayISO());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    listBodyWeights()
      .then((r) => mounted && setRows(r))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, []);

  const todayEntry = getTodayEntry(rows);

  // Compute kg from current inputs
  let inputKg: number | null = null;
  if (unit === 'kg') {
    const v = parseFloat(kgInput);
    if (!Number.isNaN(v) && v > 0) inputKg = v;
  } else {
    const s = parseFloat(stInput);
    const p = parseFloat(lbInput || '0');
    if (!Number.isNaN(s) && s > 0) {
      inputKg = stoneLbToKg(s, Number.isNaN(p) ? 0 : p);
    }
  }

  function changeUnit(next: BodyWeightUnit) {
    setUnitState(next);
    setBodyWeightUnit(next);
  }

  async function handleSave() {
    if (inputKg == null) return;
    setSaving(true);
    setError(null);
    try {
      const newRow = await logBodyWeight(parseFloat(inputKg.toFixed(2)), date);
      setRows((prev) => {
        const filtered = prev.filter((r) => r.recorded_on !== newRow.recorded_on);
        return [newRow, ...filtered].sort((a, b) =>
          a.recorded_on < b.recorded_on ? 1 : -1
        );
      });
      setKgInput('');
      setStInput('');
      setLbInput('');
      setDate(todayISO());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    await deleteBodyWeight(id);
    setRows((prev) => prev.filter((r) => r.id !== id));
    setPendingDeleteId(null);
  }

  // Chart data — chronological, in chosen unit (decimal stones for st mode)
  const chartData = useMemo(() => {
    return [...rows].reverse().map((r) => ({
      date: r.recorded_on,
      kg: r.weight_kg,
      value:
        unit === 'kg'
          ? r.weight_kg
          : kgToStoneLb(r.weight_kg).stones + kgToStoneLb(r.weight_kg).pounds / 14,
    }));
  }, [rows, unit]);

  const latest = rows[0];
  const firstEntry = rows[rows.length - 1];
  const totalChangeKg = latest && firstEntry ? latest.weight_kg - firstEntry.weight_kg : 0;
  const totalChangeDisplay =
    unit === 'kg'
      ? `${totalChangeKg >= 0 ? '+' : ''}${totalChangeKg.toFixed(1)} kg`
      : (() => {
          const sign = totalChangeKg >= 0 ? '+' : '-';
          return `${sign}${formatStoneLb(Math.abs(totalChangeKg))}`;
        })();

  return (
    <div className="min-h-screen bg-paper pb-28">
      <div className="mx-auto max-w-md px-5 pt-3">
        <PageHeader title="Body weight" onBack={onBack} />

        <div className="mt-6">
          <h1 className="text-[28px] font-bold leading-[1.1] tracking-tight text-ink">
            {todayEntry ? 'Logged today' : "Log today's weight"}
          </h1>
          {todayEntry && (
            <p className="mt-1.5 text-base text-muted">
              {primaryDisplay(todayEntry.weight_kg, unit)}
              {' · '}
              <span className="text-muted">
                {secondaryDisplay(todayEntry.weight_kg, unit)}
              </span>
            </p>
          )}
        </div>

        <div className="mt-6 rounded-card bg-paper-card p-5 shadow-card">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
              New entry
            </div>
            <UnitToggle unit={unit} onChange={changeUnit} />
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
              setDate(d);
              setCalendarOpen(false);
            }}
          />

          {unit === 'kg' ? (
            <div className="mt-4 flex items-end gap-3">
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                value={kgInput}
                onChange={(e) => setKgInput(e.target.value)}
                placeholder="e.g. 82.4"
                className="w-full rounded-2xl border border-line bg-paper-card px-4 py-3.5 text-2xl font-bold tracking-tight text-ink focus:border-ink focus:outline-none"
              />
              <div className="pb-3 text-base font-medium text-muted">kg</div>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <input
                  type="number"
                  inputMode="numeric"
                  step="1"
                  value={stInput}
                  onChange={(e) => setStInput(e.target.value)}
                  placeholder="14"
                  className="w-full rounded-2xl border border-line bg-paper-card px-4 py-3.5 text-2xl font-bold tracking-tight text-ink focus:border-ink focus:outline-none"
                />
                <div className="mt-1 text-xs font-medium uppercase tracking-wider text-muted">
                  Stones
                </div>
              </div>
              <div>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  value={lbInput}
                  onChange={(e) => setLbInput(e.target.value)}
                  placeholder="5"
                  className="w-full rounded-2xl border border-line bg-paper-card px-4 py-3.5 text-2xl font-bold tracking-tight text-ink focus:border-ink focus:outline-none"
                />
                <div className="mt-1 text-xs font-medium uppercase tracking-wider text-muted">
                  Pounds
                </div>
              </div>
            </div>
          )}

          {inputKg != null && (
            <div className="mt-3 text-xs text-muted">
              ≈ {unit === 'kg' ? formatStoneLb(inputKg) : `${inputKg.toFixed(1)} kg`}
            </div>
          )}
          {error && <div className="mt-3 text-sm text-red-700">{error}</div>}
          <button
            onClick={handleSave}
            disabled={inputKg == null || saving}
            className="mt-4 w-full rounded-pill bg-ink py-3.5 text-base font-semibold text-white transition-opacity active:opacity-80 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>

        {rows.length >= 2 && (
          <div className="mt-7">
            <div className="flex items-baseline justify-between">
              <SectionLabel>Trend</SectionLabel>
              <div className="text-xs text-muted">{totalChangeDisplay} all time</div>
            </div>
            <div className="mt-3 rounded-card bg-paper-card p-4 shadow-card">
              <ResponsiveContainer width="100%" height={180}>
                <LineChart
                  data={chartData}
                  margin={{ top: 10, right: 8, bottom: 0, left: -16 }}
                >
                  <XAxis
                    dataKey="date"
                    tick={{ fill: '#8E8E93', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={24}
                    tickFormatter={(d) => {
                      const dt = new Date(d);
                      return dt.toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                      });
                    }}
                  />
                  <YAxis
                    tick={{ fill: '#8E8E93', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    domain={['dataMin - 0.5', 'dataMax + 0.5']}
                    width={32}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 12,
                      border: '1px solid #E5E5EA',
                      fontSize: 12,
                    }}
                    formatter={(_v, _name, item) => {
                      const kg = (item?.payload as { kg: number } | undefined)?.kg ?? 0;
                      return [primaryDisplay(kg, unit), 'Weight'];
                    }}
                    labelFormatter={(d) =>
                      new Date(d).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#0A0A0A"
                    strokeWidth={2}
                    dot={{ r: 2.5, fill: '#0A0A0A' }}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
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
              No entries yet. Log your first weight above.
            </div>
          ) : (
            <ul className="mt-3 divide-y divide-line overflow-hidden rounded-card bg-paper-card shadow-card">
              {rows.map((r) => {
                const date = new Date(r.recorded_on + 'T00:00:00');
                return (
                  <li key={r.id} className="flex items-center justify-between px-5 py-4">
                    <div>
                      <div className="text-sm font-semibold text-ink">
                        {date.toLocaleDateString('en-GB', {
                          weekday: 'short',
                          day: 'numeric',
                          month: 'short',
                        })}
                      </div>
                      <div className="text-xs text-muted">
                        {secondaryDisplay(r.weight_kg, unit)}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-lg font-bold tracking-tight text-ink">
                        {primaryDisplay(r.weight_kg, unit)}
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
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <BottomNav active="home" />
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

function primaryDisplay(kg: number, unit: BodyWeightUnit): string {
  return unit === 'kg' ? `${kg.toFixed(1)} kg` : formatStoneLb(kg);
}

function secondaryDisplay(kg: number, unit: BodyWeightUnit): string {
  return unit === 'kg' ? formatStoneLb(kg) : `${kg.toFixed(1)} kg`;
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

function UnitToggle({
  unit,
  onChange,
}: {
  unit: BodyWeightUnit;
  onChange: (u: BodyWeightUnit) => void;
}) {
  return (
    <div className="flex rounded-pill bg-line p-0.5">
      {(['kg', 'st'] as const).map((u) => (
        <button
          key={u}
          onClick={() => onChange(u)}
          className={`rounded-pill px-3 py-1 text-xs font-semibold uppercase tracking-wider transition-colors ${
            unit === u ? 'bg-ink text-white' : 'text-muted'
          }`}
        >
          {u}
        </button>
      ))}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
      {children}
    </div>
  );
}

