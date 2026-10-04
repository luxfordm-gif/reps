import { useId } from 'react';

interface Props {
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export function EndWorkoutDialog({ onSave, onDiscard, onCancel }: Props) {
  const titleId = useId();
  return (
    <div
      className="backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-ink/50 px-6 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="dialog-in w-full max-w-sm rounded-card bg-paper-card p-6 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="text-center text-xl font-bold tracking-tight text-ink">
          End workout?
        </h2>
        <p className="mt-2 text-center text-sm text-muted">
          Save what you've logged, or discard this session?
        </p>
        <div className="mt-6 flex flex-col gap-2.5">
          <button
            onClick={onSave}
            className="pressable rounded-pill bg-ink py-3 text-sm font-semibold text-white active:opacity-80"
          >
            Save and end
          </button>
          {/* The one button here that throws work away, so it's the one in
              red — the same treatment as "Delete machine" and "End workout"
              in the kebab, rather than a neutral second choice. */}
          <button
            onClick={onDiscard}
            className="pressable rounded-pill border border-danger-line bg-paper-card py-3 text-sm font-semibold text-danger-strong active:bg-danger-soft"
          >
            Discard
          </button>
          <button
            onClick={onCancel}
            className="pressable rounded-pill py-3 text-sm font-semibold text-muted active:text-ink"
          >
            Keep going
          </button>
        </div>
      </div>
    </div>
  );
}
