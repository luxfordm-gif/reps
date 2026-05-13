import { useEffect, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import {
  listPlans,
  renamePlan,
  activatePlan,
  weeksOnPlan,
  getPlanDetail,
  type PlanSummary,
  type FullPlan,
} from '../lib/plansApi';

interface Props {
  onBack: () => void;
  onUpload: () => void;
  onAfterActivate?: () => void;
}

type SwitchTarget = { id: string; name: string };

export function Plans({ onBack, onUpload, onAfterActivate }: Props) {
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  const [switchTarget, setSwitchTarget] = useState<SwitchTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailById, setDetailById] = useState<Record<string, FullPlan | null>>({});
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);

  async function refresh() {
    try {
      const list = await listPlans();
      setPlans(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load plans');
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function commitRename(planId: string) {
    const next = editingValue.trim();
    setEditingId(null);
    if (!next) return;
    try {
      await renamePlan(planId, next);
      await refresh();
      // Refresh detail too so the title updates in any expanded card.
      if (detailById[planId]) {
        try {
          const fresh = await getPlanDetail(planId);
          setDetailById((d) => ({ ...d, [planId]: fresh }));
        } catch {
          // best effort
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to rename plan');
    }
  }

  async function toggleExpanded(planId: string) {
    if (expandedId === planId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(planId);
    if (!detailById[planId]) {
      setLoadingDetailId(planId);
      try {
        const detail = await getPlanDetail(planId);
        setDetailById((d) => ({ ...d, [planId]: detail }));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load plan detail');
      } finally {
        setLoadingDetailId(null);
      }
    }
  }

  async function handleActivate(mode: 'resume' | 'restart') {
    if (!switchTarget) return;
    setBusy(true);
    try {
      await activatePlan(switchTarget.id, mode);
      setSwitchTarget(null);
      await refresh();
      onAfterActivate?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to switch plan');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-paper pb-28">
      <div className="mx-auto max-w-md px-5 pt-3">
        <PageHeader title="Your plans" onBack={onBack} />

        {error && (
          <div className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {plans === null ? (
          <div className="mt-10 text-center text-sm text-muted">Loading…</div>
        ) : plans.length === 0 ? (
          <div className="mt-10 rounded-card bg-paper-card p-8 text-center shadow-card">
            <h2 className="text-xl font-bold tracking-tight text-ink">No plans yet</h2>
            <p className="mt-2 text-sm text-muted">
              Upload your first training plan to get started.
            </p>
            <button
              onClick={onUpload}
              className="mt-5 w-full rounded-pill bg-ink py-3 text-sm font-semibold text-white active:opacity-80"
            >
              Upload a plan
            </button>
          </div>
        ) : (
          <>
            <div className="mt-6 space-y-3">
              {plans.map((p) => (
                <PlanCard
                  key={p.id}
                  plan={p}
                  editing={editingId === p.id}
                  editingValue={editingValue}
                  onEditStart={() => {
                    setEditingId(p.id);
                    setEditingValue(p.name);
                  }}
                  onEditChange={setEditingValue}
                  onEditCommit={() => commitRename(p.id)}
                  onEditCancel={() => setEditingId(null)}
                  onSwitch={() => setSwitchTarget({ id: p.id, name: p.name })}
                  expanded={expandedId === p.id}
                  onToggleExpanded={() => toggleExpanded(p.id)}
                  detail={detailById[p.id] ?? null}
                  loadingDetail={loadingDetailId === p.id}
                />
              ))}
            </div>

            <button
              onClick={onUpload}
              className="mt-6 w-full rounded-pill border border-line bg-paper-card py-4 text-base font-semibold text-ink active:bg-line/40"
            >
              Upload a new plan
            </button>
          </>
        )}
      </div>

      {switchTarget && (
        <SwitchPlanDialog
          name={switchTarget.name}
          busy={busy}
          onResume={() => handleActivate('resume')}
          onRestart={() => handleActivate('restart')}
          onCancel={() => setSwitchTarget(null)}
        />
      )}
    </div>
  );
}

function PlanCard({
  plan,
  editing,
  editingValue,
  onEditStart,
  onEditChange,
  onEditCommit,
  onEditCancel,
  onSwitch,
  expanded,
  onToggleExpanded,
  detail,
  loadingDetail,
}: {
  plan: PlanSummary;
  editing: boolean;
  editingValue: string;
  onEditStart: () => void;
  onEditChange: (v: string) => void;
  onEditCommit: () => void;
  onEditCancel: () => void;
  onSwitch: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  detail: FullPlan | null;
  loadingDetail: boolean;
}) {
  const uploaded = new Date(plan.uploaded_at).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const weeks = plan.is_active ? weeksOnPlan(plan.activated_at) : null;
  const statusLabel = plan.is_active
    ? `Active · Week ${weeks}`
    : plan.activated_at
    ? `Last active ${relativeDate(plan.activated_at)}`
    : 'Never started';
  const dark = plan.is_active;

  return (
    <div
      className={`rounded-card shadow-card ${
        dark ? 'bg-ink text-white' : 'bg-paper-card text-ink'
      }`}
    >
      <div className="p-5">
        <div
          className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${
            dark ? 'text-white/70' : 'text-muted'
          }`}
        >
          {statusLabel}
        </div>
        <div className="mt-1 flex items-center gap-2">
          {editing ? (
            <input
              value={editingValue}
              onChange={(e) => onEditChange(e.target.value)}
              onBlur={onEditCommit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onEditCommit();
                if (e.key === 'Escape') onEditCancel();
              }}
              autoFocus
              maxLength={80}
              className={`flex-1 rounded-xl border px-3 py-1.5 text-lg font-bold tracking-tight focus:outline-none ${
                dark
                  ? 'border-white/30 bg-white/10 text-white'
                  : 'border-line bg-paper text-ink focus:border-ink'
              }`}
            />
          ) : (
            <button
              type="button"
              onClick={onEditStart}
              className="flex-1 text-left text-xl font-bold tracking-tight"
            >
              {plan.name}
            </button>
          )}
          {!editing && (
            <button
              onClick={onEditStart}
              aria-label="Rename plan"
              className={`shrink-0 rounded-full p-2 ${
                dark ? 'active:bg-white/15' : 'active:bg-line/40'
              }`}
            >
              <PencilIcon />
            </button>
          )}
        </div>
        <div className={`mt-1 text-sm ${dark ? 'text-white/70' : 'text-muted'}`}>
          {plan.day_count} {plan.day_count === 1 ? 'day' : 'days'} · uploaded {uploaded}
        </div>
        {!plan.is_active && (
          <button
            onClick={onSwitch}
            className="mt-4 w-full rounded-pill bg-ink py-2.5 text-sm font-semibold text-white active:opacity-80"
          >
            Switch to this plan
          </button>
        )}
        <button
          onClick={onToggleExpanded}
          className={`mt-4 flex w-full items-center justify-between rounded-pill px-4 py-2.5 text-sm font-semibold ${
            dark
              ? 'bg-white/10 text-white active:bg-white/15'
              : 'border border-line bg-paper-card text-ink active:bg-line/40'
          }`}
        >
          <span>{expanded ? 'Hide exercises' : 'See exercises'}</span>
          <Chevron rotated={expanded} />
        </button>
      </div>

      {expanded && (
        <div
          className={`border-t px-5 pb-5 ${
            dark ? 'border-white/15' : 'border-line'
          }`}
        >
          {loadingDetail && !detail ? (
            <div
              className={`py-4 text-center text-sm ${
                dark ? 'text-white/60' : 'text-muted'
              }`}
            >
              Loading…
            </div>
          ) : detail ? (
            <div className="mt-3 space-y-2">
              {(detail.training_days ?? []).map((d) => (
                <DayRow key={d.id} day={d} dark={dark} />
              ))}
            </div>
          ) : (
            <div
              className={`py-4 text-center text-sm ${
                dark ? 'text-white/60' : 'text-muted'
              }`}
            >
              Couldn't load this plan's exercises.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DayRow({
  day,
  dark,
}: {
  day: FullPlan['training_days'][number];
  dark: boolean;
}) {
  const [open, setOpen] = useState(false);
  const exercises = day.plan_exercises ?? [];
  return (
    <div
      className={`overflow-hidden rounded-2xl ${
        dark ? 'bg-white/5' : 'bg-paper'
      }`}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between px-4 py-3 text-left ${
          dark ? 'active:bg-white/10' : 'active:bg-line/40'
        }`}
      >
        <div>
          <div className="text-base font-semibold">{day.name}</div>
          <div className={`mt-0.5 text-xs ${dark ? 'text-white/60' : 'text-muted'}`}>
            {exercises.length} {exercises.length === 1 ? 'exercise' : 'exercises'}
          </div>
        </div>
        <Chevron rotated={open} />
      </button>
      {open && exercises.length > 0 && (
        <ul
          className={`divide-y px-4 pb-3 text-sm ${
            dark ? 'divide-white/10' : 'divide-line'
          }`}
        >
          {exercises.map((ex) => (
            <li key={ex.id} className="py-2">
              <div className="font-medium">{ex.name}</div>
              <div
                className={`mt-0.5 text-xs ${
                  dark ? 'text-white/60' : 'text-muted'
                }`}
              >
                {ex.body_part ? `${ex.body_part} · ` : ''}
                {ex.total_sets ?? '?'} sets · {ex.rep_range || '?'}
                {ex.tempo ? ` · ${ex.tempo}` : ''}
              </div>
            </li>
          ))}
        </ul>
      )}
      {open && exercises.length === 0 && (
        <div
          className={`px-4 pb-3 text-xs ${
            dark ? 'text-white/60' : 'text-muted'
          }`}
        >
          No exercises in this day.
        </div>
      )}
    </div>
  );
}

function SwitchPlanDialog({
  name,
  busy,
  onResume,
  onRestart,
  onCancel,
}: {
  name: string;
  busy: boolean;
  onResume: () => void;
  onRestart: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 px-6 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-card bg-paper-card p-6 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-center text-xl font-bold tracking-tight text-ink">
          Switch to "{name}"?
        </h2>
        <p className="mt-2 text-center text-sm text-muted">
          You'll keep every set you've ever logged. Pick up where you left off, or
          start the plan from week 1?
        </p>
        <div className="mt-6 space-y-3">
          <button
            onClick={onResume}
            disabled={busy}
            className="w-full rounded-pill bg-ink py-3 text-sm font-semibold text-white active:opacity-80 disabled:opacity-50"
          >
            Continue where I left off
          </button>
          <button
            onClick={onRestart}
            disabled={busy}
            className="w-full rounded-pill border border-line bg-paper-card py-3 text-sm font-semibold text-ink active:bg-line/40 disabled:opacity-50"
          >
            Start again from week 1
          </button>
          <button
            onClick={onCancel}
            disabled={busy}
            className="w-full py-2 text-sm text-muted"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function relativeDate(iso: string): string {
  const then = new Date(iso).getTime();
  const days = Math.floor((Date.now() - then) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function PencilIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path
        d="M11.5 3.5l3 3-8 8H3.5v-3l8-8z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Chevron({ rotated }: { rotated: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 18 18"
      fill="none"
      style={{
        transition: 'transform 180ms ease-out',
        transform: rotated ? 'rotate(90deg)' : 'rotate(0deg)',
      }}
    >
      <path
        d="M7 4l5 5-5 5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
