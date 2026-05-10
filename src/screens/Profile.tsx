import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { PageHeader } from '../components/PageHeader';
import { BottomNav, type Tab } from '../components/BottomNav';
import { getActivePlan, type FullPlan } from '../lib/plansApi';
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

interface Props {
  onUploadPlan: () => void;
  onTabChange?: (tab: Tab) => void;
  onOpenHistory?: () => void;
}

export function Profile({ onUploadPlan, onTabChange, onOpenHistory }: Props) {
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
      <div className="mx-auto max-w-md px-5 pt-3">
        <PageHeader title="Profile" />

        <div className="mt-6">
          <h1 className="text-[28px] font-bold leading-[1.1] tracking-tight text-ink">
            Account
          </h1>
          <p className="mt-1.5 break-all text-base text-muted">
            {session?.user.email}
          </p>
        </div>

        <Section title="Active plan">
          <div className="rounded-card bg-paper-card p-5 shadow-card">
            {plan ? (
              <>
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                  Currently active
                </div>
                <div className="mt-1 text-xl font-bold tracking-tight text-ink">
                  {plan.name}
                </div>
                <div className="mt-0.5 text-sm text-muted">
                  Uploaded{' '}
                  {new Date(plan.uploaded_at).toLocaleDateString('en-GB', {
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
              onClick={onUploadPlan}
              className="mt-4 w-full rounded-pill bg-ink py-3 text-sm font-semibold text-white active:opacity-80"
            >
              {plan ? 'Upload new plan' : 'Upload plan'}
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
                  className="rounded-xl border border-line bg-paper px-2 py-1 text-sm font-semibold text-ink focus:border-ink focus:outline-none"
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
          <button
            onClick={onOpenHistory}
            className="flex w-full items-center justify-between rounded-card bg-paper-card px-5 py-4 text-left shadow-card active:bg-line/40"
          >
            <div className="text-sm font-semibold text-ink">Workout history</div>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path
                d="M7 4l5 5-5 5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
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

      <BottomNav active="profile" onChange={onTabChange} />
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
