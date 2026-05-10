export function Logo({ className = 'h-8 w-auto' }: { className?: string }) {
  return (
    <img
      src="/Reps-Logo.svg"
      alt="Reps"
      className={`select-none ${className}`}
      draggable={false}
    />
  );
}
