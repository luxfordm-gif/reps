import { customBrandList } from '../lib/exerciseBrand';
import { brandSuggestions } from '../lib/machineCatalogue';

const INPUT =
  'w-full rounded-control border border-line bg-paper-card px-3 py-3 text-base text-ink focus:border-ink focus:outline-none';

/**
 * The two fields an exercise is typed into: the movement, and the machine's
 * brand underneath it. The brand is optional — leave it blank when there isn't
 * one or it isn't known. Callers put the pair back together with composeName.
 */
export default function ExerciseNameFields({
  movement,
  brand,
  onMovementChange,
  onBrandChange,
  autoFocus,
  className = '',
}: {
  movement: string;
  brand: string;
  onMovementChange: (v: string) => void;
  onBrandChange: (v: string) => void;
  autoFocus?: boolean;
  className?: string;
}) {
  return (
    <div className={`grid gap-2 ${className}`}>
      <input
        autoFocus={autoFocus}
        value={movement}
        onChange={(e) => onMovementChange(e.target.value)}
        placeholder="Exercise, e.g. Chest press"
        aria-label="Exercise"
        className={INPUT}
      />
      <input
        value={brand}
        onChange={(e) => onBrandChange(e.target.value)}
        placeholder="Brand (optional), e.g. Prime"
        aria-label="Brand (optional)"
        autoCapitalize="words"
        list={BRAND_LIST_ID}
        className={INPUT}
      />
      <BrandSuggestions />
    </div>
  );
}

export const BRAND_LIST_ID = 'reps-machine-brands';

/** The makers and lines a brand field offers as you type, plus any brand typed
 *  before. Render one beside any input with list={BRAND_LIST_ID}. */
export function BrandSuggestions() {
  const options = [...new Set([...brandSuggestions(), ...customBrandList()])];
  return (
    <datalist id={BRAND_LIST_ID}>
      {options.map((b) => (
        <option key={b} value={b} />
      ))}
    </datalist>
  );
}
