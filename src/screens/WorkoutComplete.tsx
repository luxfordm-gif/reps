import { useEffect, useState } from 'react';
import { getSessionRecap, type SessionRecap, type RecapMedal } from '../lib/sessionsApi';
import { getLiftWeightUnit } from '../lib/units';
import { NotesAccordion } from '../components/NotesAccordion';

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
            bodyParts: [],
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

        {recap ? (
          <p className="mt-6 rounded-card bg-paper-card px-5 py-4 text-sm leading-relaxed text-ink shadow-card">
            {buildRecapParagraph(recap, dayName, unit, sessionId)}
          </p>
        ) : (
          <p className="mt-6 text-sm text-muted">Crunching numbers…</p>
        )}

        {recap && recap.bestSets.length > 0 && (
          <div className="mt-9">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
              Top lifts
            </div>
            <div className="mt-3 divide-y divide-line rounded-card bg-paper-card shadow-card">
              {recap.bestSets.map((s) => (
                <div key={s.exercise} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Medal kind={s.medal} />
                    <div className="min-w-0">
                      <div className="truncate text-base font-semibold text-ink">
                        {s.exercise}
                      </div>
                      <div className="text-xs text-muted">{s.reps} reps</div>
                    </div>
                  </div>
                  <div className="shrink-0 text-base font-bold tabular-nums text-ink">
                    {s.weight} {unit}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-9 space-y-3">
          <NotesAccordion
            sessionId={sessionId}
            field="feedbackForSelf"
            title="Feedback for next time"
            hint="Private notes for you. Example: push harder on shoulders, up calf raises next week."
            placeholder="What would you do differently next time?"
          />
          <NotesAccordion
            sessionId={sessionId}
            field="notesToCoach"
            title="Notes to coach"
            hint="Shared with your coach when you export this week."
            placeholder="Anything you want to flag to your coach about today's session?"
          />
        </div>

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

const POSITIVE_TONE = [
  'Another solid step forward.',
  'Locked in another good one.',
  'On the up.',
  'Banked the work — keep stacking.',
  'Good day at the office.',
];

const FLAT_TONE = [
  'Days like this still count.',
  'Showed up — that’s the win.',
  'Reset and chase a PR next time.',
  'Quiet one banked. On to the next.',
];

function buildRecapParagraph(
  recap: SessionRecap,
  dayName: string,
  unit: string,
  seedSource: string
): string {
  const parts: string[] = [];

  // Sentence 1 — stats + volume delta if we have a prior session.
  const setsPhrase = `${recap.setsLogged} set${recap.setsLogged === 1 ? '' : 's'}`;
  const timePhrase = recap.durationMinutes != null ? ` across ${recap.durationMinutes} min` : '';
  let s1 = `${setsPhrase}${timePhrase}`;
  if (recap.previousTotalWeight != null && recap.previousTotalWeight > 0) {
    const pct = Math.round(
      ((recap.totalWeight - recap.previousTotalWeight) / recap.previousTotalWeight) * 100
    );
    if (pct > 0) s1 += ` — +${pct}% volume on your last ${dayName} session`;
    else if (pct < 0) s1 += ` — ${pct}% volume vs your last ${dayName} session`;
    else s1 += ` — matched the volume on your last ${dayName} session`;
  } else {
    s1 += ` — first ${dayName} session on record`;
  }
  parts.push(`${s1}.`);

  // Sentence 2 — body parts trained.
  if (recap.bodyParts.length > 0) {
    parts.push(`${joinNaturally(recap.bodyParts)} on the menu today.`);
  }

  // Sentence 3 — standout lift.
  const top = recap.bestSets[0];
  if (top && top.weight > 0) {
    parts.push(`Standout: ${top.exercise} at ${top.weight} ${unit} × ${top.reps}.`);
  }

  // Sentence 4 — friendly tone line.
  const flat =
    recap.previousTotalWeight != null &&
    recap.previousTotalWeight > 0 &&
    recap.totalWeight < recap.previousTotalWeight;
  const pool = flat ? FLAT_TONE : POSITIVE_TONE;
  parts.push(pool[hashString(seedSource) % pool.length]);

  return parts.join(' ');
}

function joinNaturally(items: string[]): string {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h;
}

function Medal({ kind }: { kind: RecapMedal | null }) {
  if (!kind) return null;
  const palette: Record<RecapMedal, { fill: string; stroke: string; numeral: string }> = {
    gold: { fill: '#E0B73A', stroke: '#A88424', numeral: '1' },
    silver: { fill: '#C0C4CA', stroke: '#7A7E84', numeral: '2' },
    bronze: { fill: '#B26B2C', stroke: '#7E4A1B', numeral: '3' },
  };
  const { fill, stroke, numeral } = palette[kind];
  return (
    <span
      aria-label={`${kind} medal`}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
      style={{ backgroundColor: fill, boxShadow: `inset 0 0 0 1.5px ${stroke}` }}
    >
      {numeral}
    </span>
  );
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
