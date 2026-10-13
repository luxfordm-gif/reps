// Home on desktop: your own training first, then every athlete who has
// invited you (the ones needing a look first), and the box for a new invite
// code. Someone who coaches nobody is taken straight to their own week.

import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/useAuth';
import { getMyProfile } from '../lib/profileApi';
import { DEMO_ATHLETE_ID } from '../lib/coach/demoData';
import { acceptInvite, listAthletes, type CoachAthlete } from '../lib/coachAccessApi';
import { loadAthleteGlance } from '../lib/coach/coachApi';
import { addDays, buildCoachWeek, lastSessionAt, mondayOf, type CoachWeek } from '../lib/coach/coachWeek';
import { SkeletonCards } from '../components/Skeleton';
import { ago, hours } from './format';

interface Glance {
  athlete: CoachAthlete;
  thisWeek: CoachWeek | null;
  lastWeek: CoachWeek | null;
  lastTrained: string | null;
}

export function AthletesScreen() {
  const [glances, setGlances] = useState<Glance[] | null>(null);
  const [self, setSelf] = useState<Glance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { session } = useAuth();
  const myId = session?.user.id ?? '';
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const stay = (location.state as { stay?: boolean } | null)?.stay === true || params.has('code');

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        // Before the coach-access migration has run there's nobody to list,
        // which is the same as coaching nobody.
        const athletes = await listAthletes().catch(() => [] as CoachAthlete[]);
        if (athletes.length === 0 && !stay) {
          navigate(`/coach/${myId}`, { replace: true });
          return;
        }
        const now = new Date();
        const thisMonday = mondayOf(now);
        const lastMonday = addDays(thisMonday, -7);
        const profile = await getMyProfile().catch(() => null);
        const me: CoachAthlete = {
          athlete_id: myId,
          display_name: profile?.display_name ?? null,
          linked_at: new Date().toISOString(),
        };
        const [mine, ...out] = await Promise.all(
          [me, ...athletes].map(async (athlete): Promise<Glance> => {
            try {
              const data = await loadAthleteGlance(athlete.athlete_id, addDays(lastMonday, -7));
              return {
                athlete,
                thisWeek: buildCoachWeek(data, thisMonday, 'last', now),
                lastWeek: buildCoachWeek(data, lastMonday, 'last', now),
                lastTrained: lastSessionAt(data),
              };
            } catch {
              return { athlete, thisWeek: null, lastWeek: null, lastTrained: null };
            }
          }),
        );
        // The ones with something to look at come first, then by name.
        out.sort(
          (a, b) =>
            (b.lastWeek?.flags.length ?? 0) - (a.lastWeek?.flags.length ?? 0) ||
            nameOf(a.athlete).localeCompare(nameOf(b.athlete)),
        );
        if (live) {
          setSelf(mine);
          setGlances(out);
        }
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [myId, navigate, stay]);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-display font-bold tracking-title text-ink">Training</h1>
          <p className="mt-1 text-sm text-muted">Yours, and anyone who has shared theirs with you.</p>
        </div>
        <Link to={`/coach/${DEMO_ATHLETE_ID}`} className="text-sm font-semibold text-muted hover:text-ink">
          See a sample
        </Link>
      </div>

      {self && (
        <div className="mt-6 max-w-xl">
          <AthleteCard glance={self} title="Your training" />
        </div>
      )}
      {self && <h2 className="mt-8 text-base font-semibold tracking-tight text-ink">Athletes you coach</h2>}

      <div className="mt-3 grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div>
          {error ? (
            <div className="rounded-card bg-danger-soft p-5 text-sm text-danger">Couldn't load your athletes: {error}</div>
          ) : glances == null ? (
            <SkeletonCards />
          ) : glances.length === 0 ? (
            <div className="rounded-card bg-paper-card p-8 text-center shadow-card">
              <div className="text-base font-semibold text-ink">No athletes yet</div>
              <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
                Coaching someone?{' '}
                Ask your athlete to open Reps on their phone, go to Profile → Coach and send you an invite
                code. Enter it here.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {glances.map((g) => (
                <AthleteCard key={g.athlete.athlete_id} glance={g} />
              ))}
            </div>
          )}
        </div>
        <InviteBox />
      </div>
    </div>
  );
}

function nameOf(a: CoachAthlete): string {
  return a.display_name?.trim() || 'Your athlete';
}

function AthleteCard({ glance, title }: { glance: Glance; title?: string }) {
  const { athlete, thisWeek, lastWeek, lastTrained } = glance;
  const flags = lastWeek?.flags ?? [];
  return (
    <Link
      to={`/coach/${athlete.athlete_id}`}
      className="block rounded-card bg-paper-card p-5 shadow-card transition-shadow hover:shadow-lift-soft"
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="truncate text-lg font-semibold tracking-tight text-ink">{title ?? nameOf(athlete)}</div>
        <div className="shrink-0 text-xs text-muted">
          {lastTrained ? `Trained ${ago(lastTrained).toLowerCase()}` : 'Nothing logged yet'}
        </div>
      </div>
      {thisWeek ? (
        <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
          <div>
            <dt className="text-xs text-muted">This week</dt>
            <dd className="font-semibold tabular-nums text-ink">
              {thisWeek.target > 0
                ? `${thisWeek.workouts.current} of ${thisWeek.target}`
                : `${thisWeek.workouts.current} sessions`}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Last week</dt>
            <dd className="font-semibold tabular-nums text-ink">
              {lastWeek && lastWeek.target > 0
                ? `${lastWeek.workouts.current} of ${lastWeek.target}`
                : `${lastWeek?.workouts.current ?? 0} sessions`}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Sleep, last week</dt>
            <dd className="font-semibold tabular-nums text-ink">
              {lastWeek?.sleepHours.current != null ? hours(lastWeek.sleepHours.current) : '–'}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="mt-3 text-sm text-muted">Couldn't load a summary. Open to try again.</p>
      )}
      {flags.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Last week, worth a look">
          {flags.map((f) => (
            <li
              key={f.key}
              className={`rounded-pill px-2.5 py-1 text-xs font-medium ${
                f.tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-surface-strong text-ink'
              }`}
            >
              {f.text}
            </li>
          ))}
        </ul>
      )}
    </Link>
  );
}

function InviteBox() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [code, setCode] = useState(() => params.get('code') ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fromLink = params.get('code') != null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const athleteId = await acceptInvite(code);
      setParams({});
      navigate(`/coach/${athleteId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="h-fit rounded-card bg-paper-card p-5 shadow-card">
      <h2 className="text-base font-semibold tracking-tight text-ink">Add an athlete</h2>
      <p className="mt-1 text-sm text-muted">
        {fromLink
          ? 'Your invite code is filled in. Add them to see their training.'
          : 'Enter the code they sent you from Profile → Coach in Reps.'}
      </p>
      <label htmlFor="invite-code" className="sr-only">
        Invite code
      </label>
      <input
        id="invite-code"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="ABCD EFGH"
        autoComplete="off"
        spellCheck={false}
        autoFocus={fromLink}
        className="mt-4 w-full rounded-control border border-line bg-paper px-4 py-3 text-center font-mono text-xl font-bold tracking-widest text-ink placeholder:text-line focus:border-ink focus:outline-none"
      />
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      <button
        type="submit"
        disabled={!code.trim() || busy}
        className="mt-3 w-full rounded-pill bg-ink py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
      >
        {busy ? 'Adding…' : 'Add athlete'}
      </button>
    </form>
  );
}
