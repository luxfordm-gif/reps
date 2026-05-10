export function Logo({ className = '' }: { className?: string }) {
  return (
    <img
      src="/reps.png"
      alt="Reps"
      className={className}
      draggable={false}
    />
  );
}
