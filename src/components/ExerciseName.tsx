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
}: {
  name: string;
  variant?: 'stacked' | 'inline';
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
      <span className="mt-0.5 block text-xs font-medium leading-tight text-muted">{brand}</span>
    </>
  );
}
