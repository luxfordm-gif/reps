import { useEffect, useState } from 'react';
import { Link, Outlet, useNavigate, useParams } from 'react-router-dom';
import { listAthletes, removeLink } from '../lib/coachAccessApi';
import { loadAthleteData, type AthleteData } from '../lib/coach/coachApi';
import { DEMO_ATHLETE_ID, DEMO_NAME, demoAthleteData } from '../lib/coach/demoData';
import { getMyProfile } from '../lib/profileApi';
import { lastSessionAt } from '../lib/coach/coachWeek';
import { weeksOnPlanAt } from '../lib/dashboard';
import { useAuth } from '../lib/useAuth';
import { ConfirmModal } from '../components/ConfirmModal';
import { SkeletonRows } from '../components/Skeleton';
import { ago } from './format';
import { STAY_HOME, type AthleteContext } from './athleteContext';

/** Keyed on the athlete, so moving between athletes starts from a clean load
 *  rather than showing one athlete's figures under another's name. */
export function AthleteLayout() {
  const { athleteId = '' } = useParams();
  return <AthleteLoader key={athleteId} athleteId={athleteId} />;
}

type Load =
  | { state: 'loading' }
  | { state: 'missing' }
  | { state: 'failed'; message: string }
  | { state: 'ready'; name: string; data: AthleteData };

/** Whose page this is: made-up sample data, the signed-in person's own
 *  training, or an athlete who invited them. Only the last can be unfollowed. */
type Whose = 'demo' | 'self' | 'athlete';

function AthleteLoader({ athleteId }: { athleteId: string }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const { session } = useAuth();
  const navigate = useNavigate();
  const whose: Whose =
    athleteId === DEMO_ATHLETE_ID ? 'demo' : athleteId === session?.user.id ? 'self' : 'athlete';

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        if (whose === 'demo') {
          if (live) setLoad({ state: 'ready', name: DEMO_NAME, data: demoAthleteData() });
          return;
        }
        if (whose === 'self') {
          // Your own rows are readable whether or not anyone has been invited,
          // so this needs nothing from the coach-access migration.
          const [profile, data] = await Promise.all([
            getMyProfile().catch(() => null),
            loadAthleteData(athleteId),
          ]);
          if (live) setLoad({ state: 'ready', name: profile?.display_name?.trim() || 'Your training', data });
          return;
        }
        const athletes = await listAthletes();
        const me = athletes.find((a) => a.athlete_id === athleteId);
        if (!me) {
          if (live) setLoad({ state: 'missing' });
          return;
        }
        const data = await loadAthleteData(athleteId);
        if (live) setLoad({ state: 'ready', name: me.display_name?.trim() || 'Your athlete', data });
      } catch (e) {
        if (live) setLoad({ state: 'failed', message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      live = false;
    };
  }, [athleteId, attempt, whose]);

  if (load.state === 'loading') {
    return (
      <div>
        <div className="h-8 w-48 animate-pulse rounded-pill bg-line/70" />
        <SkeletonRows rows={5} className="mt-6" />
      </div>
    );
  }
  if (load.state === 'missing') {
    return (
      <Notice
        title="You can't see this athlete"
        body="They haven't invited you, or they've since removed you. Ask them for a new code from Profile → Coach in Reps."
      />
    );
  }
  if (load.state === 'failed') {
    return (
      <Notice title="Couldn't load this athlete" body={load.message}>
        <button
          onClick={() => {
            setLoad({ state: 'loading' });
            setAttempt((n) => n + 1);
          }}
          className="mt-4 rounded-pill bg-ink px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          Try again
        </button>
      </Notice>
    );
  }

  const { name, data } = load;
  const last = lastSessionAt(data);
  const planLine = data.plan
    ? `${data.plan.name} · week ${weeksOnPlanAt(data.plan.activatedAt, new Date())}`
    : 'No active plan';

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <Link to="/coach" state={STAY_HOME} className="text-sm text-muted hover:text-ink">
            ← {whose === 'athlete' ? 'Athletes' : 'Home'}
          </Link>
          <h1 className="mt-1 truncate text-display font-bold tracking-title text-ink">
            <Link to={`/coach/${athleteId}`} className="hover:underline">
              {name}
            </Link>
          </h1>
          <p className="mt-1 text-sm text-muted">
            {planLine}
            {last ? ` · last trained ${ago(last).toLowerCase()}` : ' · nothing logged yet'}
          </p>
        </div>
        {whose === 'athlete' && (
          <button
            onClick={() => setConfirmRemove(true)}
            className="rounded-pill px-3 py-1.5 text-sm font-semibold text-muted hover:bg-pressed hover:text-danger"
          >
            Stop following
          </button>
        )}
      </div>

      {whose === 'demo' && (
        <div className="mt-4 rounded-panel bg-warn-soft px-4 py-3 text-sm text-warn">
          Made-up training, to show what this page looks like. Sign in to see your own.
        </div>
      )}

      <Outlet context={{ athleteId, name, data } satisfies AthleteContext} />

      {confirmRemove && session && (
        <ConfirmModal
          title={`Stop following ${name}?`}
          message="You won't see their training any more. They can invite you again."
          confirmLabel="Stop following"
          onCancel={() => setConfirmRemove(false)}
          onConfirm={async () => {
            await removeLink(athleteId, session.user.id).catch(() => {});
            navigate('/coach');
          }}
        />
      )}
    </div>
  );
}

export function Notice({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mx-auto mt-10 max-w-md rounded-card bg-paper-card p-8 text-center shadow-card">
      <h1 className="text-xl font-bold tracking-tight text-ink">{title}</h1>
      <p className="mt-2 text-sm text-muted">{body}</p>
      {children}
      <div className="mt-6">
        <Link to="/coach" state={STAY_HOME} className="text-sm font-semibold text-ink hover:underline">
          Back
        </Link>
      </div>
    </div>
  );
}
