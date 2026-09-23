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
        className={INPUT}
      />
    </div>
  );
}
