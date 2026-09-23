/**
 * The small uppercase heading over a group on a screen — "This week",
 * "Records", "History". One style, so every screen's sections read alike;
 * it used to be copied into four files and had drifted in the others.
 */
export function SectionLabel({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`text-xs font-semibold uppercase tracking-eyebrow text-muted ${className}`}>
      {children}
    </div>
  );
}
