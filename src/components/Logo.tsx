export function Logo({ className = '' }: { className?: string }) {
  return (
    <span
      aria-label="Reps"
      className={`select-none font-black leading-none tracking-[-0.06em] text-ink ${className}`}
      style={{ fontSize: '32px' }}
    >
      REPS
    </span>
  );
}
