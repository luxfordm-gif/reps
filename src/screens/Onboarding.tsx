import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  type Profile,
  type ProfilePatch,
  type Gender,
  type TopGoal,
  type Experience,
  upsertProfile,
  markOnboardingComplete,
} from '../lib/profileApi';
import { DateOfBirthInput } from '../components/DateOfBirthInput';
import { useScrollLock } from '../lib/useScrollLock';
import { useVisualViewport } from '../lib/useVisualViewport';
import { iconForGoal } from '../lib/goalIcons';
import { logBodyWeight } from '../lib/bodyWeightApi';
import { cleanDisplayName, MAX_DISPLAY_NAME } from '../lib/displayName';
import {
  ONBOARDING_QUESTIONS,
  answersToPatch,
  unansweredQuestions,
  type OnboardingAnswers,
  type OnboardingQuestion,
} from '../lib/onboardingPatch';
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

type Question = OnboardingQuestion;
type Step = Question | 'ready';
const ORDER: Step[] = [...ONBOARDING_QUESTIONS, 'ready'];

/** How each question is named when the last screen lists what's still blank. */
const QUESTION_LABELS: Record<Question, string> = {
  name: 'name',
  gender: 'gender',
  birthday: 'birthday',
  weight: 'weight',
  height: 'height',
  goal: 'goals',
  experience: 'experience level',
};

