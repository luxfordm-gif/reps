export function Logo({ className = '' }: { className?: string }) {
  return (
    <img
      src="/reps-new.png"
      alt="Reps"
      className={className}
      draggable={false}
    />
  );
}
