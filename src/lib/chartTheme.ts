/**
 * One look for every chart.
 *
 * Five charts across three screens each carried their own copy of the axis
 * grey, the grid grey, the line colour and a tooltip style — the same values
 * typed out five times, and already drifting: two cursor greys, and a white
 * boxed tooltip on four charts beside a dark one on the fifth. Recharts takes
 * colours as props rather than classes, so the palette lives here as values,
 * named after the Tailwind tokens they mirror. Change one in
 * tailwind.config.js and change it here.
 */
export const CHART = {
  ink: '#0A0A0A',
  muted: '#8E8E93',
  line: '#E5E5EA',
  /** A bar that isn't the one you're looking at; a reading under its goal. */
  faint: '#C9C9CE',
  /** The ink at a wash: every other week's bar beside this week's. */
  inkFaint: 'rgba(10,10,10,0.14)',
  /** The highlight behind the bar a finger is on. */
  cursorFill: 'rgba(10,10,10,0.04)',
} as const;

/** Axis labels: small and grey, with no axis line — the same on every chart. */
export const AXIS_TICK = { fill: CHART.muted, fontSize: 10 } as const;

export type ChartNote = { text: string; tone: 'good' | 'bad' | 'muted' };
