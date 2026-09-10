import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { getSessionRecap, type SessionRecap, type RecapMedal } from '../lib/sessionsApi';
import { getActivePlan } from '../lib/plansApi';
import { baseDayName, buildDaySlots, siblingVariant } from '../lib/daySlots';
import { getLiftWeightUnit } from '../lib/units';
import { NotesAccordion } from '../components/NotesAccordion';
import { SyncStatus } from '../components/SyncStatus';
import { Tile, TileUnit, BarsIcon, BoltIcon, DumbbellIcon } from '../components/Tile';

// The last screen of a workout.
//
// Confetti, one line of praise, then numbers — no paragraphs. Everything the
// old summary said in prose (sets, time, volume against last time, the body
// parts) is now a figure on a tile, and the tiles are the same ones the
// Performance tab uses, so the end of a session looks like the place you go
// to review it. The top sets sit under that, with a medal on any that ranks
// in your all-time best three for that movement.

interface Props {
  sessionId: string;
  dayName: string;
  onDone: () => void;
}

export function WorkoutComplete({ sessionId, dayName, onDone }: Props) {
  const [recap, setRecap] = useState<SessionRecap | null>(null);
  // On a rotating plan, which week the just-finished day type runs next time.
  // Computed from the plan rather than passed in, so it also works for
  // workouts resumed after an app restart. Best-effort: null renders nothing.
  const [nextWeek, setNextWeek] = useState<number | null>(null);
  const unit = getLiftWeightUnit();

  useEffect(() => {
    let cancelled = false;
    getActivePlan()
      .then((plan) => {
        if (cancelled || !plan) return;
        const days = plan.training_days ?? [];
        const done = days.find((d) => d.name === dayName);
        if (!done) return;
        const slot = buildDaySlots(days).find((sl) =>
          sl.variants.some((v) => v.id === done.id)
        );
        const sibling = slot ? siblingVariant(slot, done) : null;
        if (sibling?.week_index != null) setNextWeek(sibling.week_index);
      })
      .catch(() => {
        // The celebration stands on its own.
      });
    return () => {
      cancelled = true;
    };
  }, [dayName]);

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
  // One headline per visit, from the pool that matches how the session went.
  // The seed is fixed on mount so the words don't reshuffle when the recap
  // lands — only which pool they come from can change.
  const [seed] = useState(() => Math.random());
  const pickedHeadline = useMemo(() => {
    const pool = subpar ? SUBPAR_HEADLINES : POSITIVE_HEADLINES;
    return pool[Math.floor(seed * pool.length)];
  }, [seed, subpar]);

  // Heaviest first, medal or not: a medal ranks today's set against your whole
  // history on that one movement, so promoting medalled rows would print 90 kg
  // above 100 kg and read like a mistake. The metal and the tint make them
  // stand out wherever they land.
  const bestSets = recap ? recap.bestSets : [];
  const medalCount = bestSets.filter((s) => s.medal != null).length;

  return (
    <div className="relative min-h-screen overflow-hidden bg-paper">
      <CelebrationConfetti />

      <div className="relative mx-auto max-w-md px-5 pt-14 pb-44">
        <Rise index={0}>
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-ink text-white">
            <CheckIcon />
          </div>

          <h1 className="mt-6 text-[40px] font-bold leading-[1.05] tracking-tight text-ink">
            {pickedHeadline}
          </h1>
          <p className="mt-2 text-base text-muted">
            {dayName}
            {medalCount > 0 && (
              <>
                {' · '}
                <span className="font-semibold text-ink">
                  {medalCount} personal best{medalCount === 1 ? '' : 's'}
                </span>
              </>
            )}
          </p>
        </Rise>

        <SyncStatus className="mt-5" />

        {recap ? (
          <>
            <Rise index={1}>
              <div className="mt-7 grid grid-cols-2 gap-3">
                <Tile
                  icon={<BarsIcon />}
                  label="Sets logged"
                  value={String(recap.setsLogged)}
                  hint={setsHint(recap)}
                />
                <Tile
                  icon={<DumbbellIcon />}
                  label="Volume lifted"
                  value={
                    <>
                      {formatVolume(recap.totalWeight)}
                      <TileUnit>{unit}</TileUnit>
                    </>
                  }
                  hint={volumeHint(recap, dayName)}
                />
              </div>
            </Rise>

            {bestSets.length > 0 && (
              <Rise index={2}>
                <div className="mt-7">
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                    Top sets
                  </div>
                  <ul className="mt-2 divide-y divide-line/60 overflow-hidden rounded-card bg-paper-card shadow-card">
                    {bestSets.map((s) => (
                      <li
                        key={s.exercise}
                        className="flex items-center justify-between gap-3 px-4 py-3.5"
                        style={s.medal ? { backgroundColor: MEDALS[s.medal].rowBg } : undefined}
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <Medal kind={s.medal} />
                          <div className="min-w-0">
                            <div className="text-sm font-semibold leading-snug text-ink">
                              {s.exercise}
                            </div>
                            <div className="mt-1 flex items-center gap-1.5">
                              <span className="text-xs text-muted tabular-nums">
                                {s.reps} reps
                              </span>
                              {s.medal && <MedalBadge kind={s.medal} />}
                            </div>
                          </div>
                        </div>
                        <div className="shrink-0 whitespace-nowrap text-lg font-bold leading-tight tracking-tight text-ink tabular-nums">
                          {fmtWeight(s.weight)}
                          <span className="ml-1 text-xs font-semibold text-muted">{unit}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </Rise>
            )}
          </>
        ) : (
          <div className="mt-7 grid grid-cols-2 gap-3">
            <SkeletonTile />
            <SkeletonTile />
          </div>
        )}

        {nextWeek != null && (
          <Rise index={3}>
            <div className="mt-3 flex items-center gap-3 rounded-card bg-paper-card px-4 py-3.5 shadow-card">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-paper text-ink">
                <BoltIcon />
              </div>
              <div className="min-w-0 truncate text-sm text-muted">
                Up next:{' '}
                <span className="font-semibold text-ink">
                  {baseDayName(dayName)}, Week {nextWeek}
                </span>
              </div>
            </div>
          </Rise>
        )}

        <Rise index={4}>
          <div className="mt-7 space-y-3">
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
        </Rise>
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30">
        <div className="h-10 bg-gradient-to-t from-paper to-transparent backdrop-blur-[2px]" />
        <div className="bg-paper px-5 pt-2 pb-[max(env(safe-area-inset-bottom),24px)]">
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

/** Under the set count: how long it took, or failing that what you trained. */
function setsHint(recap: SessionRecap): string | undefined {
  if (recap.durationMinutes != null) return `${recap.durationMinutes} min in the gym`;
  if (recap.bodyParts.length === 0) return undefined;
  const shown = recap.bodyParts.slice(0, 2).join(' · ');
  const rest = recap.bodyParts.length - 2;
  return rest > 0 ? `${shown} +${rest}` : shown;
}

/**
 * Volume against the last time you ran this day. A tile hint has room for
 * about twenty characters before it truncates, so this stays terse.
 */
function volumeHint(recap: SessionRecap, dayName: string): string {
  if (recap.previousTotalWeight == null || recap.previousTotalWeight <= 0) {
    return `first ${baseDayName(dayName)} session`;
  }
  const pct = Math.round(
    ((recap.totalWeight - recap.previousTotalWeight) / recap.previousTotalWeight) * 100
  );
  if (pct === 0) return 'same as last time';
  return `${pct > 0 ? '↑' : '↓'} ${Math.abs(pct)}% vs last time`;
}

/** Session volume runs into the thousands, and a tile has room for four glyphs. */
function formatVolume(total: number): string {
  if (total >= 10000) return `${Math.round(total / 1000)}k`;
  if (total >= 1000) return `${(Math.round(total / 100) / 10).toFixed(1)}k`;
  return fmtWeight(total);
}

function fmtWeight(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

// A medal is a rank against your whole history on that movement: gold is the
// most you've ever lifted on it, silver the second most, bronze the third.
// The chip is the Performance tile's icon chip with a metal poured into it —
// same size, same circle, so it belongs to the same set of screens.
const MEDALS: Record<
  RecapMedal,
  {
    numeral: string;
    label: string;
    from: string;
    to: string;
    ring: string;
    ink: string;
    rowBg: string;
    badgeBg: string;
    badgeInk: string;
  }
> = {
  gold: {
    numeral: '1',
    label: 'Best ever',
    from: '#F8E5A6',
    to: '#D6A62C',
    ring: 'rgba(150,110,20,0.30)',
    ink: '#4A3608',
    rowBg: '#FDF9EE',
    badgeBg: '#F7EDD2',
    badgeInk: '#6E5210',
  },
  silver: {
    numeral: '2',
    label: '2nd best',
    from: '#EFF1F4',
    to: '#B4BBC4',
    ring: 'rgba(85,95,108,0.28)',
    ink: '#3B4148',
    rowBg: '#F5F7FA',
    badgeBg: '#ECEEF1',
    badgeInk: '#5A6068',
  },
  bronze: {
    numeral: '3',
    label: '3rd best',
    from: '#F0C69C',
    to: '#B0733C',
    ring: 'rgba(120,70,25,0.30)',
    ink: '#4B2F13',
    rowBg: '#FDF6EF',
    badgeBg: '#F3E1D0',
    badgeInk: '#7A4A1E',
  },
};

function Medal({ kind }: { kind: RecapMedal | null }) {
  if (!kind) {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-paper text-muted">
        <DumbbellIcon />
      </span>
    );
  }
  const m = MEDALS[kind];
  return (
    <span
      aria-label={`${kind} medal`}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold"
      style={{
        backgroundImage: `linear-gradient(145deg, ${m.from}, ${m.to})`,
        boxShadow: `inset 0 0 0 1px ${m.ring}, 0 1px 2px rgba(0,0,0,0.08)`,
        color: m.ink,
      }}
    >
      {m.numeral}
    </span>
  );
}

function MedalBadge({ kind }: { kind: RecapMedal }) {
  const m = MEDALS[kind];
  return (
    <span
      className="rounded-pill px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
      style={{ backgroundColor: m.badgeBg, color: m.badgeInk }}
    >
      {m.label}
    </span>
  );
}

/** Placeholders while the recap loads, so nothing jumps when it lands. */
function SkeletonTile() {
  return (
    <div className="rounded-card bg-paper-card p-4 shadow-card">
      <div className="h-9 w-9 rounded-full bg-paper" />
      <div className="mt-3 h-3 w-16 rounded-pill bg-line/70" />
      <div className="mt-2 h-6 w-12 rounded-pill bg-line/70" />
      <div className="mt-2 h-2.5 w-20 rounded-pill bg-line/50" />
    </div>
  );
}

/** The Performance tab's staggered entrance, so the two screens settle alike. */
function Rise({ index, children }: { index: number; children: ReactNode }) {
  return (
    <div style={{ animation: 'reps-rise 420ms ease-out both', animationDelay: `${index * 70}ms` }}>
      {children}
    </div>
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
