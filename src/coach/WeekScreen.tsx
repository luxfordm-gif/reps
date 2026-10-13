// One athlete's week, set against the week before (or, on a rotating plan,
// the last time the same sessions came round). Read top to bottom it answers
// the coach's questions in order: anything to worry about, did they do the
// work, how did it feel, are they getting stronger, and what's the trend.

import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  addDays,
  buildCoachWeek,
  dayKey,
  feelScore,
  mondayOf,
  oneDp,
  parseWeek,
  weeklyTrends,
  type CoachWeek,
  type Comparison,
  type Flag,
} from '../lib/coach/coachWeek';
import type { AthleteData } from '../lib/coach/coachApi';
import { DEMO_ATHLETE_ID } from '../lib/coach/demoData';
import { weekRange } from '../lib/coachSummary';
import { RATING_QUESTIONS, type RatingKey } from '../lib/checkin';
import { useAthlete } from './athleteContext';
import { Segmented } from './CoachApp';
import {
  bodyWeight,
  bodyWeightDelta,
  count,
  hours,
  liftSet,
  pct,
  shortDate,
  useCoachUnits,
  volume,
  weekdayName,
  type CoachUnits,
} from './format';
import { Card, Delta, Pips, Stat, WeekTrend, type Better } from './ui';

/** The week to open on: this one once anything's been logged in it, otherwise
 *  the week just finished — which is what a coach wants on a Monday morning. */
function defaultWeek(data: AthleteData, now: Date): Date {
  const thisWeek = mondayOf(now);
  const from = thisWeek.toISOString();
  const thisKey = dayKey(thisWeek);
  const started =
    data.sessions.some((s) => s.completedAt >= from) ||
    [...data.logs.weights, ...data.logs.sleep, ...data.logs.steps].some((r) => r.recorded_on >= thisKey);
  return started ? thisWeek : addDays(thisWeek, -7);
}

