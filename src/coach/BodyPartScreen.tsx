// One body part over twelve weeks: how much work went into it, and whether
// each of its lifts is going up.

import { Link, useParams, useSearchParams } from 'react-router-dom';
import { bodyPartDetail, bodyPartsTrained, dayKey, mondayOf, parseWeek } from '../lib/coach/coachWeek';
import { kgToLb } from '../lib/units';
import { useAthlete } from './athleteContext';
import { count, liftSet, liftWeight, pct, shortDate, useCoachUnits, volume } from './format';
import { Card, E1rmChart, WeekTrend } from './ui';

const WEEKS = 12;

export function BodyPartScreen() {
  const { athleteId, data } = useAthlete();
  const units = useCoachUnits();
  const { part = '' } = useParams();
  const [params] = useSearchParams();
  const bodyPart = decodeURIComponent(part);
  const weekKey = dayKey(parseWeek(params.get('week')) ?? mondayOf(new Date()));

  const detail = bodyPartDetail(data, bodyPart, parseWeek(weekKey)!, WEEKS);
  const parts = bodyPartsTrained(data);
  const weekQuery = `?week=${weekKey}`;
  const toUnit = (kg: number) => (units.lift === 'lb' ? kgToLb(kg) : kg);

  return (
    <div className="mt-6 space-y-6">
      <div>
        <Link to={`/coach/${athleteId}${weekQuery}`} className="text-sm text-muted hover:text-ink">
          ← Week of {shortDate(weekKey)}
        </Link>
        <h2 className="mt-1 text-2xl font-bold tracking-tight text-ink">{bodyPart}</h2>
        <p className="text-sm text-muted">The {WEEKS} weeks to {shortDate(weekKey)}</p>
        <nav className="mt-3 flex flex-wrap gap-1.5" aria-label="Body parts">
          {parts.map((p) => (
            <Link
              key={p}
              to={`/coach/${athleteId}/body-part/${encodeURIComponent(p)}${weekQuery}`}
              className={`rounded-pill px-3 py-1 text-xs font-semibold ${
                p === bodyPart ? 'bg-ink text-white' : 'bg-paper-card text-ink shadow-hairline hover:bg-pressed'
              }`}
            >
              {p}
            </Link>
          ))}
        </nav>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <WeekTrend
          title="Sets a week"
          kind="bar"
          selected={weekKey}
          points={detail.weeks.map((w) => ({ week: w.weekStart, value: w.sets }))}
          format={(n) => `${n} sets`}
        />
        <WeekTrend
          title="Volume a week"
          kind="bar"
          selected={weekKey}
          points={detail.weeks.map((w) => ({ week: w.weekStart, value: toUnit(w.volumeKg) }))}
          format={(n) => `${count(n)} ${units.lift}`}
        />
      </div>

      {detail.exercises.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">Nothing logged for {bodyPart} in these weeks.</p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {detail.exercises.map((e) => {
            const machine = data.machineUnits.get(e.normalizedName);
            const last = [...e.history].reverse().find((p) => p.topWeightKg != null);
            return (
              <Card
                key={e.normalizedName}
                title={e.displayName}
                aside={
                  e.changePct != null ? (
                    <span
                      className={`font-semibold ${
                        e.changePct >= 0.5 ? 'text-good' : e.changePct <= -0.5 ? 'text-danger' : 'text-muted'
                      }`}
                    >
                      {e.changePct >= 0.5 ? '▲ ' : e.changePct <= -0.5 ? '▼ ' : ''}
                      {pct(e.changePct)} est. 1RM
                    </span>
                  ) : undefined
                }
              >
                <E1rmChart
                  history={e.history}
                  format={(kg) => liftWeight(kg, units.lift, machine)}
                  setLabel={(p) => `Heaviest ${liftSet(p.topWeightKg, p.repsAtTopWeight, units.lift, machine)}`}
                />
                <div className="mt-3 flex items-center justify-between text-xs text-muted">
                  <span>
                    {e.history.length} {e.history.length === 1 ? 'session' : 'sessions'}
                    {last ? ` · latest ${liftSet(last.topWeightKg, last.repsAtTopWeight, units.lift, machine)}` : ''}
                  </span>
                  <Link
                    to={`/coach/${athleteId}/exercise/${encodeURIComponent(e.normalizedName)}`}
                    className="font-semibold text-ink hover:underline"
                  >
                    All sessions
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Card title="Heaviest set each week">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="pb-2 font-semibold">Week of</th>
              <th className="pb-2 font-semibold">Lift</th>
              <th className="pb-2 font-semibold">Set</th>
              <th className="pb-2 text-right font-semibold">Sets</th>
              <th className="pb-2 text-right font-semibold">Volume</th>
            </tr>
          </thead>
          <tbody>
            {[...detail.weeks].reverse().map((w) => (
              <tr key={w.weekStart} className="border-t border-line">
                <td className="py-2 pr-3">
                  <Link to={`/coach/${athleteId}?week=${w.weekStart}`} className="text-ink hover:underline">
                    {shortDate(w.weekStart)}
                  </Link>
                </td>
                <td className="py-2 pr-3">{w.best?.exercise ?? <span className="text-muted">–</span>}</td>
                <td className="py-2 pr-3 tabular-nums">
                  {w.best ? liftSet(w.best.weightKg, w.best.reps, units.lift) : ''}
                </td>
                <td className="py-2 text-right tabular-nums">{w.sets || ''}</td>
                <td className="py-2 text-right tabular-nums">{w.volumeKg ? volume(w.volumeKg, units.lift) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
