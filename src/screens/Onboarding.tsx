import { useMemo, useState } from 'react';
import {
  type Profile,
  type ProfilePatch,
  type Gender,
  type TopGoal,
  type Experience,
  upsertProfile,
  markOnboardingComplete,
} from '../lib/profileApi';
import { logBodyWeight } from '../lib/bodyWeightApi';
import {
  getBodyWeightUnit,
  setBodyWeightUnit,
  stoneLbToKg,
  formatStoneLb,
  getHeightUnit,
  setHeightUnit,
  cmToFtIn,
  ftInToCm,
  type BodyWeightUnit,
  type HeightUnit,
} from '../lib/units';

interface Props {
  initial: Profile | null;
  onClose: (completed: boolean) => void;
}

type Step = 'gender' | 'birthday' | 'weight' | 'height' | 'goal' | 'experience' | 'ready';
const ORDER: Step[] = ['gender', 'birthday', 'weight', 'height', 'goal', 'experience', 'ready'];

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function minDOBISO(): string {
  const d = new Date();
  return `${d.getFullYear() - 100}-01-01`;
}

function maxDOBISO(): string {
  // 13 years ago, matching the typical app-store minimum age.
  const d = new Date();
  d.setFullYear(d.getFullYear() - 13);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function Onboarding({ initial, onClose }: Props) {
  const [step, setStep] = useState<Step>('gender');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Local form state, seeded from the profile so resume works.
  const [gender, setGender] = useState<Gender | null>(initial?.gender ?? null);
  const [dob, setDob] = useState<string>(initial?.date_of_birth ?? '');
  const [weightKg, setWeightKg] = useState<number | null>(initial?.starting_weight_kg ?? null);
  const [heightCm, setHeightCm] = useState<number | null>(initial?.height_cm ?? null);
  const [goal, setGoal] = useState<TopGoal | null>(initial?.top_goal ?? null);
  const [experience, setExperience] = useState<Experience | null>(initial?.experience_level ?? null);

  const stepIdx = ORDER.indexOf(step);
  const isLast = step === 'ready';

  function patchForStep(s: Step): ProfilePatch {
    switch (s) {
      case 'gender':
        return { gender };
      case 'birthday':
        return { date_of_birth: dob || null };
      case 'weight':
        return { starting_weight_kg: weightKg };
      case 'height':
        return { height_cm: heightCm };
      case 'goal':
        return { top_goal: goal };
      case 'experience':
        return { experience_level: experience };
      case 'ready':
        return {};
    }
  }

  function fullPatch(): ProfilePatch {
    return {
      gender,
      date_of_birth: dob || null,
      starting_weight_kg: weightKg,
      height_cm: heightCm,
      top_goal: goal,
      experience_level: experience,
    };
  }

  async function persistInitialWeightAsWeighIn() {
    if (weightKg == null) return;
    try {
      await logBodyWeight(parseFloat(weightKg.toFixed(2)), todayISO());
    } catch {
      // Best-effort: don't block onboarding completion on the weigh-in write.
    }
  }

  async function handleContinue() {
    setError(null);
    setBusy(true);
    try {
      const patch = patchForStep(step);
      if (Object.keys(patch).length > 0) {
        await upsertProfile(patch);
      }
      const next = ORDER[stepIdx + 1];
      if (next) setStep(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  async function handleFinish() {
    setError(null);
    setBusy(true);
    try {
      await upsertProfile(fullPatch());
      await persistInitialWeightAsWeighIn();
      await markOnboardingComplete();
      onClose(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  async function handleSkip() {
    setError(null);
    setBusy(true);
    try {
      // Persist whatever the user has filled so far, but don't mark complete.
      await upsertProfile(fullPatch());
    } catch {
      // Even if save fails, let them out — they can finish later.
    } finally {
      setBusy(false);
      onClose(false);
    }
  }

  function handleBack() {
    setError(null);
    const prev = ORDER[stepIdx - 1];
    if (prev) setStep(prev);
  }

  return (
    <div className="min-h-screen bg-paper">
      <StepShell
        onBack={stepIdx > 0 ? handleBack : undefined}
        onSkip={!isLast ? handleSkip : undefined}
        progress={(stepIdx + 1) / ORDER.length}
      >
        {step === 'gender' && (
          <StepGender
            value={gender}
            onChange={setGender}
            onContinue={handleContinue}
            canContinue={gender != null}
            busy={busy}
            error={error}
          />
        )}
        {step === 'birthday' && (
          <StepBirthday
            value={dob}
            onChange={setDob}
            onContinue={handleContinue}
            canContinue={!!dob}
            busy={busy}
            error={error}
          />
        )}
        {step === 'weight' && (
          <StepWeight
            valueKg={weightKg}
            onChange={setWeightKg}
            onContinue={handleContinue}
            busy={busy}
            error={error}
          />
        )}
        {step === 'height' && (
          <StepHeight
            valueCm={heightCm}
            onChange={setHeightCm}
            onContinue={handleContinue}
            busy={busy}
            error={error}
          />
        )}
        {step === 'goal' && (
          <StepGoal
            value={goal}
            onChange={setGoal}
            onContinue={handleContinue}
            canContinue={goal != null}
            busy={busy}
            error={error}
          />
        )}
        {step === 'experience' && (
          <StepExperience
            value={experience}
            onChange={setExperience}
            onContinue={handleContinue}
            canContinue={experience != null}
            busy={busy}
            error={error}
          />
        )}
        {step === 'ready' && (
          <StepReady busy={busy} error={error} onFinish={handleFinish} onSkip={handleSkip} />
        )}
      </StepShell>
    </div>
  );
}

// ---------- Chrome ----------

function StepShell({
  onBack,
  onSkip,
  progress,
  children,
}: {
  onBack?: () => void;
  onSkip?: () => void;
  progress: number;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col px-5">
      <div
        className="flex h-11 items-center justify-between"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        {onBack ? (
          <button
            onClick={onBack}
            className="-ml-2 flex h-11 w-11 items-center justify-center rounded-full text-ink active:bg-line/60"
            aria-label="Back"
          >
            <BackIcon />
          </button>
        ) : (
          <div className="h-11 w-11" />
        )}
        {onSkip ? (
          <button
            onClick={onSkip}
            className="px-2 py-1 text-sm font-semibold text-muted active:text-ink"
          >
            Skip
          </button>
        ) : (
          <div className="h-11 w-11" />
        )}
      </div>
      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full bg-ink transition-all duration-300"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
      <div className="flex flex-1 flex-col pb-8 pt-6">{children}</div>
    </div>
  );
}

function StepHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <>
      <h1 className="text-[32px] font-bold leading-tight tracking-tight text-ink">{title}</h1>
      {subtitle && <p className="mt-1.5 text-base text-muted">{subtitle}</p>}
    </>
  );
}

function ContinueFooter({
  onContinue,
  canContinue,
  busy,
  error,
  label = 'Continue',
}: {
  onContinue: () => void;
  canContinue: boolean;
  busy: boolean;
  error: string | null;
  label?: string;
}) {
  return (
    <div className="mt-auto pt-6">
      {error && (
        <div className="mb-3 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      <p className="mb-3 text-center text-xs text-muted">Your data is private and secure.</p>
      <button
        onClick={onContinue}
        disabled={!canContinue || busy}
        className="w-full rounded-pill bg-ink py-4 text-base font-semibold text-white transition-opacity active:opacity-80 disabled:opacity-40"
      >
        {busy ? 'Please wait…' : label}
      </button>
    </div>
  );
}

// ---------- Step: Gender ----------

function StepGender({
  value,
  onChange,
  onContinue,
  canContinue,
  busy,
  error,
}: {
  value: Gender | null;
  onChange: (g: Gender) => void;
  onContinue: () => void;
  canContinue: boolean;
  busy: boolean;
  error: string | null;
}) {
  const options: { value: Gender; label: string; icon: React.ReactNode }[] = [
    { value: 'male', label: 'Male', icon: <MaleIcon /> },
    { value: 'female', label: 'Female', icon: <FemaleIcon /> },
    { value: 'other', label: 'Other', icon: <OtherIcon /> },
  ];
  return (
    <>
      <StepHeading title="What is your gender?" />
      <div className="mt-8 space-y-3">
        {options.map((opt) => (
          <TileOption
            key={opt.value}
            selected={value === opt.value}
            onClick={() => onChange(opt.value)}
            icon={opt.icon}
            label={opt.label}
          />
        ))}
      </div>
      <ContinueFooter
        onContinue={onContinue}
        canContinue={canContinue}
        busy={busy}
        error={error}
      />
    </>
  );
}

// ---------- Step: Birthday ----------

function StepBirthday({
  value,
  onChange,
  onContinue,
  canContinue,
  busy,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  onContinue: () => void;
  canContinue: boolean;
  busy: boolean;
  error: string | null;
}) {
  return (
    <>
      <StepHeading title="When is your birthday?" subtitle="We use this to tune your plan." />
      <div className="mt-8 rounded-card bg-paper-card p-5 shadow-card">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-muted">
            Date of birth
          </span>
          <input
            type="date"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            min={minDOBISO()}
            max={maxDOBISO()}
            className="w-full rounded-2xl border border-line bg-paper-card px-4 py-3.5 text-xl font-semibold tracking-tight text-ink focus:border-ink focus:outline-none"
          />
        </label>
      </div>
      <ContinueFooter
        onContinue={onContinue}
        canContinue={canContinue}
        busy={busy}
        error={error}
      />
    </>
  );
}

// ---------- Step: Weight ----------

function StepWeight({
  valueKg,
  onChange,
  onContinue,
  busy,
  error,
}: {
  valueKg: number | null;
  onChange: (kg: number | null) => void;
  onContinue: () => void;
  busy: boolean;
  error: string | null;
}) {
  const [unit, setUnitState] = useState<BodyWeightUnit>(getBodyWeightUnit());
  // Mirror the BodyWeight screen: store typed inputs as strings so we don't
  // clobber a user mid-keystroke (e.g. typing "72." would round to 72).
  const seededKg = valueKg ?? null;
  const seededSt = seededKg != null ? (() => {
    const lb = (seededKg / 0.45359237);
    const s = Math.floor(lb / 14);
    return { s, p: lb - s * 14 };
  })() : null;
  const [kgInput, setKgInput] = useState(seededKg != null ? seededKg.toFixed(1) : '');
  const [stInput, setStInput] = useState(seededSt ? String(seededSt.s) : '');
  const [lbInput, setLbInput] = useState(seededSt ? seededSt.p.toFixed(1) : '');

  const inputKg = useMemo(() => {
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
      <StepHeading title="What is your weight?" />
      <div className="mt-8 rounded-card bg-paper-card p-5 shadow-card">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
            Your weight
          </div>
          <PillToggle
            value={unit}
            options={['kg', 'st'] as const}
            onChange={changeUnit}
          />
        </div>
        {unit === 'kg' ? (
          <div className="mt-4 flex items-end gap-3">
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              value={kgInput}
              onChange={(e) => setKgInput(e.target.value)}
              placeholder="e.g. 72.0"
              className="w-full rounded-2xl border border-line bg-paper-card px-4 py-3.5 text-2xl font-bold tracking-tight text-ink focus:border-ink focus:outline-none"
            />
            <div className="pb-3 text-base font-medium text-muted">kg</div>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3">
            <NumberCell
              value={stInput}
              onChange={setStInput}
              placeholder="11"
              caption="Stones"
              step="1"
              inputMode="numeric"
            />
            <NumberCell
              value={lbInput}
              onChange={setLbInput}
              placeholder="5"
              caption="Pounds"
              step="0.1"
              inputMode="decimal"
            />
          </div>
        )}
        {inputKg != null && (
          <div className="mt-3 text-xs text-muted">
            ≈ {unit === 'kg' ? formatStoneLb(inputKg) : `${inputKg.toFixed(1)} kg`}
          </div>
        )}
      </div>
      <ContinueFooter
        onContinue={() => {
          onChange(inputKg);
          onContinue();
        }}
        canContinue={inputKg != null}
        busy={busy}
        error={error}
      />
    </>
  );
}

// ---------- Step: Height ----------

function StepHeight({
  valueCm,
  onChange,
  onContinue,
  busy,
  error,
}: {
  valueCm: number | null;
  onChange: (cm: number | null) => void;
  onContinue: () => void;
  busy: boolean;
  error: string | null;
}) {
  const [unit, setUnitState] = useState<HeightUnit>(getHeightUnit());
  const seededFtIn = valueCm != null ? cmToFtIn(valueCm) : null;
  const [cmInput, setCmInput] = useState(valueCm != null ? Math.round(valueCm).toString() : '');
  const [ftInput, setFtInput] = useState(seededFtIn ? String(seededFtIn.feet) : '');
  const [inInput, setInInput] = useState(
    seededFtIn ? String(Math.round(seededFtIn.inches)) : ''
  );

  const inputCm = useMemo(() => {
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
      <StepHeading title="What is your height?" />
      <div className="mt-8 rounded-card bg-paper-card p-5 shadow-card">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
            Your height
          </div>
          <PillToggle
            value={unit}
            options={['cm', 'ftin'] as const}
            labels={{ cm: 'cm', ftin: 'ft·in' }}
            onChange={changeUnit}
          />
        </div>
        {unit === 'cm' ? (
          <div className="mt-4 flex items-end gap-3">
            <input
              type="number"
              inputMode="numeric"
              step="1"
              value={cmInput}
              onChange={(e) => setCmInput(e.target.value)}
              placeholder="e.g. 178"
              className="w-full rounded-2xl border border-line bg-paper-card px-4 py-3.5 text-2xl font-bold tracking-tight text-ink focus:border-ink focus:outline-none"
            />
            <div className="pb-3 text-base font-medium text-muted">cm</div>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3">
            <NumberCell
              value={ftInput}
              onChange={setFtInput}
              placeholder="5"
              caption="Feet"
              step="1"
              inputMode="numeric"
            />
            <NumberCell
              value={inInput}
              onChange={setInInput}
              placeholder="10"
              caption="Inches"
              step="1"
              inputMode="numeric"
            />
          </div>
        )}
      </div>
      <ContinueFooter
        onContinue={() => {
          onChange(inputCm);
          onContinue();
        }}
        canContinue={inputCm != null}
        busy={busy}
        error={error}
      />
    </>
  );
}

// ---------- Step: Goal ----------

function StepGoal({
  value,
  onChange,
  onContinue,
  canContinue,
  busy,
  error,
}: {
  value: TopGoal | null;
  onChange: (g: TopGoal) => void;
  onContinue: () => void;
  canContinue: boolean;
  busy: boolean;
  error: string | null;
}) {
  const options: { value: TopGoal; label: string; icon: React.ReactNode }[] = [
    { value: 'build_muscle', label: 'Build Muscle', icon: <MuscleIcon /> },
    { value: 'gain_strength', label: 'Gain Strength', icon: <StrengthIcon /> },
    { value: 'fat_loss', label: 'Fat Loss', icon: <ScaleIcon /> },
  ];
  return (
    <>
      <StepHeading title="What is your top goal?" />
      <div className="mt-8 space-y-3">
        {options.map((opt) => (
          <TileOption
            key={opt.value}
            selected={value === opt.value}
            onClick={() => onChange(opt.value)}
            icon={opt.icon}
            label={opt.label}
          />
        ))}
      </div>
      <ContinueFooter
        onContinue={onContinue}
        canContinue={canContinue}
        busy={busy}
        error={error}
      />
    </>
  );
}

// ---------- Step: Experience ----------

function StepExperience({
  value,
  onChange,
  onContinue,
  canContinue,
  busy,
  error,
}: {
  value: Experience | null;
  onChange: (e: Experience) => void;
  onContinue: () => void;
  canContinue: boolean;
  busy: boolean;
  error: string | null;
}) {
  const options: { value: Experience; title: string; hint: string }[] = [
    { value: 'beginner', title: 'Beginner', hint: '0–1 year' },
    { value: 'intermediate', title: 'Intermediate', hint: '1–3 years' },
    { value: 'advanced', title: 'Advanced', hint: '3+ years' },
  ];
  return (
    <>
      <StepHeading title="How much training experience do you have?" />
      <div className="mt-8 space-y-3">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`flex w-full items-center justify-between rounded-card px-5 py-4 text-left transition-all active:opacity-80 ${
              value === opt.value
                ? 'border-2 border-ink bg-paper-card shadow-card'
                : 'border border-line bg-paper-card'
            }`}
          >
            <div>
              <div className="text-base font-semibold text-ink">{opt.title}</div>
              <div className="mt-0.5 text-sm text-muted">{opt.hint}</div>
            </div>
            <RadioDot selected={value === opt.value} />
          </button>
        ))}
      </div>
      <ContinueFooter
        onContinue={onContinue}
        canContinue={canContinue}
        busy={busy}
        error={error}
      />
    </>
  );
}

// ---------- Step: Ready ----------

function StepReady({
  busy,
  error,
  onFinish,
  onSkip,
}: {
  busy: boolean;
  error: string | null;
  onFinish: () => void;
  onSkip: () => void;
}) {
  return (
    <>
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[#E8F5E9]">
          <CheckIcon />
        </div>
        <h1 className="mt-6 text-[32px] font-bold leading-tight tracking-tight text-ink">
          You're ready.
        </h1>
        <p className="mt-2 text-base text-muted">You're all set — let's start training.</p>
      </div>
      <div className="pt-6">
        {error && (
          <div className="mb-3 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}
        <button
          onClick={onFinish}
          disabled={busy}
          className="w-full rounded-pill bg-ink py-4 text-base font-semibold text-white transition-opacity active:opacity-80 disabled:opacity-40"
        >
          {busy ? 'Please wait…' : 'Get started'}
        </button>
        <button
          onClick={onSkip}
          disabled={busy}
          className="mt-2 w-full py-2 text-sm font-semibold text-muted active:text-ink disabled:opacity-50"
        >
          Skip for now
        </button>
      </div>
    </>
  );
}

// ---------- Reusable pieces ----------

function TileOption({
  selected,
  onClick,
  icon,
  label,
}: {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-card px-5 py-4 text-left transition-all active:opacity-80 ${
        selected
          ? 'border-2 border-ink bg-paper-card shadow-card'
          : 'border border-line bg-paper-card'
      }`}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center text-ink">{icon}</div>
        <div className="text-base font-semibold text-ink">{label}</div>
      </div>
      <RadioDot selected={selected} />
    </button>
  );
}

function RadioDot({ selected }: { selected: boolean }) {
  if (selected) {
    return (
      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-ink">
        <div className="h-2 w-2 rounded-full bg-white" />
      </div>
    );
  }
  return <div className="h-5 w-5 rounded-full border border-line" />;
}

function NumberCell({
  value,
  onChange,
  placeholder,
  caption,
  step,
  inputMode,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  caption: string;
  step: string;
  inputMode: 'numeric' | 'decimal';
}) {
  return (
    <div>
      <input
        type="number"
        inputMode={inputMode}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-2xl border border-line bg-paper-card px-4 py-3.5 text-2xl font-bold tracking-tight text-ink focus:border-ink focus:outline-none"
      />
      <div className="mt-1 text-xs font-medium uppercase tracking-wider text-muted">{caption}</div>
    </div>
  );
}

function PillToggle<T extends string>({
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

// ---------- Icons (inline, matching app convention) ----------

function BackIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path
        d="M15 5l-7 7 7 7"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MaleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <circle cx="10" cy="14" r="5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M14 10l6-6m0 0h-4m4 0v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FemaleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="9" r="5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 14v8m-3-3h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function OtherIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 17v5m-3-3h6M15 7l4-4m0 0h-3m3 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MuscleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M4 13c2-1 3-3 4-5s4-2 6 0 4 4 6 4-1 4-4 5-6 1-8 0-5-3-4-4z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StrengthIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M3 12h2m14 0h2M7 8v8m10-8v8M7 12h10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ScaleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 9h8M12 12v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
      <path
        d="M5 12.5l4.5 4.5L19 7.5"
        stroke="#1B8A3A"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
