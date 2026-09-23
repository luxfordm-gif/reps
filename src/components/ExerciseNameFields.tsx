import { matchBrands } from '../lib/exerciseBrand';

const INPUT =
  'w-full rounded-control border border-line bg-paper px-3 py-2.5 text-sm text-ink focus:border-ink focus:outline-none';

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
        className={INPUT}
      />
      <BrandChips value={brand} onPick={onBrandChange} />
    </div>
  );
}

/**
 * Brands matching what's been typed, as pills to tap. Drawn by the app rather
 * than left to the browser's own suggestion list, which shows as a dropdown on
 * Chrome, in the keyboard bar on an iPhone, and not at all on some browsers.
 */
export function BrandChips({
  value,
  onPick,
  className = '',
}: {
  value: string;
  onPick: (brand: string) => void;
  className?: string;
}) {
  const matches = matchBrands(value);
  if (matches.length === 0) return null;
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`} aria-label="Suggested brands">
      {matches.map((b) => (
        <button
          key={b}
          type="button"
          // Keep focus in the field so the keyboard doesn't drop and come back.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(b)}
          className="pressable rounded-pill border border-line bg-paper-card px-3 py-1.5 text-xs font-semibold text-ink active:bg-pressed"
        >
          {b}
        </button>
      ))}
    </div>
  );
}
