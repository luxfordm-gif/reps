import type { ChangelogEntry } from '../lib/changelog';

interface Props {
  entry: ChangelogEntry;
  onDismiss: () => void;
}

export function WhatsNewModal({ entry, onDismiss }: Props) {
  return (
    <div
      className="backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-ink/50 px-6 backdrop-blur-sm"
      onClick={onDismiss}
    >
      {/* A release with a lot in it used to run off the bottom of a phone,
          taking "Got it" with it. The dialog is capped and the list scrolls
          inside it, so the way out is always on screen. */}
      <div
        className="dialog-in flex max-h-[85vh] w-full max-w-sm flex-col rounded-card bg-paper-card p-6 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 justify-center">
          <img src="/icon-192.png" alt="" className="h-14 w-14 rounded-panel" />
        </div>
        <h2 className="mt-4 shrink-0 text-center text-xl font-bold tracking-tight text-ink">
          {entry.title}
        </h2>
        <ul className="mt-5 min-h-0 flex-1 space-y-2.5 overflow-y-auto text-sm text-ink">
          {entry.bullets.map((b, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-ink" />
              <span className="leading-snug">{b}</span>
            </li>
          ))}
        </ul>
        <button
          onClick={onDismiss}
          className="pressable mt-6 w-full shrink-0 rounded-pill bg-ink py-3 text-sm font-semibold text-white active:opacity-80"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
