// One workout as it was logged: every set, and the check-in after it.

import { Link, useNavigate, useParams } from 'react-router-dom';
import { sessionDetail, dayKey, mondayOf, oneDp, feelScore } from '../lib/coach/coachWeek';
import { RATING_QUESTIONS } from '../lib/checkin';
import { useAthlete } from './athleteContext';
import { liftSet, useCoachUnits, volume } from './format';
import { Card, Pips } from './ui';
import { Notice } from './AthleteLayout';

export function SessionScreen() {
  const { athleteId, data } = useAthlete();
  const units = useCoachUnits();
  const navigate = useNavigate();
  const { sessionId = '' } = useParams();
  const detail = sessionDetail(data, sessionId);

  if (!detail) {
    return <Notice title="Session not found" body="It may have been deleted, or it's more than a year old." />;
  }
  const { session } = detail;
  const when = new Date(session.completedAt);
  const score = feelScore(session.checkIn);
  const answered = RATING_QUESTIONS.filter((q) => session.checkIn[q.key] != null);

  return (
    <div className="mt-6 space-y-6">
      <div>
        <button onClick={() => navigate(-1)} className="text-sm text-muted hover:text-ink">
          ← Back
        </button>
        <h2 className="mt-1 text-2xl font-bold tracking-tight text-ink">{session.dayName}</h2>
        <p className="text-sm text-muted">
          {when.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} ·{' '}
          {detail.setCount} sets · {volume(detail.volumeKg, units.lift)} ·{' '}
          <Link to={`/coach/${athleteId}?week=${dayKey(mondayOf(when))}`} className="hover:underline">
            Open the week
          </Link>
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card title="Sets">
          {detail.exercises.length === 0 ? (
            <p className="text-sm text-muted">No sets logged.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {detail.exercises.map((e) => (
                  <tr key={e.normalizedName} className="border-t border-line align-top first:border-t-0">
                    <th scope="row" className="py-2.5 pr-4 text-left font-medium">
                      <Link
                        to={`/coach/${athleteId}/exercise/${encodeURIComponent(e.normalizedName)}`}
                        className="text-ink hover:underline"
                      >
                        {e.displayName}
                      </Link>
                      {e.bodyPart && <div className="text-xs font-normal text-muted">{e.bodyPart}</div>}
                    </th>
                    <td className="py-2.5 tabular-nums">
                      {e.sets.map((s, i) => (
                        <span key={i} className="mr-4 inline-block whitespace-nowrap">
                          {liftSet(s.weight, s.reps, units.lift, data.machineUnits.get(e.normalizedName))}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Check-in" aside={score != null ? `Overall ${oneDp(score)} of 5` : undefined}>
          {answered.length === 0 ? (
            <p className="text-sm text-muted">No check-in for this session.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {answered.map((q) => (
                  <tr key={q.key} className="border-t border-line first:border-t-0">
                    <th scope="row" className="py-2 text-left font-medium text-ink">
                      {q.label}
                      <div className="text-xs font-normal text-muted">
                        1 {q.low.toLowerCase()} · 5 {q.high.toLowerCase()}
                      </div>
                    </th>
                    <td className="py-2 text-right">
                      <Pips value={session.checkIn[q.key]} />
                    </td>
                    <td className="w-8 py-2 text-right font-semibold tabular-nums">{session.checkIn[q.key]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
