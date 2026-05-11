interface Props {
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export function EndWorkoutDialog({ onSave, onDiscard, onCancel }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 px-6 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-card bg-paper-card p-6 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-center text-xl font-bold tracking-tight text-ink">End workout?</h2>
        <p className="mt-2 text-center text-sm text-muted">
          Save what you've logged, or discard this session?
        </p>
        <div className="mt-6 flex flex-col gap-2.5">
          <button
            onClick={onSave}
            className="rounded-pill bg-ink py-3 text-sm font-semibold text-white active:opacity-80"
          >
            Save &amp; end
          </button>
          <button
            onClick={onDiscard}
            className="rounded-pill border border-ink bg-transparent py-3 text-sm font-semibold text-ink active:bg-ink/5"
          >
            Discard
          </button>
          <button
            onClick={onCancel}
            className="py-2 text-sm font-semibold text-muted active:text-ink"
          >
            Keep going
          </button>
        </div>
      </div>
    </div>
  );
}
