import type { ChangelogEntry } from '../lib/changelog';

interface Props {
  entry: ChangelogEntry;
  onDismiss: () => void;
}

export function WhatsNewModal({ entry, onDismiss }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 px-6 backdrop-blur-sm"
      onClick={onDismiss}
    >
      <div
        className="w-full max-w-sm rounded-card bg-paper-card p-6 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-ink text-3xl">
            <span aria-hidden>{entry.emoji}</span>
          </div>
        </div>
        <h2 className="mt-4 text-center text-xl font-bold tracking-tight text-ink">
          {entry.title}
        </h2>
        <ul className="mt-5 space-y-2.5 text-sm text-ink">
          {entry.bullets.map((b, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-ink" />
              <span className="leading-snug">{b}</span>
            </li>
          ))}
        </ul>
        <button
          onClick={onDismiss}
          className="mt-6 w-full rounded-pill bg-ink py-3 text-sm font-semibold text-white active:opacity-80"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
