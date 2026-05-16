import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { PageHeader } from '../components/PageHeader';
import { getActivePlan, weeksOnPlan, type FullPlan } from '../lib/plansApi';
import {
  getBodyWeightUnit,
  setBodyWeightUnit,
  getLiftWeightUnit,
  setLiftWeightUnit,
  type BodyWeightUnit,
  type LiftWeightUnit,
} from '../lib/units';
import {
  getWaterGoal,
  setWaterGoal,
  getWaterUnit,
  setWaterUnit,
  type WaterUnit,
} from '../lib/waterApi';
import {
  getRecentSessionNotes,
  getWeeklyWorkoutSummary,
  hasAnySessionsBefore,
  mondayOfWeek,
  type WeeklyWorkoutSummary,
  type BodyPartStats,
} from '../lib/sessionsApi';
import { kgToLb } from '../lib/units';

interface Props {
  onUploadPlan: () => void;
  onOpenHistory?: () => void;
  onOpenPlans?: () => void;
}

export function Profile({ onUploadPlan, onOpenHistory, onOpenPlans }: Props) {
  const { session, signOut } = useAuth();
  const [plan, setPlan] = useState<FullPlan | null>(null);
  const [bwUnit, setBwUnitState] = useState<BodyWeightUnit>(getBodyWeightUnit());
  const [lwUnit, setLwUnitState] = useState<LiftWeightUnit>(getLiftWeightUnit());
  const [waterGoal, setWaterGoalState] = useState<number>(getWaterGoal());
  const [waterUnit, setWaterUnitState] = useState<WaterUnit>(getWaterUnit());

  useEffect(() => {
    getActivePlan().then(setPlan).catch(() => {});
  }, []);

  function changeBwUnit(u: BodyWeightUnit) {
    setBwUnitState(u);
    setBodyWeightUnit(u);
  }
  function changeLwUnit(u: LiftWeightUnit) {
    setLwUnitState(u);
    setLiftWeightUnit(u);
  }

  return (
    <div className="min-h-screen bg-paper pb-28">
      <div
        className="mx-auto max-w-md px-5"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 44px)' }}
      >
        <PageHeader title="Profile" />

        <p className="mt-3 break-all text-sm text-muted">
          {session?.user.email}
        </p>

        <Section title="Active plan">
          <div className="rounded-card bg-paper-card p-5 shadow-card">
            {plan ? (
              <>
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                  Week {weeksOnPlan(plan.activated_at)}
                </div>
                <div className="mt-1 text-xl font-bold tracking-tight text-ink">
                  {plan.name}
                </div>
                <div className="mt-0.5 text-sm text-muted">
                  Started{' '}
                  {new Date(plan.activated_at ?? plan.uploaded_at).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}{' '}
                  · {plan.training_days?.length ?? 0} days
                </div>
              </>
            ) : (
              <div className="text-sm text-muted">No plan loaded.</div>
            )}
            <button
              onClick={plan && onOpenPlans ? onOpenPlans : onUploadPlan}
              className="mt-4 w-full rounded-pill bg-ink py-3 text-sm font-semibold text-white active:opacity-80"
            >
              {plan ? 'Switch or manage plans' : 'Upload plan'}
            </button>
          </div>
        </Section>

        <Section title="Preferences">
          <div className="overflow-hidden rounded-card bg-paper-card shadow-card">
            <PrefRow
              label="Body weight units"
              hint="On the Body Weight screen"
              value={bwUnit}
              options={['kg', 'st'] as const}
              onChange={changeBwUnit}
            />
            <div className="border-t border-line" />
            <PrefRow
              label="Lift weight units"
              hint="On exercise set logging"
              value={lwUnit}
              options={['kg', 'lb'] as const}
              onChange={changeLwUnit}
            />
            <div className="border-t border-line" />
            <div className="flex items-center justify-between px-5 py-4">
              <div>
                <div className="text-sm font-semibold text-ink">Daily water goal</div>
                <div className="mt-0.5 text-xs text-muted">Tap the home tile to log</div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={99}
                  value={waterGoal}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (!Number.isNaN(n) && n > 0) {
                      setWaterGoalState(n);
                      setWaterGoal(n);
                    }
                  }}
                  className="w-14 rounded-xl border border-line bg-paper px-2 py-1 text-center text-sm font-semibold text-ink focus:border-ink focus:outline-none"
                />
                <select
                  value={waterUnit}
                  onChange={(e) => {
                    const u = e.target.value as WaterUnit;
                    setWaterUnitState(u);
                    setWaterUnit(u);
                  }}
                  className="rounded-xl border border-line bg-paper py-1 pl-3 pr-7 text-sm font-semibold text-ink focus:border-ink focus:outline-none"
                >
                  <option value="bottles">bottles</option>
                  <option value="glasses">glasses</option>
                  <option value="cups">cups</option>
                  <option value="L">litres</option>
                </select>
              </div>
            </div>
          </div>
        </Section>

        <Section title="Activity">
          <div className="overflow-hidden rounded-card bg-paper-card shadow-card">
            <button
              onClick={onOpenHistory}
              className="flex w-full items-center justify-between px-5 py-4 text-left active:bg-line/40"
            >
              <div className="text-sm font-semibold text-ink">Workout history</div>
              <ChevronRight />
            </button>
            <div className="border-t border-line" />
            <CoachExportRow />
            <div className="border-t border-line" />
            <CoachWeeklySummaryRow />
          </div>
        </Section>

        <Section title="Account">
          <button
            onClick={signOut}
            className="w-full rounded-card bg-paper-card px-5 py-4 text-left text-sm font-semibold text-red-600 shadow-card active:bg-red-50"
          >
            Sign out
          </button>
        </Section>
      </div>

    </div>
  );
}

