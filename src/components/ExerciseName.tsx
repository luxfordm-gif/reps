import { splitBrand } from '../lib/exerciseBrand';

/**
 * An exercise name with its machine brand pulled out: the movement in whatever
 * style the surrounding element gives it, the brand small and muted.
 *
 * `stacked` puts the brand on a line of its own, for rows with room.
 * `inline` keeps it on the same line after a dot, for pickers, chips and the
 * workout bar.
 */
export default function ExerciseName({
  name,
  variant = 'stacked',
  brandClassName = 'mt-0.5 text-xs font-medium',
}: {
  name: string;
  variant?: 'stacked' | 'inline';
  /** Size and spacing of the stacked brand line, for headings that need more. */
  brandClassName?: string;
}) {
  const { movement, brand } = splitBrand(name);
  if (!brand) return <>{name}</>;
  if (variant === 'inline') {
    return (
      <>
        {movement}
        <span className="font-normal opacity-60"> · {brand}</span>
      </>
    );
  }
  return (
    <>
      {movement}
      <span className={`block leading-tight text-muted ${brandClassName}`}>{brand}</span>
    </>
  );
}
