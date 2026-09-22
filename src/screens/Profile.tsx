import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../lib/auth';
import { PageHeader } from '../components/PageHeader';
import { DateOfBirthInput } from '../components/DateOfBirthInput';
import { ConfirmModal } from '../components/ConfirmModal';
import { deleteAccount } from '../lib/accountApi';
import { getActivePlan, getCachedActivePlan, weeksOnPlan, type FullPlan } from '../lib/plansApi';
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
import { cleanDisplayName, MAX_DISPLAY_NAME } from '../lib/displayName';
import {
  getWaterGoal,
  setWaterGoal,
  getWaterUnit,
  setWaterUnit,
  type WaterUnit,
} from '../lib/waterApi';
import { getStepGoal, setStepGoal, formatSteps, MAX_STEPS } from '../lib/stepsApi';
import {
  QUICK_ACTION_META,
  getQuickActions,
  moveQuickAction,
  setQuickActions,
  toggleQuickAction,
  type QuickActionId,
} from '../lib/quickActions';
import {
  getRecentSessionNotes,
  getWeeklyWorkoutSummary,
  hasAnySessionsBefore,
  mondayOfWeek,
  type WeeklyWorkoutSummary,
  type ExerciseWeekBest,
} from '../lib/sessionsApi';
import { kgToLb } from '../lib/units';

interface Props {
  onUploadPlan: () => void;
  onOpenHistory?: () => void;
  onOpenPlans?: () => void;
  onOpenMachines?: () => void;
  profile?: Profile | null;
  onProfileChange?: (p: Profile) => void;
  onResumeOnboarding?: () => void;
}

