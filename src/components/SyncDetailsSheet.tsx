import { useMemo, useState } from 'react';
import {
  describeEntry,
  discardEntry,
  listOutbox,
  retryAllNow,
  useOutboxStatus,
  type OutboxEntry,
} from '../lib/offline/outbox';

function whenQueued(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function nextTry(entry: OutboxEntry): string | null {
  if (!entry.nextAttemptAt) return null;
  const ms = new Date(entry.nextAttemptAt).getTime() - Date.now();
  if (Number.isNaN(ms) || ms <= 0) return null;
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return 'retrying now';
  if (mins < 60) return `retrying in ${mins}m`;
  return `retrying in ${Math.round(mins / 60)}h`;
}

/**
 * What's stuck, and why.
 *
 * Only reachable from the red sync pill. Nothing here deletes a write on the
 * app's behalf — "Discard" is the user saying they don't want it, which is the
 * only way a queued set ever leaves the queue unsent.
 */
export function SyncDetailsSheet({ onClose }: { onClose: () => void }) {
  const { pending, needsAttention } = useOutboxStatus();
  const [refreshKey, setRefreshKey] = useState(0);
  // Re-read the queue as it drains behind the sheet, and after a retry or a
  // discard here.
  const entries = useMemo(
    () => listOutbox(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pending, needsAttention, refreshKey]
  );

  function refresh() {
    setRefreshKey((k) => k + 1);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-t-card bg-paper-card p-6 shadow-card"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold tracking-tight text-ink">Waiting to save</h2>
        <p className="mt-1 text-sm text-muted">
          These are on this phone and haven't reached the server yet. They stay here until
          they do — nothing is thrown away.
        </p>

        <ul className="mt-4 space-y-3">
          {entries.map((entry) => (
            <li key={entry.id} className="rounded-card border border-line px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">
                    {describeEntry(entry)}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {whenQueued(entry.queuedAt)}
                    {nextTry(entry) ? ` · ${nextTry(entry)}` : ''}
                  </p>
                  {entry.lastError && (
                    <p className="mt-1 break-words text-xs text-red-600">
                      {entry.lastError.message}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => {
                    discardEntry(entry.id);
                    refresh();
                  }}
                  className="shrink-0 rounded-pill border border-line px-3 py-1.5 text-xs font-semibold text-muted active:bg-line/40"
                >
                  Discard
                </button>
              </div>
            </li>
          ))}
          {entries.length === 0 && (
            <li className="rounded-card border border-line px-4 py-6 text-center text-sm text-muted">
              Everything is saved.
            </li>
          )}
        </ul>

        <div className="mt-6 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-pill border border-line bg-paper-card py-3 text-sm font-semibold text-ink active:bg-line/40"
          >
            Close
          </button>
          <button
            onClick={() => {
              retryAllNow();
              refresh();
            }}
            className="flex-1 rounded-pill bg-ink py-3 text-sm font-semibold text-white active:opacity-80"
          >
            Retry now
          </button>
        </div>
      </div>
    </div>
  );
}