function PrefRow<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint: string;
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center justify-between px-5 py-4">
      <div>
        <div className="text-sm font-semibold text-ink">{label}</div>
        <div className="mt-0.5 text-xs text-muted">{hint}</div>
      </div>
      <div className="flex rounded-pill bg-line p-0.5">
        {options.map((u) => (
          <button
            key={u}
            onClick={() => onChange(u)}
            className={`rounded-pill px-3 py-1 text-xs font-semibold uppercase tracking-wider ${
              value === u ? 'bg-ink text-white' : 'text-muted'
            }`}
          >
            {u}
          </button>
        ))}
      </div>
    </div>
  );
}

function ChevronRight() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
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

function CoachExportRow() {
  const [copied, setCopied] = useState(false);

  async function exportWeek() {
    try {
      const rows = await getRecentSessionNotes(7);
      const withNotes = rows.filter((r) => (r.notesToCoach ?? '').trim().length > 0);
      if (withNotes.length === 0) return;
      const md = buildCoachExport(withNotes);
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(md);
      } else {
        downloadFile(`coach-notes-${todayIso()}.md`, md);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // silent — copy is best-effort
    }
  }

  return (
    <button
      onClick={exportWeek}
      className="flex w-full items-center justify-between px-5 py-4 text-left active:bg-line/40"
    >
      <div className="text-sm font-semibold text-ink">
        {copied ? 'Copied' : "Copy this week's notes for coach"}
      </div>
      <CopyIcon />
    </button>
  );
}

function CopyIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function buildCoachExport(rows: Awaited<ReturnType<typeof getRecentSessionNotes>>): string {
  const out: string[] = [];
  out.push(`# Notes for coach`);
  out.push(`Week ending ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`);
  out.push('');
  for (const r of rows) {
    const date = new Date(r.completedAt).toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
    out.push(`## ${r.dayName} — ${date}`);
    if (r.notesToCoach) out.push(r.notesToCoach.trim());
    out.push('');
  }
  return out.join('\n');
}

function CoachWeeklySummaryRow() {
  const [copied, setCopied] = useState(false);

  async function exportSummary() {
    try {
      const thisWeekStart = mondayOfWeek(0);
      const [thisWeek, hasHistory] = await Promise.all([
        getWeeklyWorkoutSummary(thisWeekStart),
        hasAnySessionsBefore(thisWeekStart.toISOString()),
      ]);
      if (thisWeek.workoutsDone === 0) return;
      const prevWeek = hasHistory
        ? await getWeeklyWorkoutSummary(mondayOfWeek(-1))
        : null;
      const md = buildCoachWeeklySummary(thisWeek, prevWeek);
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(md);
      } else {
        downloadFile(`coach-weekly-summary-${todayIso()}.md`, md);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // silent — copy is best-effort
    }
  }

  return (
    <button
      onClick={exportSummary}
      className="flex w-full items-center justify-between px-5 py-4 text-left active:bg-line/40"
    >
      <div className="text-sm font-semibold text-ink">
        {copied ? 'Copied' : "Copy weekly summary for coach"}
      </div>
      <CopyIcon />
    </button>
  );
}