export function Profile({
  onUploadPlan,
  onOpenHistory,
  onOpenPlans,
  onOpenMachines,
  profile,
  onProfileChange,
  onResumeOnboarding,
}: Props) {
  const { session, signOut } = useAuth();

  /**
   * There's no undo behind this, so the dialog closes first and the row shows
   * "Deleting…" — the one thing worse than a slow delete is a dialog that
   * looks ignored and invites a second tap.
   */
  async function handleDeleteAccount() {
    setConfirmDelete(false);
    setDeleteError(null);
    setDeleting(true);
    try {
      await deleteAccount();
      // Signing out unmounts this screen; nothing below this line runs.
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Could not delete your account.');
      setDeleting(false);
    }
  }
  // Seeded from the copy already on the device, so returning to this tab paints
  // the real card on the first frame rather than a placeholder that swaps a
  // moment later. The fetch behind it only ever corrects what's already there.
  const cachedPlan = useMemo(() => getCachedActivePlan(), []);
  const [plan, setPlan] = useState<FullPlan | null>(cachedPlan);
  const [planKnown, setPlanKnown] = useState(cachedPlan != null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [bwUnit, setBwUnitState] = useState<BodyWeightUnit>(getBodyWeightUnit());
  const [lwUnit, setLwUnitState] = useState<LiftWeightUnit>(getLiftWeightUnit());
  const [waterGoal, setWaterGoalState] = useState<number>(getWaterGoal());
  const [waterUnit, setWaterUnitState] = useState<WaterUnit>(getWaterUnit());
  const [stepGoal, setStepGoalState] = useState<number>(getStepGoal());
  // The goal field is typed into digit by digit, so it keeps its own text: a
  // controlled numeric value can't be cleared to retype a four-figure number.
  const [stepGoalText, setStepGoalText] = useState<string>(() => String(getStepGoal()));
  const [quickActions, setQuickActionsState] = useState<QuickActionId[]>(() =>
    getQuickActions()
  );

  function changeQuickActions(next: QuickActionId[]) {
    setQuickActionsState(next);
    setQuickActions(next);
  }

  // The settings list reads in the same order as the row itself — shown tiles
  // in their row order, switched-off ones collected underneath.
  const orderedQuickActions = [
    ...quickActions
      .map((id) => QUICK_ACTION_META.find((m) => m.id === id))
      .filter((m): m is (typeof QUICK_ACTION_META)[number] => m != null),
    ...QUICK_ACTION_META.filter((m) => !quickActions.includes(m.id)),
  ];

  useEffect(() => {
    getActivePlan()
      .then(setPlan)
      .catch(() => {})
      // Either way we now know whether there's a plan, which is what lets the
      // card say "No plan loaded." without it being a guess.
      .finally(() => setPlanKnown(true));
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
    <div className="pb-nav min-h-screen bg-paper">
      <div
        className="mx-auto max-w-md px-5"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 40px)' }}
      >
        <PageHeader title="Profile" />

        <p className="mt-3 break-all text-sm text-muted">
          {session?.user.email}
        </p>

        <Section title="Active plan">
          <div className="rounded-card bg-paper-card p-5 shadow-card">
            {/* Loaded, empty and still-loading all stand the same height, so
                nothing below this card moves when the answer arrives. */}
            <div className="min-h-[70px]">
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
            ) : planKnown ? (
              // The empty state has to stand as tall as a loaded plan — three
              // lines — or the card changes height the moment the answer
              // arrives. "No plan loaded." on its own left most of that as a
              // hole above the button, and said nothing about what to do; this
              // fills the same space with the answer to "what now?".
              <>
                <div className="text-base font-semibold text-ink">No plan yet</div>
                <div className="mt-0.5 text-sm text-muted">
                  Upload the PDF your trainer gave you and Reps turns it into your training
                  days.
                </div>
              </>
            ) : (
              <div className="animate-pulse" aria-hidden>
                <div className="h-3 w-14 rounded bg-line" />
                <div className="mt-2 h-5 w-44 rounded bg-line" />
                <div className="mt-2 h-4 w-52 rounded bg-line" />
              </div>
            )}
            </div>
            {/* Until we know whether there's a plan, this button doesn't know
                where it goes — tapping it early used to open the upload flow
                for someone who already had one. */}
            <button
              onClick={plan && onOpenPlans ? onOpenPlans : onUploadPlan}
              disabled={!planKnown}
              className="pressable mt-4 w-full rounded-pill bg-ink py-3 text-sm font-semibold text-white active:opacity-80 disabled:opacity-40"
            >
              {!planKnown ? 'Loading\u2026' : plan ? 'Switch or manage plans' : 'Upload plan'}
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
                  className="w-14 rounded-control border border-line bg-paper px-2 py-1 text-center text-sm font-semibold text-ink focus:border-ink focus:outline-none"
                />
                <select
                  value={waterUnit}
                  onChange={(e) => {
                    const u = e.target.value as WaterUnit;
                    setWaterUnitState(u);
                    setWaterUnit(u);
                  }}
                  className="rounded-control border border-line bg-paper py-1 pl-3 pr-7 text-sm font-semibold text-ink focus:border-ink focus:outline-none"
                >
                  <option value="bottles">bottles</option>
                  <option value="glasses">glasses</option>
                  <option value="cups">cups</option>
                  <option value="L">litres</option>
                </select>
              </div>
            </div>
            <div className="border-t border-line" />
            <div className="flex items-center justify-between px-5 py-4">
              <div>
                <div className="text-sm font-semibold text-ink">Daily step goal</div>
                <div className="mt-0.5 text-xs text-muted">
                  Currently {formatSteps(stepGoal)} a day
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_STEPS}
                  step={500}
                  value={stepGoalText}
                  onChange={(e) => {
                    setStepGoalText(e.target.value);
                    const n = parseInt(e.target.value, 10);
                    if (!Number.isNaN(n) && n > 0 && n <= MAX_STEPS) {
                      setStepGoalState(n);
                      setStepGoal(n);
                    }
                  }}
                  onBlur={() => setStepGoalText(String(stepGoal))}
                  className="w-20 rounded-control border border-line bg-paper px-2 py-1 text-center text-sm font-semibold text-ink focus:border-ink focus:outline-none"
                />
                <span className="text-sm text-muted">steps</span>
              </div>
            </div>
          </div>
        </Section>

        <Section title="Home quick actions">
          <div className="overflow-hidden rounded-card bg-paper-card shadow-card">
            <p className="px-5 pt-4 text-xs text-muted">
              Which tiles sit under Quick actions on Home, and in what order. The
              row scrolls sideways, so whatever is at the top here is what you see
              without scrolling.
            </p>
            <div className="mt-3">
              {orderedQuickActions.map((meta, i) => {
                const on = quickActions.includes(meta.id);
                const pos = quickActions.indexOf(meta.id);
                return (
                  <div key={meta.id}>
                    {i > 0 && <div className="border-t border-line" />}
                    <div className="flex items-center justify-between gap-3 px-5 py-3.5">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-ink">
                          {on ? `${pos + 1}. ${meta.label}` : meta.label}
                        </div>
                        <div className="mt-0.5 text-xs text-muted">{meta.hint}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {on && (
                          <>
                            <MoveButton
                              label={`Move ${meta.label} earlier`}
                              disabled={pos === 0}
                              onClick={() =>
                                changeQuickActions(moveQuickAction(quickActions, meta.id, -1))
                              }
                            />
                            <MoveButton
                              down
                              label={`Move ${meta.label} later`}
                              disabled={pos === quickActions.length - 1}
                              onClick={() =>
                                changeQuickActions(moveQuickAction(quickActions, meta.id, 1))
                              }
                            />
                          </>
                        )}
                        <Toggle
                          on={on}
                          // The last tile standing can't be switched off — an
                          // empty row would leave Home with nothing to tap.
                          disabled={on && quickActions.length <= 1}
                          label={`Show ${meta.label} on Home`}
                          onChange={() =>
                            changeQuickActions(toggleQuickAction(quickActions, meta.id))
                          }
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Section>

        <Section title="Activity">
          <div className="overflow-hidden rounded-card bg-paper-card shadow-card">
            <button
              onClick={onOpenHistory}
              className="flex w-full items-center justify-between py-4 pl-5 pr-6 text-left active:bg-pressed"
            >
              <div className="text-sm font-semibold text-ink">Workout history</div>
              <ChevronRight />
            </button>
            <div className="border-t border-line" />
            <button
              onClick={onOpenMachines}
              className="flex w-full items-center justify-between py-4 pl-5 pr-6 text-left active:bg-pressed"
            >
              <div>
                <div className="text-sm font-semibold text-ink">Manage machines</div>
                <div className="mt-0.5 text-xs text-muted">
                  Rename, delete, merge, change units
                </div>
              </div>
              <ChevronRight />
            </button>
            <div className="border-t border-line" />
            <CoachExportRow />
            <div className="border-t border-line" />
            <CoachWeeklySummaryRow />
          </div>
        </Section>

        <Section title="Account">
          <div className="overflow-hidden rounded-card bg-paper-card shadow-card">
            <button
              onClick={signOut}
              className="w-full px-5 py-4 text-left text-sm font-semibold text-danger-strong active:bg-danger-soft"
            >
              Sign out
            </button>
            <div className="border-t border-line" />
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={deleting}
              className="w-full px-5 py-4 text-left text-sm font-semibold text-danger-strong active:bg-danger-soft disabled:opacity-50"
            >
              {deleting ? 'Deleting…' : 'Delete account'}
            </button>
          </div>
          {deleteError && (
            <p className="mt-2 px-1 text-sm text-danger">{deleteError}</p>
          )}
        </Section>
      </div>

      {confirmDelete && (
        <ConfirmModal
          title="Delete your account?"
          message="Are you sure you want to do this? By doing this, all information will be removed. You will not be able to recover it."
          confirmLabel="Delete everything"
          cancelLabel="Keep my account"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={handleDeleteAccount}
        />
      )}
    </div>
  );
}

/** iOS-style switch, for settings that are simply on or off. */
function Toggle({
  on,
  disabled,
  label,
  onChange,
}: {
  on: boolean;
  disabled?: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative h-6 w-10 shrink-0 rounded-pill transition-colors disabled:opacity-40 ${
        on ? 'bg-ink' : 'bg-line'
      }`}
    >
      <span
        className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-card"
        style={{
          left: on ? '18px' : '2px',
          transition: 'left 180ms cubic-bezier(.22,.85,.36,1)',
        }}
      />
    </button>
  );
}

function MoveButton({
  down = false,
  disabled,
  label,
  onClick,
}: {
  down?: boolean;
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="pressable flex h-7 w-7 items-center justify-center rounded-full bg-paper text-ink active:bg-line disabled:opacity-25"
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        style={{ transform: down ? 'rotate(180deg)' : undefined }}
      >
        <path
          d="M3 7.5L6 4.5l3 3"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
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
      className="flex w-full items-center justify-between px-5 py-4 text-left active:bg-pressed"
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
      className="flex w-full items-center justify-between px-5 py-4 text-left active:bg-pressed"
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
  // Keeps a single decimal so micro-loading (e.g. +2.5 kg on bench) isn't
  // rounded away — important for hard-to-progress lifts.
  const fmtW = (kg: number) => {
    const v = unit === 'lb' ? kgToLb(kg) : kg;
    const r = Math.round(v * 10) / 10;
    return `${Number.isInteger(r) ? String(r) : r.toFixed(1)} ${unit}`;
  };
  const setStr = (e: { topWeightKg: number; topReps: number }) =>
    `${fmtW(e.topWeightKg)} × ${e.topReps}`;
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
  out.push(`# Weekly progress`);
  out.push(`Week of ${dateLong(current.weekStart)} – ${dateLong(lastDay)}`);
  out.push('');

  if (current.sessions.length > 0) {
    const list = current.sessions
      .map((s) => `${s.trainingDayName} (${dayAndDate(s.completedAt)})`)
      .join(', ');
    out.push(
      `${current.workoutsDone} workout${current.workoutsDone === 1 ? '' : 's'}: ${list}`
    );
    out.push('');
  }

  // First week: no comparison yet — give the coach a baseline of best sets.
  if (!previous) {
    out.push(`First week of data — no comparison yet. Best set per exercise:`);
    out.push('');
    for (const e of current.exerciseBests.slice(0, 8)) {
      out.push(`- **${e.displayName}** — ${setStr(e)}`);
    }
    return out.join('\n').trimEnd() + '\n';
  }

  // Rank repeated lifts by % gain in estimated 1RM so a small, hard-won PR on a
  // heavy/stubborn lift (e.g. bench) can outrank a big jump on an easier one.
  const prevByName = new Map(previous.exerciseBests.map((e) => [e.normalizedName, e]));
  const wins: { cur: ExerciseWeekBest; prev: ExerciseWeekBest; pct: number }[] = [];
  for (const cur of current.exerciseBests) {
    const prev = prevByName.get(cur.normalizedName);
    if (!prev || cur.bestE1RMkg <= prev.bestE1RMkg) continue;
    wins.push({ cur, prev, pct: ((cur.bestE1RMkg - prev.bestE1RMkg) / prev.bestE1RMkg) * 100 });
  }
  wins.sort((a, b) => b.pct - a.pct);

  out.push(`## Biggest improvements vs last week`);
  if (wins.length === 0) {
    out.push(`No measured gains on repeated lifts this week — held steady or building back.`);
  } else {
    for (const w of wins.slice(0, 5)) {
      out.push(formatWin(w.cur, w.prev, w.pct, fmtW, setStr));
    }
  }
  return out.join('\n').trimEnd() + '\n';
}

/** One bullet describing an exercise's week-over-week win, e.g.
 *  "- **Deadlift** — 100 kg × 5 → 105 kg × 5  (+5 kg · est. 1RM +3%)". */
function formatWin(
  cur: ExerciseWeekBest,
  prev: ExerciseWeekBest,
  pct: number,
  fmtW: (kg: number) => string,
  setStr: (e: { topWeightKg: number; topReps: number }) => string
): string {
  const parts: string[] = [];
  const dW = cur.topWeightKg - prev.topWeightKg;
  const dR = cur.topReps - prev.topReps;
  if (Math.abs(dW) >= 0.05) parts.push(`${dW > 0 ? '+' : '−'}${fmtW(Math.abs(dW))}`);
  if (dR !== 0) parts.push(`${dR > 0 ? '+' : '−'}${Math.abs(dR)} rep${Math.abs(dR) === 1 ? '' : 's'}`);
  parts.push(`est. 1RM +${pct < 0.5 ? '<1' : Math.round(pct)}%`);
  return `- **${cur.displayName}** — ${setStr(prev)} → ${setStr(cur)}  (${parts.join(' · ')})`;
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

type EditField = 'name' | 'gender' | 'dob' | 'weight' | 'height' | 'goal' | 'experience';

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
          label="Name"
          incomplete={showDots && !profile.display_name}
          editing={editing === 'name'}
          onEdit={() => setEditing('name')}
          onCancel={() => setEditing(null)}
          value={profile.display_name ?? 'Not set'}
          hint="How the app greets you."
        >
          <NameEditor
            value={profile.display_name}
            onSave={(v) => save({ display_name: v })}
            busy={busy}
          />
        </DetailRow>

        <Divider />

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
      className="flex w-full items-center justify-between py-4 pl-5 pr-6 text-left active:bg-pressed"
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
            // Border plus inset ring, not a 2px border: the ring is painted
            // inside the box, so selecting a row doesn't make it taller and
            // shove the rows below it down.
            className={`flex w-full items-center justify-between rounded-panel border bg-paper-card px-4 py-3 text-left text-sm font-semibold text-ink transition-colors ${
              draft === opt.value ? 'border-ink ring-1 ring-inset ring-ink' : 'border-line'
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
        className="pressable mt-3 w-full rounded-pill bg-ink py-3 text-sm font-semibold text-white active:opacity-80 disabled:opacity-40"
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
              // Same as above: an inset ring costs no layout.
              className={`flex w-full items-center justify-between rounded-panel border bg-paper-card px-4 py-3 text-left text-sm font-semibold text-ink transition-colors ${
                selected ? 'border-ink ring-1 ring-inset ring-ink' : 'border-line'
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
        className="pressable mt-3 w-full rounded-pill bg-ink py-3 text-sm font-semibold text-white active:opacity-80 disabled:opacity-40"
      >
        {busy ? 'Saving…' : 'Save'}
      </button>
    </>
  );
}

function NameEditor({
  value,
  onSave,
  busy,
}: {
  value: string | null;
  onSave: (v: string | null) => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState(value ?? '');
  const cleaned = cleanDisplayName(draft);
  return (
    <>
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !busy && cleaned !== value) onSave(cleaned);
        }}
        maxLength={MAX_DISPLAY_NAME}
        autoComplete="given-name"
        autoCapitalize="words"
        placeholder="Alex"
        className="w-full rounded-panel border border-line bg-paper-card px-4 py-3 text-base font-semibold text-ink placeholder:font-normal placeholder:text-muted/60 focus:border-ink focus:outline-none"
      />
      <button
        onClick={() => onSave(cleaned)}
        disabled={busy || cleaned === value}
        className="pressable mt-3 w-full rounded-pill bg-ink py-3 text-sm font-semibold text-white active:opacity-80 disabled:opacity-40"
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
  return (
    <>
      <DateOfBirthInput value={value} onChange={setDraft} compact />
      <button
        onClick={() => draft && onSave(draft)}
        disabled={busy || !draft || draft === value}
        className="pressable mt-3 w-full rounded-pill bg-ink py-3 text-sm font-semibold text-white active:opacity-80 disabled:opacity-40"
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
            className="w-full rounded-panel border border-line bg-paper-card px-4 py-3 text-xl font-bold tracking-tight text-ink focus:border-ink focus:outline-none"
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
            className="w-full rounded-panel border border-line bg-paper-card px-4 py-3 text-xl font-bold tracking-tight text-ink focus:border-ink focus:outline-none"
          />
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            value={lbInput}
            onChange={(e) => setLbInput(e.target.value)}
            placeholder="5"
            className="w-full rounded-panel border border-line bg-paper-card px-4 py-3 text-xl font-bold tracking-tight text-ink focus:border-ink focus:outline-none"
          />
        </div>
      )}
      <button
        onClick={() => draftKg != null && onSave(parseFloat(draftKg.toFixed(2)))}
        disabled={busy || draftKg == null}
        className="pressable mt-3 w-full rounded-pill bg-ink py-3 text-sm font-semibold text-white active:opacity-80 disabled:opacity-40"
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
            className="w-full rounded-panel border border-line bg-paper-card px-4 py-3 text-xl font-bold tracking-tight text-ink focus:border-ink focus:outline-none"
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
            className="w-full rounded-panel border border-line bg-paper-card px-4 py-3 text-xl font-bold tracking-tight text-ink focus:border-ink focus:outline-none"
          />
          <input
            type="number"
            inputMode="numeric"
            step="1"
            value={inInput}
            onChange={(e) => setInInput(e.target.value)}
            placeholder="10"
            className="w-full rounded-panel border border-line bg-paper-card px-4 py-3 text-xl font-bold tracking-tight text-ink focus:border-ink focus:outline-none"
          />
        </div>
      )}
      <button
        onClick={() => draftCm != null && onSave(parseFloat(draftCm.toFixed(1)))}
        disabled={busy || draftCm == null}
        className="pressable mt-3 w-full rounded-pill bg-ink py-3 text-sm font-semibold text-white active:opacity-80 disabled:opacity-40"
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