/** "height", "weight and height", "a, b and c". */
function listSentence(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const MOTIVATIONAL_LINES = [
  "Go get your dreams.",
  "Go smash it.",
  "We're all prepped — let's hit the gym.",
  "Time to put in the work.",
  "Let's get after it.",
  "Show up. Lift heavy. Repeat.",
];

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function Onboarding({ initial, onClose }: Props) {
  const [step, setStep] = useState<Step>('name');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Local form state, seeded from the profile so resume works.
  const [name, setName] = useState<string>(initial?.display_name ?? '');
  const [gender, setGender] = useState<Gender | null>(initial?.gender ?? null);
  const [dob, setDob] = useState<string>(initial?.date_of_birth ?? '');
  const [weightKg, setWeightKg] = useState<number | null>(initial?.starting_weight_kg ?? null);
  const [heightCm, setHeightCm] = useState<number | null>(initial?.height_cm ?? null);
  const [goals, setGoals] = useState<TopGoal[]>(initial?.top_goals ?? []);
  const [experience, setExperience] = useState<Experience | null>(initial?.experience_level ?? null);
  // Pick a motivational line once per Onboarding mount so it doesn't churn on
  // every re-render.
  const [motivationalLine] = useState(
    () => MOTIVATIONAL_LINES[Math.floor(Math.random() * MOTIVATIONAL_LINES.length)]
  );

  const stepIdx = ORDER.indexOf(step);
  const isLast = step === 'ready';

  const answers: OnboardingAnswers = {
    displayName: cleanDisplayName(name),
    gender,
    dateOfBirth: dob,
    startingWeightKg: weightKg,
    heightCm: heightCm,
    topGoals: goals,
    experience,
  };

  /** Questions the user skipped past, in the order they were asked. */
  const unanswered = unansweredQuestions(answers);

  function patchForStep(s: Step): ProfilePatch {
    return s === 'ready' ? {} : answersToPatch(answers, [s]);
  }

  function fullPatch(): ProfilePatch {
    return answersToPatch(answers);
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

  /**
   * Skip is per question, not per flow: it leaves this one blank and moves on
   * to the next. Leaving setup altogether is the close button's job — it used
   * to be this one's, which is why answering six questions and skipping the
   * seventh dropped you back on the home screen.
   */
  function handleSkipStep() {
    setError(null);
    const next = ORDER[stepIdx + 1];
    if (next) setStep(next);
  }

  /** Out of setup entirely. Whatever's been filled in is saved, but the flow
   *  isn't marked complete — Profile → Personal details finishes it off. */
  async function handleExit() {
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

  if (step === 'ready') {
    return (
      <ReadyScreen
        busy={busy}
        error={error}
        motivationalLine={motivationalLine}
        unanswered={unanswered}
        onFinish={handleFinish}
        onFillIn={() => unanswered[0] && setStep(unanswered[0])}
      />
    );
  }

  return (
    <OnboardingSurface>
      <StepShell
        onBack={stepIdx > 0 ? handleBack : undefined}
        onSkip={!isLast ? handleSkipStep : undefined}
        onExit={handleExit}
        progress={(stepIdx + 1) / ORDER.length}
      >
        {step === 'name' && (
          <StepName
            value={name}
            onChange={setName}
            onContinue={handleContinue}
            canContinue={cleanDisplayName(name) != null}
            busy={busy}
            error={error}
          />
        )}
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
            value={goals}
            onChange={setGoals}
            onContinue={handleContinue}
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
      </StepShell>
    </OnboardingSurface>
  );
}

// ---------- Chrome ----------

/**
 * True while the on-screen keyboard is covering part of the window. Steps use
 * it to give back the spacing they can afford to lose, so the whole question
 * still fits in what the keyboard has left.
 */
const KeyboardOpenContext = createContext(false);

/** Below this a shrunken viewport is a browser toolbar, not a keyboard. */
const KEYBOARD_INSET_PX = 120;

/**
 * The window onto setup, sized to what the user can actually see.
 *
 * Every step is one screenful with its button pinned to the bottom, which is
 * the shape iOS Safari breaks when the keyboard opens: the layout viewport
 * doesn't shrink, so the footer ends up behind the keyboard and Safari scrolls
 * whatever it can to reveal the field being typed into. Pinning the page
 * leaves it nothing to scroll there, and sizing this box to the visual
 * viewport puts the step in what the keyboard has left rather than under it.
 *
 * This box itself never scrolls either — that was the hole in the last fix.
 * Sized to the visual viewport it is short enough for a tall step to overflow,
 * which made it the nearest scrollable thing to the field, so Safari scrolled
 * it and carried the heading, the progress bar and the back arrow off the top
 * of the screen. Anything that has to scroll now scrolls inside StepShell,
 * under a header that can't move.
 *
 * The box is only ever resized, never moved: see useVisualViewport for why
 * offsetting it by the visual viewport's own offset moved the heading down the
 * screen on iOS instead of holding it still.
 */
function OnboardingSurface({ children }: { children: React.ReactNode }) {
  useScrollLock();
  const viewport = useVisualViewport();
  const keyboardOpen = (viewport?.keyboardInset ?? 0) > KEYBOARD_INSET_PX;
  return (
    <div
      className="fixed inset-x-0 z-30 overflow-hidden bg-paper"
      style={viewport ? { top: 0, height: viewport.height } : { top: 0, bottom: 0 }}
    >
      <ViewportProbe />
      <KeyboardOpenContext.Provider value={keyboardOpen}>{children}</KeyboardOpenContext.Provider>
    </div>
  );
}

/**
 * What the browser is actually doing with the viewport, printed on the screen.
 *
 * Off unless the URL carries `?vv=1`, and deliberately not behind a build flag:
 * this exists to be read off a phone that has a keyboard up, which is the one
 * place none of our tooling can reach. A screenshot of it answers, in order,
 * whether the page was scrolled (sy), whether the browser panned the visual
 * viewport instead (off), whether the keyboard shrank it (vv against ih), and
 * where our own box ended up (top) — which is the difference between a fix
 * that belongs in the layout and one that belongs in useVisualViewport.
 *
 * It sits at the very top of the surface, so a shot where it is missing says
 * as much as one where it isn't: the surface itself has gone off the screen.
 */
function ViewportProbe() {
  const [on] = useState(
    () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('vv') === '1'
  );
  const [text, setText] = useState('');
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!on) return;
    let frame = 0;
    const tick = () => {
      const vv = window.visualViewport;
      const box = ref.current?.getBoundingClientRect();
      setText(
        [
          `ih${Math.round(window.innerHeight)}`,
          `vv${vv ? Math.round(vv.height) : '-'}`,
          `off${vv ? Math.round(vv.offsetTop) : '-'}`,
          `sy${Math.round(window.scrollY)}`,
          `top${box ? Math.round(box.top) : '-'}`,
          `act${document.activeElement?.tagName?.toLowerCase() ?? '-'}`,
        ].join(' ')
      );
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [on]);

  if (!on) return null;
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute inset-x-0 top-0 z-50 bg-ink/85 px-2 py-1 text-center font-mono text-[11px] leading-none text-white"
    >
      {text}
    </div>
  );
}

function StepShell({
  onBack,
  onSkip,
  onExit,
  progress,
  children,
}: {
  onBack?: () => void;
  onSkip?: () => void;
  onExit?: () => void;
  progress: number;
  children: React.ReactNode;
}) {
  return (
    // 100% of the surface above, which is the visible viewport — not 100dvh,
    // which on iOS still counts the strip the keyboard is covering.
    <div className="mx-auto flex h-full max-w-md flex-col px-5">
      <div
        className="flex h-11 shrink-0 items-center justify-between"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        {onBack ? (
          <button
            onClick={onBack}
            className="pressable -ml-2 flex h-11 w-11 items-center justify-center rounded-full text-ink active:bg-surface-strong"
            aria-label="Back"
          >
            <BackIcon />
          </button>
        ) : (
          <div className="h-11 w-11" />
        )}
        <div className="flex items-center">
          {onSkip && (
            <button
              onClick={onSkip}
              aria-label="Skip this question"
              className="px-2 py-1 text-sm font-semibold text-muted active:text-ink"
            >
              Skip
            </button>
          )}
          {onExit ? (
            <button
              onClick={onExit}
              aria-label="Finish setup later"
              className="pressable -mr-2 flex h-11 w-11 items-center justify-center rounded-full text-muted active:bg-surface-strong active:text-ink"
            >
              <CloseIcon />
            </button>
          ) : (
            <div className="h-11 w-11" />
          )}
        </div>
      </div>
      <div className="mt-1 h-1 w-full shrink-0 overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full bg-ink transition-[width] duration-sheet ease-snap"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
      {/* The only thing on the screen that scrolls. The back arrow and the
          progress bar sit above it and can't be scrolled away, and the step's
          own heading holds the top of it — so a step too tall for the room the
          keyboard leaves gives up its card and its button, in that order,
          rather than its title. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div
          className="flex min-h-full flex-col pt-6"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1.25rem)' }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * A step's title and its one line of subcopy, in a block of fixed height whose
 * contents sit at the bottom.
 *
 * The fixed height is what keeps the card below from moving as you step
 * through — it's reserved for the tallest heading we allow, so a one-line title
 * doesn't pull the card up. The subtitle is required for the same reason: a
 * step that left it out pulled it up a line.
 *
 * Bottom-aligning is what stops that reservation reading as a hole. Only three
 * of seven titles wrap at 375px, and just one at 430px, so on most phones and
 * most steps there are 43 spare pixels in here. Left at the top they sat
 * between the subcopy and the card, which is the gap you notice; pushed to the
 * bottom they land above the title, under the progress bar, where empty space
 * is just margin. The title shifts down slightly on short steps instead, which
 * is a far quieter thing to move than the card.
 *
 * 115px is two title lines (34px at leading-tight), the 6px gap, and one line
 * of subcopy. Keep new copy inside that at phone width: titles to two lines,
 * subtitles to one. Anything longer still renders — the block grows — but it
 * moves the card again, which is the thing this is here to stop.
 */
function StepHeading({ title, subtitle }: { title: string; subtitle: string }) {
  // With the keyboard up there is no card below to hold still — the step is
  // being typed into, not stepped through — and the 43 spare pixels are the
  // difference between the question fitting and the user having to scroll for
  // the field. Sticky so that if it still doesn't fit, what scrolls away is
  // the bottom of the step and never the question being asked.
  const keyboardOpen = useContext(KeyboardOpenContext);
  return (
    <div
      className={`sticky top-0 z-10 flex shrink-0 flex-col justify-end bg-paper ${
        keyboardOpen ? 'pb-1' : 'min-h-[115px]'
      }`}
    >
      <h1 className="text-display font-bold leading-tight tracking-tight text-ink">{title}</h1>
      <p className="mt-1.5 text-base text-muted">{subtitle}</p>
    </div>
  );
}

function ContinueFooter({
  onContinue,
  canContinue,
  busy,
  error,
  label = 'Continue',
  helperText,
}: {
  onContinue: () => void;
  canContinue: boolean;
  busy: boolean;
  error: string | null;
  label?: string;
  helperText?: string;
}) {
  return (
    <div className="mt-auto pt-6">
      {error && (
        <div className="mb-3 rounded-panel bg-danger-soft px-4 py-3 text-sm text-danger">{error}</div>
      )}
      <p className="mb-3 text-center text-xs text-muted">
        {helperText ?? 'Your data is private and secure.'}
      </p>
      <button
        onClick={onContinue}
        disabled={!canContinue || busy}
        className="pressable w-full rounded-pill bg-ink py-4 text-base font-semibold text-white transition-opacity active:opacity-80 disabled:opacity-40"
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
      <StepHeading title="What is your gender?" subtitle="It helps us tailor your plan." />
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

function StepName({
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
      <StepHeading title="What should we call you?" subtitle="It's how the app greets you." />
      <div className="mt-8 rounded-card bg-paper-card p-5 shadow-card">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-muted">
            First name
          </span>
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canContinue && !busy) onContinue();
            }}
            maxLength={MAX_DISPLAY_NAME}
            autoComplete="given-name"
            autoCapitalize="words"
            placeholder="Alex"
            className="w-full rounded-panel border border-line bg-paper-card px-4 py-3.5 text-xl font-semibold tracking-tight text-ink placeholder:font-normal placeholder:text-muted/60 focus:border-ink focus:outline-none"
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
        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-muted">
          Date of birth
        </span>
        <DateOfBirthInput
          value={value}
          onChange={onChange}
          onEnter={() => {
            if (canContinue && !busy) onContinue();
          }}
        />
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
      <StepHeading title="What is your weight?" subtitle="You can update it any time." />
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
              className="w-full rounded-panel border border-line bg-paper-card px-4 py-3.5 text-2xl font-bold tracking-tight text-ink focus:border-ink focus:outline-none"
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
      <StepHeading title="What is your height?" subtitle="We use it to track your progress." />
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
              className="w-full rounded-panel border border-line bg-paper-card px-4 py-3.5 text-2xl font-bold tracking-tight text-ink focus:border-ink focus:outline-none"
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
  busy,
  error,
}: {
  value: TopGoal[];
  onChange: (g: TopGoal[]) => void;
  onContinue: () => void;
  busy: boolean;
  error: string | null;
}) {
  const options: { value: TopGoal; label: string; icon: React.ReactNode }[] = [
    { value: 'build_muscle', label: 'Build muscle', icon: <GoalIcon goal="build_muscle" /> },
    { value: 'gain_strength', label: 'Gain strength', icon: <GoalIcon goal="gain_strength" /> },
    { value: 'fat_loss', label: 'Fat loss', icon: <GoalIcon goal="fat_loss" /> },
  ];
  function toggle(g: TopGoal) {
    onChange(value.includes(g) ? value.filter((v) => v !== g) : [...value, g]);
  }
  return (
    <>
      <StepHeading title="What are your goals?" subtitle="Pick one or more." />
      <div className="mt-8 space-y-3">
        {options.map((opt) => (
          <TileOption
            key={opt.value}
            selected={value.includes(opt.value)}
            onClick={() => toggle(opt.value)}
            icon={opt.icon}
            label={opt.label}
            selectionStyle="check"
          />
        ))}
      </div>
      <ContinueFooter
        onContinue={onContinue}
        canContinue={value.length > 0}
        busy={busy}
        error={error}
        helperText="You can update this in Settings at any time."
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
      <StepHeading
        title="How experienced are you?"
        subtitle="Pick the one that sounds most like you."
      />
      <div className="mt-8 space-y-3">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`flex w-full items-center justify-between rounded-card border bg-paper-card px-5 py-4 text-left transition-colors duration-pop active:opacity-80 ${
              value === opt.value
                ? 'border-ink shadow-card ring-1 ring-inset ring-ink'
                : 'border-line'
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

/**
 * The last screen of setup, and the only way out of it: Get started.
 *
 * There used to be an "I'll finish this later" underneath, which read as a
 * second exit from a flow the user had just finished — and offered to defer
 * work they'd already done. Anything genuinely left blank is worth saying out
 * loud instead, with the one tap that goes back and fills it in; the X in the
 * header is still there on every question for leaving setup part-way.
 */
function ReadyScreen({
  busy,
  error,
  motivationalLine,
  unanswered,
  onFinish,
  onFillIn,
}: {
  busy: boolean;
  error: string | null;
  motivationalLine: string;
  unanswered: Question[];
  onFinish: () => void;
  onFillIn: () => void;
}) {
  const skipped = unanswered.length > 0;
  const one = unanswered.length === 1;
  return (
    <OnboardingSurface>
      <div
        className="mx-auto flex max-w-md flex-col px-5"
        style={{
          minHeight: '100%',
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1rem)',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1.25rem)',
        }}
      >
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[#E8F5E9]">
            <CheckIcon />
          </div>
          <h1 className="mt-6 text-display font-bold leading-tight tracking-tight text-ink">
            {skipped ? "You're all set." : "You're ready."}
          </h1>
          <p className="mt-2 text-base text-muted">{motivationalLine}</p>
        </div>
        <div className="pt-6">
          {error && (
            <div className="mb-3 rounded-panel bg-danger-soft px-4 py-3 text-sm text-danger">{error}</div>
          )}
          {skipped && (
            <div className="mb-3 rounded-panel bg-surface-strong px-4 py-3 text-left">
              <p className="text-sm text-ink">
                You skipped your {listSentence(unanswered.map((q) => QUESTION_LABELS[q]))}.
              </p>
              <p className="mt-0.5 text-sm text-muted">
                You can add {one ? 'it' : 'them'} now, or any time from Profile → Personal
                details.
              </p>
              <button
                onClick={onFillIn}
                disabled={busy}
                className="mt-2 text-sm font-semibold text-ink underline underline-offset-2 active:opacity-60 disabled:opacity-50"
              >
                Fill {one ? 'it' : 'them'} in now
              </button>
            </div>
          )}
          <button
            onClick={onFinish}
            disabled={busy}
            className="pressable w-full rounded-pill bg-ink py-4 text-base font-semibold text-white transition-opacity active:opacity-80 disabled:opacity-40"
          >
            {busy ? 'Please wait…' : 'Get started'}
          </button>
        </div>
      </div>
    </OnboardingSurface>
  );
}

// ---------- Reusable pieces ----------

/**
 * A tappable option row.
 *
 * The selected edge is a 1px border plus a 1px inset ring rather than a 2px
 * border. It reads the same, but a ring is painted inside the box, so picking
 * an option no longer makes the tile 2px taller and nudges every row below it
 * down the screen. The shadow is free — it never took up space.
 */
function TileOption({
  selected,
  onClick,
  icon,
  label,
  selectionStyle = 'radio',
}: {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  selectionStyle?: 'radio' | 'check';
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-card border bg-paper-card px-5 py-4 text-left transition-colors duration-pop active:opacity-80 ${
        selected
          ? 'border-ink shadow-card ring-1 ring-inset ring-ink'
          : 'border-line'
      }`}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center text-ink">{icon}</div>
        <div className="text-base font-semibold text-ink">{label}</div>
      </div>
      {selectionStyle === 'check' ? (
        <CheckBox selected={selected} />
      ) : (
        <RadioDot selected={selected} />
      )}
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

function CheckBox({ selected }: { selected: boolean }) {
  if (selected) {
    return (
      <div className="flex h-5 w-5 items-center justify-center rounded-md bg-ink">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <path
            d="M3 8.5l3 3 6.5-6.5"
            stroke="white"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    );
  }
  return <div className="h-5 w-5 rounded-md border border-line" />;
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
        className="w-full rounded-panel border border-line bg-paper-card px-4 py-3.5 text-2xl font-bold tracking-tight text-ink focus:border-ink focus:outline-none"
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

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path
        d="M5 5l10 10M15 5L5 15"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
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

/** A goal's drawn icon, sized to sit in a TileOption's 32px slot. */
function GoalIcon({ goal }: { goal: TopGoal }) {
  const { src, size } = iconForGoal(goal);
  return <img src={src} alt="" width={size} height={size} />;
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
