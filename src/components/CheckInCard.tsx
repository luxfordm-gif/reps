import { useEffect, useState } from 'react';
import { getSessionCheckIn, updateSessionCheckIn } from '../lib/sessionsApi';
import {
  EMPTY_CHECK_IN,
  RATING_MAX,
  RATING_MIN,
  RATING_QUESTIONS,
  isCheckInComplete,
  type CheckIn,
  type RatingKey,
} from '../lib/checkin';
import { haptics } from '../lib/haptics';

// The check-in at the end of a workout: a closed row you tap open, with five
// questions inside, each a name on the left and a five-way switch on the
// right. One shape the whole way down, so there is nothing to work out. Closed by default
// because most people finishing a workout aren't filling in a form for a
// coach, and the row still says where you're up to. Every tap saves on its
// own, so there is nothing to submit and nothing to lose by walking off
// halfway through. Tapping the chosen number again clears it.
//
// Five points, not the seven a coach's sheet uses: seven at 30px each beside
// a label is a mis-tap waiting to happen.
//
// Not sliders: on a sweaty phone a slider needs a drag, lands between values
// and never looks finished. A row of numbers is one tap and reads back.

export function CheckInCard({ sessionId }: { sessionId: string }) {
  const [checkIn, setCheckIn] = useState<CheckIn>(EMPTY_CHECK_IN);
  // Which session the state belongs to: the buttons stay off until this
  // session's check-in has been read, so a tap can't overwrite it.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
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

  const complete = isCheckInComplete(checkIn);
  const answered = RATING_QUESTIONS.filter((q) => checkIn[q.key] != null).length;
  // Closed, the row says where you're up to; open, the questions say it.
  const summary = complete
    ? 'Logged for your coach'
    : answered > 0
      ? `${answered} of ${RATING_QUESTIONS.length} answered`
      : `Optional · ${RATING_QUESTIONS.length} quick questions`;

  return (
    <div className="overflow-hidden rounded-card bg-paper-card shadow-card">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          haptics.tap();
          setOpen((v) => !v);
        }}
        className="flex w-full items-center gap-3 px-4 py-4 text-left active:bg-pressed"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-paper text-ink">
          <ClipboardIcon />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-ink">Coach check-in</div>
          <div className={`mt-0.5 text-xs ${complete ? 'text-good' : 'text-muted'}`}>{summary}</div>
        </div>
        <svg
          width="16"
          height="16"
          viewBox="0 0 18 18"
          fill="none"
          aria-hidden="true"
          className="shrink-0 text-muted"
          style={{ transform: `rotate(${open ? 180 : 0}deg)`, transition: 'transform 200ms ease' }}
        >
          <path
            d="M4 7l5 5 5-5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div className="border-t border-line/60 px-4 pb-4 pt-3">
          <div className="px-1 pb-1 text-xs text-muted">A few taps for your coach. Skip any you like.</div>

          <div className="mt-3 divide-y divide-line/60">
            {RATING_QUESTIONS.map((q) => (
              <div key={q.key} role="radiogroup" aria-label={q.label} className="flex gap-3 py-3">
                <div className="w-[84px] shrink-0 pt-1">
                  <div className="text-sm font-semibold leading-tight text-ink">{q.label}</div>
                  <div className="mt-0.5 text-caption leading-tight text-muted">{q.hint}</div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex rounded-pill bg-surface-strong p-0.5">
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
                            className={`h-8 min-w-0 flex-1 rounded-pill text-sm font-semibold tabular-nums transition-colors disabled:opacity-40 ${
                              on ? 'bg-ink text-white' : 'text-ink active:bg-line'
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
              </div>
            ))}

          </div>

          {error && (
            <div className="mt-3 px-1 text-caption text-danger" aria-live="polite">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ClipboardIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="4" width="14" height="17" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 3.5h6v2.5H9z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M9 11h6M9 15h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
