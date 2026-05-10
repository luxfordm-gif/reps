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

interface Props {
  onUploadPlan: () => void;
  onTabChange?: (tab: Tab) => void;
}

export function Profile({ onUploadPlan, onTabChange }: Props) {
  const { session, signOut } = useAuth();
  const [plan, setPlan] = useState<FullPlan | null>(null);
  const [bwUnit, setBwUnitState] = useState<BodyWeightUnit>(getBodyWeightUnit());
  const [lwUnit, setLwUnitState] = useState<LiftWeightUnit>(getLiftWeightUnit());

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
      <div className="mx-auto max-w-md px-5 pt-12">
        <PageHeader title="Profile" />

        <div className="mt-6">
          <h1 className="text-[28px] font-bold leading-[1.1] tracking-tight text-ink">
            Account
          </h1>
          <p className="mt-1.5 break-all text-base text-muted">
            {session?.user.email}
          </p>
        </div>

        <Section title="Active Plan">
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
