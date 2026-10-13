// One lift's whole history: its best set session by session, then every set.
// A lift done in more than one session — Push 1 and Push 2 on a rotating
// plan, or bench in both Push and Upper — is shown one session at a time, so
// each line compares like with like.

import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  exerciseDetail,
  historyChangePct,
  liftSessionNames,
  topSetChangePct,
  type TopSet,
} from '../lib/coach/coachWeek';
import { useAthlete } from './athleteContext';
import { liftSet, liftWeight, pct, shortDate, useCoachUnits } from './format';
import { Card, BestSetChart } from './ui';

export function ExerciseScreen() {
  const { athleteId, data } = useAthlete();
  const units = useCoachUnits();
  const navigate = useNavigate();
  const { name = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const normalizedName = decodeURIComponent(name);
  const sessionNames = liftSessionNames(data, normalizedName);
  const requested = params.get('session');
  const dayName = requested && sessionNames.includes(requested) ? requested : sessionNames[0];
  const detail = exerciseDetail(data, normalizedName, dayName);
  const machine = data.machineUnits.get(normalizedName);

  const scored = detail.history.filter((p) => p.top != null);
  const heaviest = scored.reduce<(typeof scored)[number] | null>(
    (b, p) =>
      !b || p.top!.weightKg > b.top!.weightKg || (p.top!.weightKg === b.top!.weightKg && p.top!.reps > b.top!.reps)
        ? p
        : b,
    null,
  );
  const latest = scored.length > 0 ? scored[scored.length - 1] : null;
  const change = historyChangePct(detail.history);
  const show = (t: TopSet) => liftSet(t.weightKg, t.reps, units.lift, machine);

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
          {machine === 'pin' ? ' · logged in pin positions' : ''}
        </p>
        {sessionNames.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Sessions">
            {sessionNames.map((n) => (
              <button
                key={n}
                role="tab"
                aria-selected={n === dayName}
                onClick={() => setParams({ session: n }, { replace: true })}
                className={`rounded-pill px-3 py-1.5 text-xs font-semibold transition-colors ${
                  n === dayName ? 'bg-ink text-white' : 'bg-surface-strong text-ink hover:bg-line'
                }`}
              >
                {n}
              </button>
            ))}
            <span className="ml-1 text-xs text-muted">
              {detail.history.length} {detail.history.length === 1 ? 'time' : 'times'} in {dayName}, in the last year
            </span>
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Figure
          label="Heaviest set"
          value={heaviest ? show(heaviest.top!) : '–'}
          hint={heaviest ? shortDate(heaviest.date) : undefined}
        />
        <Figure
          label="Change"
          value={change != null ? pct(change) : '–'}
          hint={
            scored.length >= 2
              ? `Best set, weight × reps, since ${shortDate(scored[0].date)}`
              : 'Needs two sessions'
          }
        />
        <Figure
          label="Latest best set"
          value={latest ? show(latest.top!) : '–'}
          hint={latest ? shortDate(latest.date) : undefined}
        />
      </div>

      <Card title={`Best set, each ${dayName}`}>
        <BestSetChart
          history={detail.history}
          height={240}
          format={(kg) => liftWeight(kg, units.lift, machine)}
          setLabel={(p) => (p.top ? show(p.top) : '–')}
        />
      </Card>

      <Card title={`Every ${dayName}`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="pb-2 font-semibold">Date</th>
              <th className="pb-2 font-semibold">Sets</th>
              <th className="pb-2 text-right font-semibold">vs the {dayName} before</th>
            </tr>
          </thead>
          <tbody>
            {detail.history.map((p, i) => ({ p, before: detail.history[i - 1] })).reverse().map(({ p, before }) => (
              <tr key={p.sessionId} className="border-t border-line align-top">
                <td className="whitespace-nowrap py-2 pr-4">{shortDate(p.date)}</td>
                <td className="py-2 pr-4 tabular-nums">
                  {p.sets.map((s, i) => (
                    <span
                      key={i}
                      className={`mr-3 inline-block ${
                        p.top && s.weightKg === p.top.weightKg && s.reps === p.top.reps
                          ? 'font-semibold text-ink'
                          : 'text-muted'
                      }`}
                    >
                      {liftSet(s.weightKg, s.reps, units.lift, machine)}
                    </span>
                  ))}
                </td>
                <td className="py-2 text-right tabular-nums">
                  <Change before={before?.top ?? null} after={p.top} />
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

function Change({ before, after }: { before: TopSet | null; after: TopSet | null }) {
  const value = before && after ? topSetChangePct(before, after) : null;
  if (value == null) return <span className="text-muted">–</span>;
  const r = Math.round(value);
  return (
    <span className={`font-semibold ${r > 0 ? 'text-good' : r < 0 ? 'text-danger' : 'text-muted'}`}>
      {r > 0 ? '▲ ' : r < 0 ? '▼ ' : ''}
      {pct(value)}
    </span>
  );
}
