import { useState } from 'react';

interface Props {
  value: string; // YYYY-MM-DD
  onChange: (date: string) => void;
  maxISO?: string;
}

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
function iso(y: number, m: number, d: number): string {
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}
function todayISO(): string {
  const d = new Date();
  return iso(d.getFullYear(), d.getMonth(), d.getDate());
}

export function Calendar({ value, onChange, maxISO }: Props) {
  const initial = value ? new Date(value + 'T00:00:00') : new Date();
  const [year, setYear] = useState(initial.getFullYear());
  const [month, setMonth] = useState(initial.getMonth());

  const firstOfMonth = new Date(year, month, 1);
  const lastOfMonth = new Date(year, month + 1, 0);
  const startDayMon = (firstOfMonth.getDay() + 6) % 7;
  const daysInMonth = lastOfMonth.getDate();

  const cells: (number | null)[] = [];
  for (let i = 0; i < startDayMon; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const today = todayISO();

  function navigate(delta: number) {
    let m = month + delta;
    let y = year;
    while (m < 0) {
      m += 12;
      y -= 1;
    }
    while (m > 11) {
      m -= 12;
      y += 1;
    }
    setMonth(m);
    setYear(y);
  }

  const monthIsAtMax = maxISO
    ? year > Number(maxISO.slice(0, 4)) ||
      (year === Number(maxISO.slice(0, 4)) && month >= Number(maxISO.slice(5, 7)) - 1)
    : false;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex h-8 w-8 items-center justify-center rounded-full text-ink active:bg-line"
          aria-label="Previous month"
        >
          <ChevronLeft />
        </button>
        <div className="text-sm font-semibold tracking-tight text-ink">
          {MONTHS[month]} {year}
        </div>
        <button
          type="button"
          onClick={() => navigate(1)}
          disabled={monthIsAtMax}
          className="flex h-8 w-8 items-center justify-center rounded-full text-ink active:bg-line disabled:opacity-30"
          aria-label="Next month"
        >
          <ChevronRight />
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
          gap: '2px',
        }}
      >
        {DOW.map((d, i) => (
          <div
            key={i}
            className="flex h-6 items-center justify-center text-[10px] font-semibold uppercase tracking-wider text-muted"
          >
            {d}
          </div>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <div key={i} className="h-8" />;
          const cellIso = iso(year, month, d);
          const isSelected = cellIso === value;
          const isToday = cellIso === today;
          const isFuture = !!maxISO && cellIso > maxISO;
          return (
            <button
              key={i}
              type="button"
              disabled={isFuture}
              onClick={() => onChange(cellIso)}
              className={`flex h-8 w-full items-center justify-center rounded-lg text-[13px] transition-colors ${
                isSelected
                  ? 'bg-ink font-semibold text-white'
                  : isFuture
                    ? 'text-muted/30'
                    : isToday
                      ? 'font-semibold text-ink ring-1 ring-inset ring-ink active:bg-line/60'
                      : 'text-ink active:bg-line/60'
              }`}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface PopoverProps {
  open: boolean;
  value: string;
  onSelect: (date: string) => void;
  maxISO?: string;
}

export function CalendarPopover({ open, value, onSelect, maxISO }: PopoverProps) {
  if (!open) return null;
  return (
    <div
      className="mt-2 overflow-hidden rounded-2xl bg-paper-card p-3 shadow-[0_8px_24px_rgba(0,0,0,0.08)] ring-1 ring-line"
      role="dialog"
    >
      <Calendar value={value} maxISO={maxISO} onChange={onSelect} />
    </div>
  );
}

function ChevronLeft() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path
        d="M11 4L6 9l5 5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function ChevronRight() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
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
