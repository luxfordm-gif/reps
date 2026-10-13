// One lift's whole history: the strength line, then every session's sets.

import { Link, useNavigate, useParams } from 'react-router-dom';
import { exerciseDetail } from '../lib/coach/coachWeek';
import { estimate1RM } from '../lib/oneRepMax';
import { useAthlete } from './athleteContext';
import { liftSet, liftWeight, pct, shortDate, useCoachUnits } from './format';
import { Card, E1rmChart } from './ui';

export function ExerciseScreen() {
  const { athleteId, data } = useAthlete();
  const units = useCoachUnits();
  const navigate = useNavigate();
  const { name = '' } = useParams();
  const normalizedName = decodeURIComponent(name);
  const detail = exerciseDetail(data, normalizedName);
  const machine = data.machineUnits.get(normalizedName);

  const scored = detail.history.filter((p) => p.bestEst1RMkg != null);
  const best = scored.reduce<(typeof scored)[number] | null>(
    (b, p) => (!b || (p.bestEst1RMkg ?? 0) > (b.bestEst1RMkg ?? 0) ? p : b),
    null,
  );
  const change =
    scored.length >= 2
      ? ((scored[scored.length - 1].bestEst1RMkg! - scored[0].bestEst1RMkg!) / scored[0].bestEst1RMkg!) * 100
      : null;

  return (
    <div className="mt-6 space-y-6">
      <div>
        <button onClick={() => navigate(-1)} className="text-sm text-muted hover:text-ink">
          ← Back
        </button>
        <h2 className="mt-1 text-2xl font-bold tracking-tight text-ink">{detail.displayName}</h2>
        <p className="text-sm text-muted">
          {detail.bodyPart ? (
            <Link
              to={`/coach/${athleteId}/body-part/${encodeURIComponent(detail.bodyPart)}`}
              className="hover:underline"
            >
              {detail.bodyPart}
            </Link>
          ) : (
            'No body part'
          )}
          {` · ${detail.history.length} ${detail.history.length === 1 ? 'session' : 'sessions'} in the last year`}
          {machine === 'pin' ? ' · logged in pin positions' : ''}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Figure
          label="Best estimated 1RM"
          value={best?.bestEst1RMkg != null ? liftWeight(best.bestEst1RMkg, units.lift, machine) : '–'}
          hint={best ? shortDate(best.date) : undefined}
        />
        <Figure
          label="Change"
          value={change != null ? pct(change) : '–'}
          hint={scored.length >= 2 ? `since ${shortDate(scored[0].date)}` : 'Needs two sessions'}
        />
        <Figure
          label="Latest heaviest set"
          value={
            scored.length > 0
              ? liftSet(scored[scored.length - 1].topWeightKg, scored[scored.length - 1].repsAtTopWeight, units.lift, machine)
              : '–'
          }
          hint={scored.length > 0 ? shortDate(scored[scored.length - 1].date) : undefined}
        />
      </div>

      <Card title="Estimated 1RM by session">
        <E1rmChart
          history={detail.history}
          height={240}
          format={(kg) => liftWeight(kg, units.lift, machine)}
          setLabel={(p) => `Heaviest ${liftSet(p.topWeightKg, p.repsAtTopWeight, units.lift, machine)}`}
        />
      </Card>

      <Card title="Every session">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="pb-2 font-semibold">Date</th>
              <th className="pb-2 font-semibold">Sets</th>
              <th className="pb-2 text-right font-semibold">Est. 1RM</th>
            </tr>
          </thead>
          <tbody>
            {[...detail.history].reverse().map((p) => (
              <tr key={p.date} className="border-t border-line align-top">
                <td className="whitespace-nowrap py-2 pr-4">{shortDate(p.date)}</td>
                <td className="py-2 pr-4 tabular-nums">
                  {p.sets.map((s, i) => (
                    <span
                      key={i}
                      className={`mr-3 inline-block ${
                        s.weightKg != null && s.reps != null && estimate1RM(s.weightKg, s.reps) === p.bestEst1RMkg
                          ? 'font-semibold text-ink'
                          : 'text-muted'
                      }`}
                    >
                      {liftSet(s.weightKg, s.reps, units.lift, machine)}
                    </span>
                  ))}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {p.bestEst1RMkg != null ? liftWeight(p.bestEst1RMkg, units.lift, machine) : '–'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-panel bg-paper-card p-4 shadow-card">
      <div className="text-label font-semibold uppercase tracking-eyebrow text-muted">{label}</div>
      <div className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight text-ink">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}
