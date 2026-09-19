import { useEffect, useState } from 'react';

/**
 * How long a workout has been running, as a clock.
 *
 * Minutes and seconds until the hour, then hours as well — a workout that has
 * been going ninety minutes should say so, but padding every session out to
 * `00:41:12` to make room for an hour most of them never reach turns the
 * common case into arithmetic.
 */
export function formatElapsed(startedAt: string): string {
  const elapsed = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  if (mins >= 60) {
    return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * The same clock, ticking. Two things show it at once — the card on Home and
 * the bar docked over the tab bar — and a timer that drifts between them by a
 * second reads as a bug, so they share one implementation rather than two
 * intervals started at whatever moment each component happened to mount.
 */
export function useElapsedLabel(startedAt: string): string {
  // The interval exists to force a render, not to carry the value — the label
  // is worked out from the clock on the way past, so it is right on the first
  // frame and stays right if `startedAt` changes under it.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  return formatElapsed(startedAt);
}