function buildCoachWeeklySummary(
  current: WeeklyWorkoutSummary,
  previous: WeeklyWorkoutSummary | null
): string {
  const unit = getLiftWeightUnit();
  const fmtWeight = (kg: number) => {
    const v = unit === 'lb' ? kgToLb(kg) : kg;
    return `${Math.round(v).toLocaleString('en-GB')} ${unit}`;
  };
  const dateLong = (d: Date) =>
    d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const dayAndDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });

  // Last day of the week is the day before weekEnd (Sunday).
  const lastDay = new Date(current.weekEnd);
  lastDay.setDate(lastDay.getDate() - 1);

  const out: string[] = [];
  out.push(`# Weekly workout summary`);
  out.push(`Week of ${dateLong(current.weekStart)} – ${dateLong(lastDay)}`);
  if (!previous) out.push(`First week of data — no comparison available.`);
  out.push('');

  const headline = `${current.workoutsDone} workout${current.workoutsDone === 1 ? '' : 's'} · ${fmtWeight(current.totalVolume)} total volume`;
  out.push(previous ? `${headline} ${deltaSuffix(current.totalVolume, previous.totalVolume)}` : headline);
  if (current.sessions.length > 0) {
    const list = current.sessions
      .map((s) => `${s.trainingDayName} (${dayAndDate(s.completedAt)})`)
      .join(', ');
    out.push(`Sessions: ${list}`);
  }
  out.push('');

  // Merge body parts from this week and (if comparing) last week so dropped
  // areas still show up at the bottom.
  const prevByName = new Map<string, BodyPartStats>();
  if (previous) {
    for (const p of previous.byBodyPart) prevByName.set(p.bodyPart, p);
  }
  const seen = new Set<string>();
  const ordered: { current: BodyPartStats | null; previous: BodyPartStats | null }[] = [];
  for (const cur of current.byBodyPart) {
    seen.add(cur.bodyPart);
    ordered.push({ current: cur, previous: prevByName.get(cur.bodyPart) ?? null });
  }
  if (previous) {
    const dropped = previous.byBodyPart
      .filter((p) => !seen.has(p.bodyPart))
      .sort((a, b) => b.volume - a.volume);
    for (const p of dropped) ordered.push({ current: null, previous: p });
  }

  for (const row of ordered) {
    const name = (row.current ?? row.previous)!.bodyPart;
    if (row.current) {
      const c = row.current;
      const volPart = c.volume > 0 ? fmtWeight(c.volume) : `${c.setCount} set${c.setCount === 1 ? '' : 's'}`;
      const delta = previous ? ` ${deltaSuffix(c.volume, row.previous?.volume ?? 0)}` : '';
      const sessions = c.sessionCount > 1 ? ` · ×${c.sessionCount} sessions` : '';
      out.push(`## ${name} — ${volPart}${delta}${sessions}`);
      if (c.topSet) {
        out.push(
          `Top set: ${c.topSet.exercise} — ${fmtWeight(c.topSet.weight)} × ${c.topSet.reps}`
        );
      }
    } else if (row.previous) {
      out.push(`## ${name} — ${fmtWeight(0)} (−100% vs last week)`);
      out.push(`Not trained this week.`);
    }
    out.push('');
  }
  return out.join('\n').trimEnd() + '\n';
}

function deltaSuffix(current: number, previous: number): string {
  if (previous === 0) {
    return current === 0 ? '(no change vs last week)' : '(new this week)';
  }
  const pct = ((current - previous) / previous) * 100;
  const rounded = Math.round(pct);
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '';
  return `(${sign}${Math.abs(rounded)}% vs last week)`;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function downloadFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-7">
      <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
        {title}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}
