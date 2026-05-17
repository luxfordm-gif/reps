import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../lib/auth';
import { PageHeader } from '../components/PageHeader';
import { getActivePlan, weeksOnPlan, type FullPlan } from '../lib/plansApi';
import {
  getBodyWeightUnit,
  setBodyWeightUnit,
  getLiftWeightUnit,
  setLiftWeightUnit,
  getHeightUnit,
  setHeightUnit,
  stoneLbToKg,
  formatStoneLb,
  cmToFtIn,
  ftInToCm,
  formatFtIn,
  type BodyWeightUnit,
  type LiftWeightUnit,
  type HeightUnit,
} from '../lib/units';
import {
  upsertProfile,
  type Profile,
  type Gender,
  type TopGoal,
  type Experience,
} from '../lib/profileApi';
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
  profile?: Profile | null;
  onProfileChange?: (p: Profile) => void;
  onResumeOnboarding?: () => void;
}

export function Profile({
  onUploadPlan,
  onOpenHistory,
  onOpenPlans,
  profile,
  onProfileChange,
  onResumeOnboarding,
}: Props) {
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

        <PersonalDetailsSection
          profile={profile ?? null}
          onProfileChange={onProfileChange}
          onResumeOnboarding={onResumeOnboarding}
        />

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
              className="flex w-full items-center justify-between py-4 pl-5 pr-6 text-left active:bg-line/40"
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

type EditField = 'gender' | 'dob' | 'weight' | 'height' | 'goal' | 'experience';

function PersonalDetailsSection({
  profile,
  onProfileChange,
  onResumeOnboarding,
}: {
  profile: Profile | null;
  onProfileChange?: (p: Profile) => void;
  onResumeOnboarding?: () => void;
}) {
  const [editing, setEditing] = useState<EditField | null>(null);
  const [busy, setBusy] = useState(false);

  if (!profile) {
    // No profile row yet — prompt the user to set up. Once they've persisted
    // anything via onboarding, App.tsx will pass a real profile down and the
    // rows below render.
    return (
      <Section title="Personal details">
        <button
          onClick={onResumeOnboarding}
          className="flex w-full items-center justify-between rounded-card bg-paper-card py-4 pl-5 pr-6 text-left shadow-card active:opacity-80"
        >
          <div>
            <div className="text-sm font-semibold text-ink">Set up your profile</div>
            <div className="mt-0.5 text-xs text-muted">
              Tell us a bit about yourself to personalise the app.
            </div>
          </div>
          <ChevronRight />
        </button>
      </Section>
    );
  }

  const showDots = !profile.onboarding_completed;

  async function save(patch: Partial<Profile>) {
    setBusy(true);
    try {
      const next = await upsertProfile(patch);
      onProfileChange?.(next);
      setEditing(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Personal details">
      <div className="overflow-hidden rounded-card bg-paper-card shadow-card">
        <DetailRow
          label="Gender"
          incomplete={showDots && !profile.gender}
          editing={editing === 'gender'}
          onEdit={() => setEditing('gender')}
          onCancel={() => setEditing(null)}
          value={formatGender(profile.gender)}
        >
          <EnumEditor<Gender>
            value={profile.gender}
            options={[
              { value: 'male', label: 'Male' },
              { value: 'female', label: 'Female' },
              { value: 'other', label: 'Other' },
            ]}
            onSave={(v) => save({ gender: v })}
            busy={busy}
          />
        </DetailRow>

        <Divider />

        <DetailRow
          label="Date of birth"
          incomplete={showDots && !profile.date_of_birth}
          editing={editing === 'dob'}
          onEdit={() => setEditing('dob')}
          onCancel={() => setEditing(null)}
          value={formatDob(profile.date_of_birth)}
        >
          <DobEditor
            value={profile.date_of_birth}
            onSave={(v) => save({ date_of_birth: v })}
            busy={busy}
          />
        </DetailRow>

        <Divider />

        <DetailRow
          label="Starting weight"
          incomplete={showDots && profile.starting_weight_kg == null}
          editing={editing === 'weight'}
          onEdit={() => setEditing('weight')}
          onCancel={() => setEditing(null)}
          value={formatWeight(profile.starting_weight_kg)}
          hint="Used as your goal baseline."
        >
          <WeightEditor
            valueKg={profile.starting_weight_kg}
            onSave={(kg) => save({ starting_weight_kg: kg })}
            busy={busy}
          />
        </DetailRow>

        <Divider />

        <DetailRow
          label="Height"
          incomplete={showDots && profile.height_cm == null}
          editing={editing === 'height'}
          onEdit={() => setEditing('height')}
          onCancel={() => setEditing(null)}
          value={formatHeight(profile.height_cm)}
        >
          <HeightEditor
            valueCm={profile.height_cm}
            onSave={(cm) => save({ height_cm: cm })}
            busy={busy}
          />
        </DetailRow>

        <Divider />

        <DetailRow
          label="Top goals"
          incomplete={showDots && (!profile.top_goals || profile.top_goals.length === 0)}
          editing={editing === 'goal'}
          onEdit={() => setEditing('goal')}
          onCancel={() => setEditing(null)}
          value={formatGoals(profile.top_goals)}
        >
          <MultiEnumEditor<TopGoal>
            value={profile.top_goals ?? []}
            options={[
              { value: 'build_muscle', label: 'Build muscle' },
              { value: 'gain_strength', label: 'Gain strength' },
              { value: 'fat_loss', label: 'Fat loss' },
            ]}
            onSave={(v) => save({ top_goals: v.length > 0 ? v : null })}
            busy={busy}
          />
        </DetailRow>

        <Divider />

        <DetailRow
          label="Experience"
          incomplete={showDots && !profile.experience_level}
          editing={editing === 'experience'}
          onEdit={() => setEditing('experience')}
          onCancel={() => setEditing(null)}
          value={formatExperience(profile.experience_level)}
        >
          <EnumEditor<Experience>
            value={profile.experience_level}
            options={[
              { value: 'beginner', label: 'Beginner' },
              { value: 'intermediate', label: 'Intermediate' },
              { value: 'advanced', label: 'Advanced' },
            ]}
            onSave={(v) => save({ experience_level: v })}
            busy={busy}
          />
        </DetailRow>
      </div>

      {!profile.onboarding_completed && onResumeOnboarding && (
        <button
          onClick={onResumeOnboarding}
          className="mt-3 flex w-full items-center justify-between rounded-card bg-paper-card py-4 pl-5 pr-6 text-left shadow-card active:opacity-80"
        >
          <div className="text-sm font-semibold text-ink">Resume setup</div>
          <ChevronRight />
        </button>
      )}
    </Section>
  );
}

function Divider() {
  return <div className="border-t border-line" />;
}

function DetailRow({
  label,
  value,
  hint,
  incomplete,
  editing,
  onEdit,
  onCancel,
  children,
}: {
  label: string;
  value: string;
  hint?: string;
  incomplete: boolean;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  children: React.ReactNode;
}) {
  if (editing) {
    return (
      <div className="px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-ink">{label}</div>
          <button
            onClick={onCancel}
            className="text-xs font-semibold uppercase tracking-wider text-muted active:text-ink"
          >
            Cancel
          </button>
        </div>
        {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
        <div className="mt-3">{children}</div>
      </div>
    );
  }
  return (
    <button
      onClick={onEdit}
      className="flex w-full items-center justify-between py-4 pl-5 pr-6 text-left active:bg-line/40"
    >
      <div className="min-w-0">
        <div className="flex items-center">
          {incomplete && (
            <span className="mr-2 inline-block h-2 w-2 rounded-full bg-[#F5C518]" />
          )}
          <div className="text-sm font-semibold text-ink">{label}</div>
        </div>
        {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
      </div>
      <div className="ml-3 flex items-center gap-3">
        <div className="truncate text-sm text-muted">{value}</div>
        <ChevronRight />
      </div>
    </button>
  );
}

function EnumEditor<T extends string>({
  value,
  options,
  onSave,
  busy,
}: {
  value: T | null;
  options: { value: T; label: string }[];
  onSave: (v: T) => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState<T | null>(value);
  return (
    <>
      <div className="space-y-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setDraft(opt.value)}
            className={`flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left text-sm font-semibold transition-colors ${
              draft === opt.value
                ? 'border-2 border-ink bg-paper-card text-ink'
                : 'border border-line bg-paper-card text-ink'
            }`}
          >
            {opt.label}
            {draft === opt.value && <span className="text-xs text-muted">Selected</span>}
          </button>
        ))}
      </div>
      <button
        onClick={() => draft && onSave(draft)}
        disabled={busy || !draft || draft === value}
        className="mt-3 w-full rounded-pill bg-ink py-3 text-sm font-semibold text-white active:opacity-80 disabled:opacity-40"
      >
        {busy ? 'Saving…' : 'Save'}
      </button>
    </>
  );
}

function MultiEnumEditor<T extends string>({
  value,
  options,
  onSave,
  busy,
}: {
  value: T[];
  options: { value: T; label: string }[];
  onSave: (v: T[]) => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState<T[]>(value);
  function toggle(v: T) {
    setDraft((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]));
  }
  const sameAsValue =
    draft.length === value.length && draft.every((v) => value.includes(v));
  return (
    <>
      <div className="space-y-2">
        {options.map((opt) => {
          const selected = draft.includes(opt.value);
          return (
            <button
              key={opt.value}
              onClick={() => toggle(opt.value)}
              className={`flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left text-sm font-semibold transition-colors ${
                selected
                  ? 'border-2 border-ink bg-paper-card text-ink'
                  : 'border border-line bg-paper-card text-ink'
              }`}
            >
              {opt.label}
              {selected ? (
                <span className="flex h-5 w-5 items-center justify-center rounded-md bg-ink">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M3 8.5l3 3 6.5-6.5"
                      stroke="white"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              ) : (
                <span className="h-5 w-5 rounded-md border border-line" />
              )}
            </button>
          );
        })}
      </div>
      <button
        onClick={() => onSave(draft)}
        disabled={busy || sameAsValue}
        className="mt-3 w-full rounded-pill bg-ink py-3 text-sm font-semibold text-white active:opacity-80 disabled:opacity-40"
      >
        {busy ? 'Saving…' : 'Save'}
      </button>
    </>
  );
}

function DobEditor({
  value,
  onSave,
  busy,
}: {
  value: string | null;
  onSave: (v: string) => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState(value ?? '');
  const max = (() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 13);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  return (
    <>
      <input
        type="date"
        value={draft}
        max={max}
        onChange={(e) => setDraft(e.target.value)}
        className="w-full rounded-2xl border border-line bg-paper-card px-4 py-3 text-base font-semibold text-ink focus:border-ink focus:outline-none"
      />
      <button
        onClick={() => draft && onSave(draft)}
        disabled={busy || !draft || draft === value}
        className="mt-3 w-full rounded-pill bg-ink py-3 text-sm font-semibold text-white active:opacity-80 disabled:opacity-40"
      >
        {busy ? 'Saving…' : 'Save'}
      </button>
    </>
  );
}

function WeightEditor({
  valueKg,
  onSave,
  busy,
}: {
  valueKg: number | null;
  onSave: (kg: number) => void;
  busy: boolean;
}) {
  const [unit, setUnitState] = useState<BodyWeightUnit>(getBodyWeightUnit());
  const seededSt = valueKg != null
    ? (() => {
        const lb = valueKg / 0.45359237;
        const s = Math.floor(lb / 14);
        return { s, p: lb - s * 14 };
      })()
    : null;
  const [kgInput, setKgInput] = useState(valueKg != null ? valueKg.toFixed(1) : '');
  const [stInput, setStInput] = useState(seededSt ? String(seededSt.s) : '');
  const [lbInput, setLbInput] = useState(seededSt ? seededSt.p.toFixed(1) : '');

  const draftKg = useMemo(() => {
    if (unit === 'kg') {
      const v = parseFloat(kgInput);
      return !Number.isNaN(v) && v > 0 && v < 700 ? v : null;
    }
    const s = parseFloat(stInput);
    const p = parseFloat(lbInput || '0');
    if (Number.isNaN(s) || s <= 0) return null;
    const kg = stoneLbToKg(s, Number.isNaN(p) ? 0 : p);
    return kg > 0 && kg < 700 ? kg : null;
  }, [unit, kgInput, stInput, lbInput]);

  function changeUnit(next: BodyWeightUnit) {
    setUnitState(next);
    setBodyWeightUnit(next);
  }

  return (
    <>
      <div className="mb-3 flex justify-end">
        <InlinePillToggle
          value={unit}
          options={['kg', 'st'] as const}
          onChange={changeUnit}
        />
      </div>
      {unit === 'kg' ? (
        <div className="flex items-end gap-2">
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            value={kgInput}
            onChange={(e) => setKgInput(e.target.value)}
            placeholder="72.0"
            className="w-full rounded-2xl border border-line bg-paper-card px-4 py-3 text-xl font-bold tracking-tight text-ink focus:border-ink focus:outline-none"
          />
          <div className="pb-2 text-sm font-medium text-muted">kg</div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <input
            type="number"
            inputMode="numeric"
            step="1"
            value={stInput}
            onChange={(e) => setStInput(e.target.value)}
            placeholder="11"
            className="w-full rounded-2xl border border-line bg-paper-card px-4 py-3 text-xl font-bold tracking-tight text-ink focus:border-ink focus:outline-none"
          />
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            value={lbInput}
            onChange={(e) => setLbInput(e.target.value)}
            placeholder="5"
            className="w-full rounded-2xl border border-line bg-paper-card px-4 py-3 text-xl font-bold tracking-tight text-ink focus:border-ink focus:outline-none"
          />
        </div>
      )}
      <button
        onClick={() => draftKg != null && onSave(parseFloat(draftKg.toFixed(2)))}
        disabled={busy || draftKg == null}
        className="mt-3 w-full rounded-pill bg-ink py-3 text-sm font-semibold text-white active:opacity-80 disabled:opacity-40"
      >
        {busy ? 'Saving…' : 'Save'}
      </button>
    </>
  );
}

function HeightEditor({
  valueCm,
  onSave,
  busy,
}: {
  valueCm: number | null;
  onSave: (cm: number) => void;
  busy: boolean;
}) {
  const [unit, setUnitState] = useState<HeightUnit>(getHeightUnit());
  const seededFtIn = valueCm != null ? cmToFtIn(valueCm) : null;
  const [cmInput, setCmInput] = useState(valueCm != null ? Math.round(valueCm).toString() : '');
  const [ftInput, setFtInput] = useState(seededFtIn ? String(seededFtIn.feet) : '');
  const [inInput, setInInput] = useState(
    seededFtIn ? String(Math.round(seededFtIn.inches)) : ''
  );

  const draftCm = useMemo(() => {
    if (unit === 'cm') {
      const v = parseFloat(cmInput);
      return !Number.isNaN(v) && v >= 50 && v <= 260 ? v : null;
    }
    const f = parseFloat(ftInput);
    const i = parseFloat(inInput || '0');
    if (Number.isNaN(f) || f <= 0) return null;
    const cm = ftInToCm(f, Number.isNaN(i) ? 0 : i);
    return cm >= 50 && cm <= 260 ? cm : null;
  }, [unit, cmInput, ftInput, inInput]);

  function changeUnit(next: HeightUnit) {
    setUnitState(next);
    setHeightUnit(next);
  }

  return (
    <>
      <div className="mb-3 flex justify-end">
        <InlinePillToggle
          value={unit}
          options={['cm', 'ftin'] as const}
          labels={{ cm: 'cm', ftin: 'ft·in' }}
          onChange={changeUnit}
        />
      </div>
      {unit === 'cm' ? (
        <div className="flex items-end gap-2">
          <input
            type="number"
            inputMode="numeric"
            step="1"
            value={cmInput}
            onChange={(e) => setCmInput(e.target.value)}
            placeholder="178"
            className="w-full rounded-2xl border border-line bg-paper-card px-4 py-3 text-xl font-bold tracking-tight text-ink focus:border-ink focus:outline-none"
          />
          <div className="pb-2 text-sm font-medium text-muted">cm</div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <input
            type="number"
            inputMode="numeric"
            step="1"
            value={ftInput}
            onChange={(e) => setFtInput(e.target.value)}
            placeholder="5"
            className="w-full rounded-2xl border border-line bg-paper-card px-4 py-3 text-xl font-bold tracking-tight text-ink focus:border-ink focus:outline-none"
          />
          <input
            type="number"
            inputMode="numeric"
            step="1"
            value={inInput}
            onChange={(e) => setInInput(e.target.value)}
            placeholder="10"
            className="w-full rounded-2xl border border-line bg-paper-card px-4 py-3 text-xl font-bold tracking-tight text-ink focus:border-ink focus:outline-none"
          />
        </div>
      )}
      <button
        onClick={() => draftCm != null && onSave(parseFloat(draftCm.toFixed(1)))}
        disabled={busy || draftCm == null}
        className="mt-3 w-full rounded-pill bg-ink py-3 text-sm font-semibold text-white active:opacity-80 disabled:opacity-40"
      >
        {busy ? 'Saving…' : 'Save'}
      </button>
    </>
  );
}

function InlinePillToggle<T extends string>({
  value,
  options,
  onChange,
  labels,
}: {
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  labels?: Partial<Record<T, string>>;
}) {
  return (
    <div className="flex rounded-pill bg-line p-0.5">
      {options.map((u) => (
        <button
          key={u}
          onClick={() => onChange(u)}
          className={`rounded-pill px-3 py-1 text-xs font-semibold uppercase tracking-wider transition-colors ${
            value === u ? 'bg-ink text-white' : 'text-muted'
          }`}
        >
          {labels?.[u] ?? u}
        </button>
      ))}
    </div>
  );
}

function formatGender(g: Gender | null): string {
  if (!g) return 'Not set';
  if (g === 'male') return 'Male';
  if (g === 'female') return 'Female';
  return 'Other';
}

function formatGoals(gs: TopGoal[] | null): string {
  if (!gs || gs.length === 0) return 'Not set';
  return gs.map(goalLabel).join(', ');
}

function goalLabel(g: TopGoal): string {
  if (g === 'build_muscle') return 'Build muscle';
  if (g === 'gain_strength') return 'Gain strength';
  return 'Fat loss';
}

function formatExperience(e: Experience | null): string {
  if (!e) return 'Not set';
  if (e === 'beginner') return 'Beginner';
  if (e === 'intermediate') return 'Intermediate';
  return 'Advanced';
}

function formatDob(iso: string | null): string {
  if (!iso) return 'Not set';
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatWeight(kg: number | null): string {
  if (kg == null) return 'Not set';
  const unit = getBodyWeightUnit();
  return unit === 'kg' ? `${kg.toFixed(1)} kg` : formatStoneLb(kg);
}

function formatHeight(cm: number | null): string {
  if (cm == null) return 'Not set';
  const unit = getHeightUnit();
  return unit === 'cm' ? `${Math.round(cm)} cm` : formatFtIn(cm);
}