export function WeekScreen() {
  const { athleteId, data } = useAthlete();
  const units = useCoachUnits();
  const [params, setParams] = useSearchParams();
  // Fixed for the life of the page, so "this week" doesn't move under the
  // coach if they leave it open past midnight on Sunday.
  const [now] = useState(() => new Date());
  const thisMonday = mondayOf(now);
  const requested = parseWeek(params.get('week'));
  const weekKey = dayKey(
    requested && requested.getTime() <= thisMonday.getTime()
      ? requested
      : // The sample opens on a full week: it's there to show what one looks like.
        athleteId === DEMO_ATHLETE_ID
        ? addDays(thisMonday, -7)
        : defaultWeek(data, now),
  );
  const weekStart = parseWeek(weekKey)!;
  const compare: Comparison = params.get('vs') === 'rotation' && data.rotationWeeks >= 2 ? 'rotation' : 'last';

  const week = buildCoachWeek(data, weekStart, compare, now);
  const trends = weeklyTrends(data, weekStart, 12);

  function go(next: Date, vs: Comparison = compare) {
    const p = new URLSearchParams();
    p.set('week', dayKey(next));
    if (vs === 'rotation') p.set('vs', 'rotation');
    setParams(p);
  }

  const vsLabel =
    week.comparisonWeeksBack === 1 ? 'last week' : `${week.comparisonWeeksBack} weeks ago`;
  const canGoForward = addDays(weekStart, 7).getTime() <= thisMonday.getTime();

  return (
    <div className="mt-6 space-y-6">
      {/* Which week, and against what. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <NavButton label="Previous week" onClick={() => go(addDays(weekStart, -7))}>
            ‹
          </NavButton>
          <div className="min-w-[11rem] px-2 text-center">
            <div className="text-base font-semibold text-ink">{weekRange(weekStart)}</div>
            <div className="text-xs text-muted">
              {week.complete ? 'Full week' : 'This week so far'}
            </div>
          </div>
          <NavButton label="Next week" disabled={!canGoForward} onClick={() => go(addDays(weekStart, 7))}>
            ›
          </NavButton>
          {weekStart.getTime() !== thisMonday.getTime() && (
            <button
              onClick={() => go(thisMonday)}
              className="ml-2 rounded-pill px-3 py-1.5 text-sm font-semibold text-ink hover:bg-pressed"
            >
              This week
            </button>
          )}
        </div>
        {data.rotationWeeks >= 2 ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">Compare with</span>
            <Segmented
              value={compare}
              options={[
                { value: 'last', label: 'Last week' },
                { value: 'rotation', label: `Same sessions, ${data.rotationWeeks} weeks ago` },
              ]}
              onChange={(v) => go(weekStart, v)}
            />
          </div>
        ) : (
          <span className="text-xs text-muted">
            {week.complete ? 'Compared with last week' : 'Compared with last week, to the same day'}
          </span>
        )}
      </div>

      <Flags flags={week.flags} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Sessions"
          value={week.target > 0 ? `${week.workouts.current} of ${week.target}` : String(week.workouts.current)}
          m={week.workouts}
          format={(n) => String(n)}
          hint={week.complete ? `vs ${vsLabel}` : `vs ${vsLabel}, to the same day`}
        />
        <Stat label="Sets" value={count(week.sets.current ?? 0)} m={week.sets} format={count} asPct />
        <Stat
          label="Volume"
          value={volume(week.volumeKg.current ?? 0, units.lift)}
          m={week.volumeKg}
          format={count}
          asPct
        />
        <div className="rounded-panel bg-paper-card p-4 shadow-card">
          <div className="text-label font-semibold uppercase tracking-eyebrow text-muted">Strength</div>
          <div className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight text-ink">
            {week.strengthPct != null ? pct(week.strengthPct) : '–'}
          </div>
          <div className="mt-1 text-xs text-muted">
            {week.strengthPct != null
              ? `Estimated 1RM on ${week.lifts.length} ${week.lifts.length === 1 ? 'lift' : 'lifts'} done both weeks`
              : 'No lifts done in both weeks'}
          </div>
        </div>
        <Stat
          label="Body weight"
          value={week.weightKg.current != null ? bodyWeight(week.weightKg.current, units.body) : '–'}
          m={week.weightKg}
          format={(n) => bodyWeightDelta(n, units.body)}
          better="neither"
          hint="average"
        />
        <Stat
          label="Sleep"
          value={week.sleepHours.current != null ? hours(week.sleepHours.current) : '–'}
          m={week.sleepHours}
          format={hours}
          hint="a night"
        />
        <Stat
          label="Steps"
          value={week.steps.current != null ? count(week.steps.current) : '–'}
          m={week.steps}
          format={count}
          hint="a day"
        />
        <Stat
          label="Water"
          value={week.water.current != null ? oneDp(week.water.current) : '–'}
          m={week.water}
          format={oneDp}
          hint="a day, in their units"
        />
      </div>

      <WeekGrid week={week} athleteId={athleteId} units={units} />

      <div className="grid gap-6 lg:grid-cols-2">
        <FeelCard week={week} vsLabel={vsLabel} />
        <StrengthCard week={week} athleteId={athleteId} units={units} data={data} vsLabel={vsLabel} />
      </div>

      <BodyPartsCard week={week} athleteId={athleteId} units={units} vsLabel={vsLabel} />

      <Card title="Last 12 weeks" aside="Click a bar to open that week">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <WeekTrend
            title="Sessions"
            kind="bar"
            selected={dayKey(weekStart)}
            points={trends.map((t) => ({ week: t.weekStart, value: t.workouts }))}
            format={(n) => `${n} ${n === 1 ? 'session' : 'sessions'}`}
            onSelect={(w) => go(parseWeek(w)!)}
          />
          <WeekTrend
            title="Volume"
            kind="bar"
            selected={dayKey(weekStart)}
            points={trends.map((t) => ({ week: t.weekStart, value: t.volumeKg }))}
            format={(n) => volume(n, units.lift)}
            onSelect={(w) => go(parseWeek(w)!)}
          />
          <WeekTrend
            title="How it felt (1 to 5)"
            kind="line"
            domain={[1, 5]}
            selected={dayKey(weekStart)}
            points={trends.map((t) => ({ week: t.weekStart, value: t.feel }))}
            format={(n) => `${oneDp(n)} of 5`}
          />
          <WeekTrend
            title="Body weight"
            kind="line"
            domain={['dataMin', 'dataMax']}
            selected={dayKey(weekStart)}
            points={trends.map((t) => ({ week: t.weekStart, value: t.weightKg }))}
            format={(n) => bodyWeight(n, units.body)}
          />
          <WeekTrend
            title="Sleep a night"
            kind="bar"
            selected={dayKey(weekStart)}
            points={trends.map((t) => ({ week: t.weekStart, value: t.sleepHours }))}
            format={hours}
            onSelect={(w) => go(parseWeek(w)!)}
          />
          <WeekTrend
            title="Steps a day"
            kind="bar"
            selected={dayKey(weekStart)}
            points={trends.map((t) => ({ week: t.weekStart, value: t.steps }))}
            format={count}
            onSelect={(w) => go(parseWeek(w)!)}
          />
        </div>
      </Card>
    </div>
  );
}

function NavButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center rounded-full text-xl text-ink hover:bg-pressed disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function Flags({ flags }: { flags: Flag[] }) {
  if (flags.length === 0) {
    return (
      <div className="rounded-panel bg-good-soft px-4 py-3 text-sm text-good">
        ✓ Nothing to flag this week
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-2" aria-label="Worth a look">
      {flags.map((f) => (
        <span
          key={f.key}
          className={`rounded-pill border px-3 py-1.5 text-sm font-medium ${
            f.tone === 'warn'
              ? 'border-warn-line bg-warn-soft text-warn'
              : 'border-line bg-paper-card text-ink'
          }`}
        >
          {f.tone === 'warn' ? '⚠ ' : ''}
          {f.text}
        </span>
      ))}
    </div>
  );
}

/** Metrics down the side, the seven days across: the week at a glance. */
function WeekGrid({ week, athleteId, units }: { week: CoachWeek; athleteId: string; units: CoachUnits }) {
  const today = dayKey(new Date());
  const row = (label: string, cell: (d: CoachWeek['days'][number]) => React.ReactNode) => (
    <tr className="border-t border-line">
      <th scope="row" className="whitespace-nowrap py-2.5 pr-4 text-left text-xs font-semibold text-muted">
        {label}
      </th>
      {week.days.map((d) => (
        <td
          key={d.date}
          className={`px-2 py-2.5 text-center text-sm tabular-nums text-ink ${d.date > today ? 'opacity-40' : ''}`}
        >
          {cell(d)}
        </td>
      ))}
    </tr>
  );
  const dash = <span className="text-muted">–</span>;
  return (
    <Card title="Week at a glance">
      <div className="-mx-2 overflow-x-auto px-2">
        <table className="w-full min-w-[640px] border-collapse">
          <thead>
            <tr>
              <th className="w-28" />
              {week.days.map((d) => (
                <th key={d.date} scope="col" className="px-2 pb-2 text-center text-xs font-semibold text-ink">
                  {weekdayName(d.date)}
                  <div className="font-normal text-muted">{shortDate(d.date)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {row('Workout', (d) =>
              d.sessions.length === 0 ? (
                <span className="text-xs text-muted">{d.date < today ? 'Rest' : ''}</span>
              ) : (
                <div className="flex flex-col items-center gap-1">
                  {d.sessions.map((s) => (
                    <Link
                      key={s.id}
                      to={`/coach/${athleteId}/session/${s.id}`}
                      className="rounded-pill bg-ink px-2.5 py-1 text-xs font-semibold text-white hover:opacity-85"
                    >
                      {s.dayName}
                    </Link>
                  ))}
                </div>
              ),
            )}
            {row('Sets · volume', (d) =>
              d.sessions.length === 0 ? (
                dash
              ) : (
                <span className="text-xs">
                  {d.sessions.reduce((n, s) => n + s.setCount, 0)} ·{' '}
                  {volume(
                    d.sessions.reduce((n, s) => n + s.volumeKg, 0),
                    units.lift,
                  )}
                </span>
              ),
            )}
            {row('How it felt', (d) => {
              const scores = d.sessions.map((s) => feelScore(s.checkIn)).filter((v): v is number => v != null);
              return scores.length === 0 ? dash : <Pips value={scores.reduce((a, b) => a + b, 0) / scores.length} />;
            })}
            {row('Sleep', (d) => (d.sleepHours != null ? hours(d.sleepHours) : dash))}
            {row('Body weight', (d) => (d.weightKg != null ? bodyWeight(d.weightKg, units.body) : dash))}
            {row('Steps', (d) => (d.steps != null ? count(d.steps) : dash))}
            {row('Water', (d) => (d.water != null ? String(d.water) : dash))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const BETTER: Record<RatingKey, Better> = {
  performance: 'up',
  energy: 'up',
  soreness: 'down',
  sleep: 'up',
  hunger: 'neither',
  stress: 'down',
};

function FeelCard({ week, vsLabel }: { week: CoachWeek; vsLabel: string }) {
  const { feel } = week;
  return (
    <Card
      title="How it felt"
      aside={
        feel.checkIns > 0
          ? `${feel.checkIns} ${feel.checkIns === 1 ? 'check-in' : 'check-ins'} · vs ${vsLabel}`
          : undefined
      }
    >
      {feel.checkIns === 0 ? (
        <p className="text-sm text-muted">No check-ins this week.</p>
      ) : (
        <>
          <div className="flex items-baseline gap-3 rounded-panel bg-surface px-4 py-3">
            <div className="text-display font-bold tabular-nums tracking-title text-ink">
              {feel.score.current != null ? oneDp(feel.score.current) : '–'}
            </div>
            <div>
              <div className="text-sm font-semibold text-ink">Overall, out of 5</div>
              <div className="text-xs text-muted">
                Workout, energy and sleep, with soreness and stress turned round.{' '}
                <Delta m={feel.score} format={oneDp} />
              </div>
            </div>
          </div>
          <table className="mt-3 w-full">
            <tbody>
              {RATING_QUESTIONS.map((q) => {
                const m = feel.ratings[q.key];
                return (
                  <tr key={q.key} className="border-t border-line first:border-t-0">
                    <th scope="row" className="py-2 text-left text-sm font-medium text-ink">
                      {q.label}
                      <div className="text-xs font-normal text-muted">
                        1 {q.low.toLowerCase()} · 5 {q.high.toLowerCase()}
                      </div>
                    </th>
                    <td className="py-2 text-right">
                      <Pips value={m.current} invert={BETTER[q.key] === 'down'} />
                    </td>
                    <td className="w-12 py-2 text-right text-sm font-semibold tabular-nums text-ink">
                      {m.current != null ? oneDp(m.current) : '–'}
                    </td>
                    <td className="w-24 py-2 text-right">
                      <Delta m={m} format={oneDp} better={BETTER[q.key]} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </Card>
  );
}

function StrengthCard({
  week,
  athleteId,
  units,
  data,
  vsLabel,
}: {
  week: CoachWeek;
  athleteId: string;
  units: CoachUnits;
  data: AthleteData;
  vsLabel: string;
}) {
  const set = (normalizedName: string, kg: number, reps: number) =>
    liftSet(kg, reps, units.lift, data.machineUnits.get(normalizedName));
  const nothing = week.lifts.length === 0 && week.newLifts.length === 0 && week.suspectLifts.length === 0;
  return (
    <Card title="Strength" aside={`Best set by estimated 1RM, vs ${vsLabel}`}>
      {nothing ? (
        <p className="text-sm text-muted">No weighted sets this week.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="pb-2 font-semibold">Lift</th>
                <th className="pb-2 font-semibold">This week</th>
                <th className="pb-2 font-semibold">{vsLabel[0].toUpperCase() + vsLabel.slice(1)}</th>
                <th className="pb-2 text-right font-semibold">Change</th>
              </tr>
            </thead>
            <tbody>
              {week.lifts.map((c) => (
                <tr key={c.cur.normalizedName} className="border-t border-line">
                  <td className="py-2 pr-3">
                    <LiftLink athleteId={athleteId} name={c.cur.normalizedName} label={c.cur.displayName} />
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{set(c.cur.normalizedName, c.cur.topWeightKg, c.cur.topReps)}</td>
                  <td className="py-2 pr-3 tabular-nums text-muted">
                    {set(c.prev.normalizedName, c.prev.topWeightKg, c.prev.topReps)}
                  </td>
                  <td
                    className={`py-2 text-right font-semibold tabular-nums ${
                      c.pct >= 0.5 ? 'text-good' : c.pct <= -0.5 ? 'text-danger' : 'text-muted'
                    }`}
                  >
                    {c.pct >= 0.5 ? '▲ ' : c.pct <= -0.5 ? '▼ ' : ''}
                    {pct(c.pct)}
                  </td>
                </tr>
              ))}
              {week.newLifts.map((e) => (
                <tr key={e.normalizedName} className="border-t border-line">
                  <td className="py-2 pr-3">
                    <LiftLink athleteId={athleteId} name={e.normalizedName} label={e.displayName} />
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{set(e.normalizedName, e.topWeightKg, e.topReps)}</td>
                  <td className="py-2 pr-3 text-muted">Not done</td>
                  <td className="py-2 text-right text-xs text-muted">New</td>
                </tr>
              ))}
              {week.suspectLifts.map((c) => (
                <tr key={c.cur.normalizedName} className="border-t border-line">
                  <td className="py-2 pr-3">
                    <LiftLink athleteId={athleteId} name={c.cur.normalizedName} label={c.cur.displayName} />
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{set(c.cur.normalizedName, c.cur.topWeightKg, c.cur.topReps)}</td>
                  <td className="py-2 pr-3 tabular-nums text-muted">
                    {set(c.prev.normalizedName, c.prev.topWeightKg, c.prev.topReps)}
                  </td>
                  <td className="py-2 text-right text-xs text-muted" title="Too big a jump to be the same machine">
                    Not compared
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function LiftLink({ athleteId, name, label }: { athleteId: string; name: string; label: string }) {
  return (
    <Link to={`/coach/${athleteId}/exercise/${encodeURIComponent(name)}`} className="font-medium text-ink hover:underline">
      {label}
    </Link>
  );
}

function BodyPartsCard({
  week,
  athleteId,
  units,
  vsLabel,
}: {
  week: CoachWeek;
  athleteId: string;
  units: CoachUnits;
  vsLabel: string;
}) {
  if (week.bodyParts.length === 0) return null;
  return (
    <Card title="Body parts" aside={`Open one for its lifts over 12 weeks · vs ${vsLabel}`}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="pb-2 font-semibold">Body part</th>
              <th className="pb-2 text-right font-semibold">Sets</th>
              <th className="pb-2 text-right font-semibold">Volume</th>
              <th className="pb-2 text-right font-semibold">Strength</th>
              <th className="pb-2 pl-6 font-semibold">Heaviest set</th>
            </tr>
          </thead>
          <tbody>
            {week.bodyParts.map((b) => (
              <tr key={b.bodyPart} className="border-t border-line">
                <td className="py-2.5 pr-3">
                  <Link
                    to={`/coach/${athleteId}/body-part/${encodeURIComponent(b.bodyPart)}?week=${dayKey(week.weekStart)}`}
                    className="font-semibold text-ink hover:underline"
                  >
                    {b.bodyPart}
                  </Link>
                </td>
                <td className="py-2.5 text-right tabular-nums">
                  {b.sets.current}
                  <span className="ml-2 inline-block w-14 text-left">
                    <Delta m={b.sets} format={(n) => String(n)} better="neither" quiet />
                  </span>
                </td>
                <td className="py-2.5 text-right tabular-nums">
                  {volume(b.volumeKg.current ?? 0, units.lift)}
                  <span className="ml-2 inline-block w-14 text-left">
                    <Delta m={b.volumeKg} format={count} better="neither" asPct quiet />
                  </span>
                </td>
                <td
                  className={`py-2.5 text-right font-semibold tabular-nums ${
                    b.strengthPct == null
                      ? 'text-muted'
                      : b.strengthPct >= 0.5
                        ? 'text-good'
                        : b.strengthPct <= -0.5
                          ? 'text-danger'
                          : 'text-muted'
                  }`}
                >
                  {b.strengthPct != null ? pct(b.strengthPct) : '–'}
                </td>
                <td className="py-2.5 pl-6 text-muted">
                  {b.topSet ? `${b.topSet.exercise}, ${liftSet(b.topSet.weight, b.topSet.reps, units.lift)}` : '–'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
