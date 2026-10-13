// The pieces every coach screen is built from: a card, a stat with its
// change on the comparison week, and a small single-series chart over weeks.

import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartTooltip } from '../components/ChartTooltip';
import { AXIS_TICK, CHART } from '../lib/chartTheme';
import type { LiftPoint, Measure } from '../lib/coach/coachWeek';
import { shortDate } from './format';

export function Card({
  title,
  aside,
  children,
  className = '',
}: {
  title?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-card bg-paper-card p-5 shadow-card sm:p-6 ${className}`}>
      {(title || aside) && (
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          {title && <h2 className="text-base font-semibold tracking-tight text-ink">{title}</h2>}
          {aside && <div className="text-xs text-muted">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Which way is better for a figure: up, down, or neither (body weight, whose
 *  right direction depends on the athlete's goal). */
export type Better = 'up' | 'down' | 'neither';

/**
 * "▲ 0.4 kg" beside a figure — the arrow and the words carry the direction,
 * the colour only backs them up. Nothing when there's nothing to compare.
 */
export function Delta({
  m,
  format,
  better = 'up',
  asPct = false,
  quiet = false,
}: {
  m: Measure;
  format: (n: number) => string;
  better?: Better;
  asPct?: boolean;
  /** Say nothing rather than "No change" — for tight table cells. */
  quiet?: boolean;
}) {
  if (m.current == null || m.previous == null) return null;
  const diff = m.current - m.previous;
  const pctDiff = m.previous !== 0 ? (diff / m.previous) * 100 : null;
  const size = asPct ? Math.abs(pctDiff ?? 0) : Math.abs(diff);
  if ((asPct && pctDiff == null) || size < (asPct ? 0.5 : 0.05)) {
    return quiet ? null : <span className="whitespace-nowrap text-xs text-muted">No change</span>;
  }
  const up = diff > 0;
  const good = better === 'neither' ? null : (better === 'up') === up;
  const tone = good == null ? 'text-muted' : good ? 'text-good' : 'text-danger';
  return (
    <span className={`whitespace-nowrap text-xs font-semibold tabular-nums ${tone}`}>
      {up ? '▲' : '▼'} {asPct ? `${Math.round(size)}%` : format(Math.abs(diff))}
    </span>
  );
}

export function Stat({
  label,
  value,
  m,
  format,
  better,
  asPct,
  hint,
}: {
  label: string;
  value: string;
  m: Measure;
  format: (n: number) => string;
  better?: Better;
  asPct?: boolean;
  hint?: string;
}) {
  return (
    <div className="rounded-panel bg-paper-card p-4 shadow-card">
      <div className="text-label font-semibold uppercase tracking-eyebrow text-muted">{label}</div>
      <div className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight text-ink">{value}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <Delta m={m} format={format} better={better} asPct={asPct} />
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </div>
    </div>
  );
}

export interface WeekPoint {
  /** yyyy-mm-dd of the Monday. */
  week: string;
  value: number | null;
}

/**
 * One measure over weeks: bars for totals, a line for levels (body weight,
 * how it felt). The week being looked at is drawn in ink and the rest faint,
 * so the eye lands on it first.
 */
export function WeekTrend({
  title,
  points,
  selected,
  kind,
  format,
  onSelect,
  domain,
}: {
  title: string;
  points: WeekPoint[];
  selected: string;
  kind: 'bar' | 'line';
  format: (n: number) => string;
  onSelect?: (week: string) => void;
  domain?: [number | 'auto' | 'dataMin', number | 'auto' | 'dataMax'];
}) {
  const hasData = points.some((p) => p.value != null && p.value > 0);
  const tooltip = (
    <Tooltip
      cursor={kind === 'bar' ? { fill: CHART.cursorFill } : { stroke: CHART.line }}
      content={
        <ChartTooltip<WeekPoint>
          title={(p) => `Week of ${shortDate(p.week)}`}
          value={(p) => (p.value == null ? 'Nothing logged' : format(p.value))}
        />
      }
    />
  );
  const xAxis = (
    <XAxis
      dataKey="week"
      tick={AXIS_TICK}
      axisLine={false}
      tickLine={false}
      minTickGap={12}
      tickFormatter={(w: string) => shortDate(w)}
    />
  );
  const yAxis = (
    <YAxis
      tick={AXIS_TICK}
      axisLine={false}
      tickLine={false}
      width={44}
      domain={domain}
      tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(Math.round(v * 10) / 10))}
    />
  );
  return (
    <div className="rounded-panel bg-paper-card p-4 shadow-card">
      <div className="text-sm font-semibold text-ink">{title}</div>
      <div className="mt-2 h-36">
        {!hasData ? (
          <div className="flex h-full items-center justify-center text-xs text-muted">Nothing logged</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {kind === 'bar' ? (
              <BarChart
                data={points}
                margin={{ top: 6, right: 4, bottom: 0, left: -12 }}
                onClick={(e) => {
                  const w = (e as { activeLabel?: string } | null)?.activeLabel;
                  if (w && onSelect) onSelect(w);
                }}
              >
                {xAxis}
                {yAxis}
                {tooltip}
                <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={22} cursor={onSelect ? 'pointer' : undefined}>
                  {points.map((p) => (
                    <Cell key={p.week} fill={p.week === selected ? CHART.ink : CHART.inkFaint} />
                  ))}
                </Bar>
              </BarChart>
            ) : (
              <LineChart data={points} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
                {xAxis}
                {yAxis}
                {tooltip}
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={CHART.ink}
                  strokeWidth={2}
                  connectNulls
                  isAnimationActive={false}
                  dot={(props: { cx?: number; cy?: number; payload?: WeekPoint; index?: number }) => {
                    const on = props.payload?.week === selected && props.payload?.value != null;
                    return (
                      <circle
                        key={props.index}
                        cx={props.cx}
                        cy={props.cy}
                        r={on ? 4.5 : 0}
                        fill={CHART.ink}
                        stroke="#fff"
                        strokeWidth={2}
                      />
                    );
                  }}
                  activeDot={{ r: 4.5, fill: CHART.ink, stroke: '#fff', strokeWidth: 2 }}
                />
              </LineChart>
            )}
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

/** A 1–5 rating as a row of five pips, filled up to the value. */
export function Pips({ value, invert = false }: { value: number | null; invert?: boolean }) {
  if (value == null) return <span className="text-xs text-muted">–</span>;
  const filled = Math.round(value);
  return (
    <span
      className="inline-flex gap-0.5 align-middle"
      aria-label={`${Math.round(value * 10) / 10} of 5${invert ? ', lower is better' : ''}`}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`h-2 w-2 rounded-full ${i <= filled ? 'bg-ink' : 'bg-line'}`} />
      ))}
    </span>
  );
}

/**
 * One lift over time: the weight of its best set each session. The tooltip
 * gives the full set, so a session that added reps rather than weight still
 * reads as progress.
 */
export function BestSetChart({
  history,
  format,
  setLabel,
  height = 160,
}: {
  history: LiftPoint[];
  /** A weight in kg, in the viewer's unit. */
  format: (kg: number) => string;
  /** The session's best set, as words. */
  setLabel: (p: LiftPoint) => string;
  height?: number;
}) {
  const points = history.filter((p) => p.top != null).map((p) => ({ ...p, weightKg: p.top!.weightKg }));
  if (points.length < 2) {
    return (
      <div className="flex items-center justify-center text-xs text-muted" style={{ height }}>
        {points.length === 1 ? 'One session so far' : 'No weighted sets'}
      </div>
    );
  }
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
          <XAxis
            dataKey="date"
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            minTickGap={16}
            tickFormatter={(d: string) => shortDate(d)}
          />
          <YAxis
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            width={44}
            domain={['dataMin', 'dataMax']}
            tickFormatter={(v: number) => String(Math.round(v * 10) / 10)}
          />
          <Tooltip
            cursor={{ stroke: CHART.line }}
            content={
              <ChartTooltip<LiftPoint & { weightKg: number }>
                title={(p) => shortDate(p.date)}
                value={(p) => setLabel(p)}
                note={(p) => ({ text: `Heaviest ${format(p.weightKg)}`, tone: 'muted' })}
              />
            }
          />
          <Line
            type="monotone"
            dataKey="weightKg"
            stroke={CHART.ink}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4.5, fill: CHART.ink, stroke: '#fff', strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
