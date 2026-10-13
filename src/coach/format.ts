// Numbers as the coach dashboard shows them. Kept in one place so a figure
// reads the same in a tile, a table cell and a tooltip.

import { useSyncExternalStore } from 'react';
import { formatStoneLb, formatWeight, kgToLb, type MachineUnit } from '../lib/units';
import { oneDp } from '../lib/coach/coachWeek';

export type CoachLiftUnit = 'kg' | 'lb';
export type CoachBodyUnit = 'kg' | 'st';

export interface CoachUnits {
  lift: CoachLiftUnit;
  body: CoachBodyUnit;
}

const KEY = 'reps.coach.units';
const DEFAULT_UNITS: CoachUnits = { lift: 'kg', body: 'kg' };
const listeners = new Set<() => void>();
let cached: CoachUnits | null = null;

function read(): CoachUnits {
  if (cached) return cached;
  try {
    const raw = window.localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as Partial<CoachUnits>) : {};
    cached = {
      lift: v.lift === 'lb' ? 'lb' : 'kg',
      body: v.body === 'st' ? 'st' : 'kg',
    };
  } catch {
    cached = DEFAULT_UNITS;
  }
  return cached;
}

/** The coach's own units — theirs, not the athlete's, since one coach reads
 *  many athletes. Kept on this computer. */
export function useCoachUnits(): CoachUnits {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => DEFAULT_UNITS,
  );
}

export function setCoachUnits(next: CoachUnits): void {
  cached = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Not saved; the choice still holds until the tab closes.
  }
  for (const l of listeners) l();
}

/** A lift's weight: pin positions stay pins, everything else in the coach's unit. */
export function liftWeight(kg: number, unit: CoachLiftUnit, machine?: MachineUnit): string {
  if (machine === 'pin') return formatWeight(kg, 'pin');
  const v = unit === 'lb' ? kgToLb(kg) : kg;
  return `${oneDp(v)} ${unit}`;
}

export function liftSet(kg: number | null, reps: number | null, unit: CoachLiftUnit, machine?: MachineUnit): string {
  if (kg == null) return reps != null ? `${reps} reps` : '–';
  return `${liftWeight(kg, unit, machine)} × ${reps ?? '–'}`;
}

/** Total volume — big numbers, so no decimals and a thousands separator. */
export function volume(kg: number, unit: CoachLiftUnit): string {
  const v = unit === 'lb' ? kgToLb(kg) : kg;
  return `${Math.round(v).toLocaleString('en-GB')} ${unit}`;
}

export function bodyWeight(kg: number, unit: CoachBodyUnit): string {
  return unit === 'st' ? formatStoneLb(kg) : `${oneDp(kg)} kg`;
}

/** A difference in body weight, in the unit it's read in — lb under stones. */
export function bodyWeightDelta(kg: number, unit: CoachBodyUnit): string {
  return unit === 'st' ? `${oneDp(kgToLb(kg))} lb` : `${oneDp(kg)} kg`;
}

export function hours(h: number): string {
  return `${oneDp(h)} h`;
}

export function count(n: number): string {
  return Math.round(n).toLocaleString('en-GB');
}

export function pct(p: number): string {
  const r = Math.round(p);
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r)}%`;
}

/** "21 Sep" */
export function shortDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d.length === 10 ? `${d}T00:00:00` : d) : d;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** "Mon" */
export function weekdayName(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short' });
}

/** "3 days ago", "Yesterday", "Today" — for "last trained". */
export function ago(iso: string, now: Date = new Date()): string {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(new Date(iso))) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 14) return `${days} days ago`;
  return shortDate(iso);
}
