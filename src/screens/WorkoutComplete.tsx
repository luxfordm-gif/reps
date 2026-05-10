import { useEffect, useState } from 'react';
import { getSessionRecap, type SessionRecap } from '../lib/sessionsApi';
import { getLiftWeightUnit } from '../lib/units';

interface Props {
  sessionId: string;
  dayName: string;
  onDone: () => void;
}

export function WorkoutComplete({ sessionId, dayName, onDone }: Props) {
  const [recap, setRecap] = useState<SessionRecap | null>(null);
  const unit = getLiftWeightUnit();

  useEffect(() => {
    let cancelled = false;
    getSessionRecap(sessionId)
      .then((r) => {
        if (!cancelled) setRecap(r);
      })
      .catch(() => {
        if (!cancelled)
          setRecap({
            setsLogged: 0,
            totalWeight: 0,
            durationMinutes: null,
            bestSets: [],
            previousTotalWeight: null,
          });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const subpar =
    recap != null &&
    recap.previousTotalWeight != null &&
    recap.previousTotalWeight > 0 &&
    recap.totalWeight < recap.previousTotalWeight * 0.7;
  const [pickedHeadline, setPickedHeadline] = useState(() => pickHeadline(false));
  useEffect(() => {
    if (recap) setPickedHeadline(pickHeadline(subpar));
  }, [recap, subpar]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-paper">
      <CelebrationConfetti />

      <div className="relative mx-auto max-w-md px-6 pt-14 pb-44">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-ink text-white">
          <CheckIcon />
        </div>

        <h1 className="mt-7 text-[40px] font-bold leading-[1.05] tracking-tight text-ink">
          {pickedHeadline}
        </h1>
        <p className="mt-3 text-base text-muted">
          {dayName} · {subpar ? 'every session counts — here’s the breakdown' : 'here’s your greatest achievements'}
        </p>

        <div className="mt-9">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
            Total weight lifted
          </div>
          {recap ? (
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-[44px] font-bold leading-none tracking-tight text-ink tabular-nums">
                {formatNumber(recap.totalWeight)}
              </span>
              <span className="text-lg font-medium text-muted">{unit}</span>
            </div>
          ) : (
            <div className="mt-2 text-sm text-muted">Crunching numbers…</div>
          )}

          {recap && (
            <div className="mt-3 flex items-center gap-3 text-sm text-muted">
              <span>
                {recap.setsLogged} set{recap.setsLogged === 1 ? '' : 's'} logged
              </span>
              {recap.durationMinutes != null && (
                <>
                  <span>·</span>
                  <span>{recap.durationMinutes} min</span>
                </>
              )}
            </div>
          )}
        </div>

        {recap && recap.bestSets.length > 0 && (
          <div className="mt-9">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
              Top lifts
            </div>
            <div className="mt-3 divide-y divide-line rounded-card bg-paper-card shadow-card">
              {recap.bestSets.map((s) => (
                <div key={s.exercise} className="flex items-center justify-between px-5 py-3">
                  <div className="min-w-0 pr-3">
                    <div className="truncate text-base font-semibold text-ink">
                      {s.exercise}
                    </div>
                    <div className="text-xs text-muted">{s.reps} reps</div>
                  </div>
                  <div className="text-base font-bold tabular-nums text-ink">
                    {s.weight} {unit}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30">
        <div className="h-10 bg-gradient-to-t from-paper to-transparent backdrop-blur-[2px]" />
        <div className="bg-paper px-6 pt-2 pb-[max(env(safe-area-inset-bottom),24px)]">
          <button
            onClick={onDone}
            className="pointer-events-auto mx-auto block w-full max-w-md rounded-pill bg-ink py-4 text-sm font-semibold text-white active:opacity-80"
          >
            Back to home
          </button>
        </div>
      </div>
    </div>
  );
}

const POSITIVE_HEADLINES = [
  'You smashed that!',
  'Beast mode unlocked',
  'Logged and proud',
  'Crushed it',
  'Strong work',
  'PR vibes today',
  'Heavyweight day',
  'Reps royalty',
  'Hard yards paid off',
  'Pure savage',
];

const SUBPAR_HEADLINES = [
  'Off day — still showed up',
  'Not your best, that’s fine',
  "Tomorrow’s the rematch",
  'Reset and go again',
  'Just enough to count',
  'We’ve had stronger',
  'Bit flat — still logged',
  'Banked the work',
  'Quiet one in the books',
  'Done is better than skipped',
];

function pickHeadline(subpar: boolean) {
  const pool = subpar ? SUBPAR_HEADLINES : POSITIVE_HEADLINES;
  return pool[Math.floor(Math.random() * pool.length)];
}

function formatNumber(n: number) {
  return n.toLocaleString('en-GB', { maximumFractionDigits: 1 });
}

function CheckIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
      <path
        d="M6 13.5l4.5 4.5L20 8"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const GREYS = ['#1A1A1A', '#3C3C3C', '#6E6E6E', '#9A9A9A', '#C9C9C9', '#E2E2E2'];

const CELEBRATION_PIECES = Array.from({ length: 44 }, (_, i) => {
  const angle = (Math.random() - 0.5) * Math.PI * 0.9 - Math.PI / 2;
  const speed = 180 + Math.random() * 220;
  const peakX = Math.cos(angle) * speed;
  const peakY = Math.sin(angle) * speed;
  const endDrift = peakX * (1.6 + Math.random() * 0.8);
  return {
    peakX,
    peakY,
    endDrift,
    midRot: Math.random() * 180,
    endRot: 360 + Math.random() * 540,
    delay: Math.random() * 220,
    duration: 2000 + Math.random() * 1200,
    color: GREYS[i % GREYS.length],
    size: 6 + Math.random() * 4,
    shape: i % 3 === 0 ? 'rounded-full' : 'rounded-[1px]',
  };
});

function CelebrationConfetti() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <style>{`
        @keyframes reps-celebration-burst {
          0% {
            transform: translate(0, 0) rotate(0deg);
            opacity: 0;
          }
          8% { opacity: 1; }
          28% {
            transform: translate(var(--peakX), var(--peakY)) rotate(var(--midRot));
            animation-timing-function: cubic-bezier(0.4, 0, 0.7, 0.3);
          }
          100% {
            transform: translate(var(--endX), 110vh) rotate(var(--endRot));
            opacity: 0.85;
          }
        }
      `}</style>
      <div className="absolute left-1/2 top-[18vh] h-0 w-0">
        {CELEBRATION_PIECES.map((p, i) => (
          <span
            key={i}
            className={`absolute ${p.shape}`}
            style={{
              width: `${p.size}px`,
              height: `${p.size}px`,
              backgroundColor: p.color,
              ['--peakX' as string]: `${p.peakX}px`,
              ['--peakY' as string]: `${p.peakY}px`,
              ['--endX' as string]: `${p.endDrift}px`,
              ['--midRot' as string]: `${p.midRot}deg`,
              ['--endRot' as string]: `${p.endRot}deg`,
              animation: `reps-celebration-burst ${p.duration}ms ${p.delay}ms cubic-bezier(0.18, 0.65, 0.5, 1) forwards`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
