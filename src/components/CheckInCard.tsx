import { useEffect, useState } from 'react';
import { getSessionCheckIn, updateSessionCheckIn } from '../lib/sessionsApi';
import {
  EMPTY_CHECK_IN,
  FLAGS,
  RATING_MAX,
  RATING_MIN,
  RATING_QUESTIONS,
  isCheckInComplete,
  type CheckIn,
  type FlagKey,
  type RatingKey,
} from '../lib/checkin';
import { haptics } from '../lib/haptics';

// The check-in at the end of a workout: four rows of seven round buttons and
// a row of chips. Every tap saves on its own, so there is nothing to submit
// and nothing to lose by walking off halfway through. Tapping the chosen
// number again clears it.
//
// Not sliders: on a sweaty phone a slider needs a drag, lands between values
// and never looks finished. A row of numbers is one tap and reads back.

export function CheckInCard({ sessionId }: { sessionId: string }) {
  const [checkIn, setCheckIn] = useState<CheckIn>(EMPTY_CHECK_IN);
  // Which session the state belongs to: the buttons stay off until this
  // session's check-in has been read, so a tap can't overwrite it.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loaded = loadedFor === sessionId;

  useEffect(() => {
    let cancelled = false;
    getSessionCheckIn(sessionId)
      .then((c) => {
        if (cancelled) return;
        setCheckIn(c);
        setLoadedFor(sessionId);
      })
      .catch(() => {
        if (!cancelled) setLoadedFor(sessionId);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  function commit(next: CheckIn) {
    haptics.tick();
    setCheckIn(next);
    setError(null);
    updateSessionCheckIn(sessionId, next).catch((e: unknown) => {
      setError((e as Error)?.message ?? "Couldn't save");
    });
  }

  function rate(key: RatingKey, n: number) {
    commit({ ...checkIn, [key]: checkIn[key] === n ? null : n });
  }

  function flag(key: FlagKey) {
    const has = checkIn.flags.includes(key);
    commit({
      ...checkIn,
      flags: has ? checkIn.flags.filter((f) => f !== key) : [...checkIn.flags, key],
    });
  }

  const complete = isCheckInComplete(checkIn);

  return (
    <div className="rounded-card bg-paper-card px-4 pb-4 pt-4 shadow-card">
      <div className="px-1">
        <div className="text-sm font-semibold text-ink">How did it go?</div>
        <div className="mt-0.5 text-xs text-muted">
          A few taps for your coach. Skip any you like.
        </div>
      </div>

      <div className="mt-4 space-y-4">
        {RATING_QUESTIONS.map((q) => (
          <div key={q.key} role="radiogroup" aria-label={q.label}>
            <div className="px-1 text-xs font-semibold text-ink">{q.label}</div>
            <div className="mt-1.5 flex justify-between gap-1.5">
              {Array.from({ length: RATING_MAX - RATING_MIN + 1 }, (_, i) => RATING_MIN + i).map(
                (n) => {
                  const on = checkIn[q.key] === n;
                  return (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={`${q.label} ${n} of ${RATING_MAX}`}
                      disabled={!loaded}
                      onClick={() => rate(q.key, n)}
                      className={`pressable aspect-square max-w-11 flex-1 rounded-full text-sm font-semibold tabular-nums transition-colors disabled:opacity-40 ${
                        on ? 'bg-ink text-white' : 'bg-surface-strong text-ink active:bg-line'
                      }`}
                    >
                      {n}
                    </button>
                  );
                }
              )}
            </div>
            <div className="mt-1 flex justify-between px-1 text-caption text-muted">
              <span>{q.low}</span>
              <span>{q.high}</span>
            </div>
          </div>
        ))}

        <div>
          <div className="px-1 text-xs font-semibold text-ink">Anything off today?</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5 px-1">
            {FLAGS.map((f) => {
              const on = checkIn.flags.includes(f.key);
              return (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={on}
                  disabled={!loaded}
                  onClick={() => flag(f.key)}
                  className={`pressable rounded-pill border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40 ${
                    on
                      ? 'border-ink bg-ink text-white'
                      : 'border-line bg-paper-card text-ink active:bg-pressed'
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-4 min-h-[16px] px-1 text-caption" aria-live="polite">
        {error ? (
          <span className="text-danger">{error}</span>
        ) : complete ? (
          <span className="flex items-center gap-1.5 font-semibold text-good">
            <TickIcon />
            Logged for your coach
          </span>
        ) : null}
      </div>
    </div>
  );
}

function TickIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 8.5l3 3 6.5-6.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
