import { useRef, useState } from 'react';
import { birthdayNote, dobProblem, splitISODate, toISODate } from '../lib/dob';

function digitsOnly(v: string, max: number): string {
  return v.replace(/\D/g, '').slice(0, max);
}

const boxClass =
  'w-full rounded-panel border border-line bg-paper-card px-3 py-3.5 text-center text-xl font-semibold tracking-tight text-ink tabular-nums placeholder:font-normal placeholder:tracking-normal placeholder:text-muted/60 focus:border-ink focus:outline-none';

/**
 * Date of birth as three boxes — day, month, year.
 *
 * A native date picker means scrolling back decades to reach a birthday;
 * typing six digits is faster and works the same on every platform. Focus
 * hops forward as each box fills and back on backspace, so the whole date is
 * one uninterrupted run of digits.
 *
 * `onChange` receives an ISO date, or '' whenever the boxes don't hold a
 * usable one — callers can treat a non-empty value as valid.
 */
export function DateOfBirthInput({
  value,
  onChange,
  onEnter,
  compact = false,
}: {
  value: string | null;
  onChange: (iso: string) => void;
  onEnter?: () => void;
  /** Tighter sizing for the profile sheet, where the row is already snug. */
  compact?: boolean;
}) {
  const seed = splitISODate(value);
  const [d, setD] = useState(seed.d);
  const [m, setM] = useState(seed.m);
  const [y, setY] = useState(seed.y);

  const dayRef = useRef<HTMLInputElement>(null);
  const monthRef = useRef<HTMLInputElement>(null);
  const yearRef = useRef<HTMLInputElement>(null);

  const message = dobProblem(d, m, y);
  const iso = toISODate(d, m, y);
  const note = !message && iso ? birthdayNote(iso) : null;

  function emit(nd: string, nm: string, ny: string) {
    const next = toISODate(nd, nm, ny);
    onChange(next && !dobProblem(nd, nm, ny) ? next : '');
  }

  /**
   * Tidy "5" into "05" once they've moved on, so the row reads evenly.
   *
   * Updating from the previous state rather than the rendered one matters:
   * advancing focus blurs the box in the same tick it was typed into, and a
   * handler reading that render's value would still see it empty.
   */
  function pad(set: React.Dispatch<React.SetStateAction<string>>) {
    set((v) => (v.length === 1 ? `0${v}` : v));
  }

  function handleKeyDown(
    e: React.KeyboardEvent<HTMLInputElement>,
    current: string,
    previous: HTMLInputElement | null
  ) {
    if (e.key === 'Enter') {
      onEnter?.();
      return;
    }
    if (e.key === 'Backspace' && current === '' && previous) {
      e.preventDefault();
      previous.focus();
      previous.setSelectionRange(previous.value.length, previous.value.length);
    }
  }

  const sizing = compact ? 'px-2 py-3 text-base' : '';

  return (
    <div>
      <div className="grid grid-cols-[1fr_1fr_1.6fr] gap-2">
        <input
          ref={dayRef}
          value={d}
          onChange={(e) => {
            const next = digitsOnly(e.target.value, 2);
            setD(next);
            emit(next, m, y);
            // Two digits, or a day that can't take a second one.
            if (next.length === 2 || Number(next) > 3) monthRef.current?.focus();
          }}
          onKeyDown={(e) => handleKeyDown(e, d, null)}
          onFocus={(e) => e.target.select()}
          onBlur={() => pad(setD)}
          inputMode="numeric"
          autoComplete="bday-day"
          aria-label="Day"
          placeholder="DD"
          className={`${boxClass} ${sizing}`}
        />
        <input
          ref={monthRef}
          value={m}
          onChange={(e) => {
            const next = digitsOnly(e.target.value, 2);
            setM(next);
            emit(d, next, y);
            if (next.length === 2 || Number(next) > 1) yearRef.current?.focus();
          }}
          onKeyDown={(e) => handleKeyDown(e, m, dayRef.current)}
          onFocus={(e) => e.target.select()}
          onBlur={() => pad(setM)}
          inputMode="numeric"
          autoComplete="bday-month"
          aria-label="Month"
          placeholder="MM"
          className={`${boxClass} ${sizing}`}
        />
        <input
          ref={yearRef}
          value={y}
          onChange={(e) => {
            const next = digitsOnly(e.target.value, 4);
            setY(next);
            emit(d, m, next);
          }}
          onKeyDown={(e) => handleKeyDown(e, y, monthRef.current)}
          onFocus={(e) => e.target.select()}
          inputMode="numeric"
          autoComplete="bday-year"
          aria-label="Year"
          placeholder="YYYY"
          className={`${boxClass} ${sizing}`}
        />
      </div>
      {message && <p className="mt-2 text-sm text-danger">{message}</p>}
      {note && <p className="mt-2 text-sm text-good">{note}</p>}
    </div>
  );
}
