interface Props {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 px-6 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-card bg-paper-card p-6 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center">
          <img src="/icon-192.png" alt="" className="h-12 w-12 rounded-2xl" />
        </div>
        <h2 className="mt-4 text-center text-xl font-bold tracking-tight text-ink">{title}</h2>
        {message && <p className="mt-2 text-center text-sm text-muted">{message}</p>}
        <div className="mt-6 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 rounded-pill border border-line bg-paper-card py-3 text-sm font-semibold text-ink active:bg-line/40"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 rounded-pill bg-ink py-3 text-sm font-semibold text-white active:opacity-80"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
