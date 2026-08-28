import { useEffect, useRef, useState } from 'react';
import { useNetStatus } from '../lib/offline/net';
import { listOutbox, useOutboxStatus } from '../lib/offline/outbox';
import { SyncDetailsSheet } from './SyncDetailsSheet';

/**
 * The one bit of UI the offline layer needs: a quiet line telling you whether
 * what you just logged is on the server yet.
 *
 * It shows nothing at all when there's signal and nothing queued — the point is
 * reassurance when you're training with no bars, not a permanent badge.
 */
export function SyncStatus({ className = '' }: { className?: string }) {
  const { reachable } = useNetStatus();
  const { pending, deferred, needsAttention, failed, syncing } = useOutboxStatus();
  const [justSynced, setJustSynced] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const previousPending = useRef(pending);

  useEffect(() => {
    const had = previousPending.current;
    previousPending.current = pending;
    if (had > 0 && pending === 0) {
      setJustSynced(true);
      const t = window.setTimeout(() => setJustSynced(false), 2600);
      return () => window.clearTimeout(t);
    }
  }, [pending]);

  const stuck = needsAttention + failed;
  if (reachable && pending === 0 && stuck === 0 && !justSynced) return null;

  const offline = !reachable;
  const waiting = pending - deferred;
  const label = stuck > 0
    ? `${stuck} ${stuck === 1 ? 'change' : 'changes'} couldn't be saved — tap to retry`
    : offline
      ? pending > 0
        ? `Offline · ${pending} ${pending === 1 ? 'change' : 'changes'} saved on this phone`
        : 'Offline · everything you log is saved on this phone'
      : syncing
        ? `Syncing ${pending}…`
        : pending > 0
          ? waiting > 0
            ? `${pending} ${pending === 1 ? 'change' : 'changes'} waiting to sync`
            : `${pending} ${pending === 1 ? 'change' : 'changes'} waiting · ${retryHint()}`
          : 'All synced';

  const dotClass = stuck > 0
    ? 'bg-red-600'
    : offline
      ? 'bg-muted'
      : syncing || pending > 0
        ? 'bg-ink animate-pulse'
        : 'bg-[#34C759]';

  // Only ever tappable when there's something for the user to do about it.
  const Tag = stuck > 0 ? 'button' : 'div';

  return (
    <>
      <Tag
        className={`flex w-full items-center gap-2 rounded-pill bg-line/70 px-3 py-1.5 text-left text-xs font-medium text-muted ${className}`}
        role={stuck > 0 ? undefined : 'status'}
        onClick={stuck > 0 ? () => setDetailsOpen(true) : undefined}
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
        <span className="truncate">{label}</span>
      </Tag>
      {detailsOpen && <SyncDetailsSheet onClose={() => setDetailsOpen(false)} />}
    </>
  );
}

/** How long until the next attempt, so a queue that's backing off doesn't read
 *  as a stalled one. */
function retryHint(): string {
  let soonest: number | null = null;
  for (const entry of listOutbox()) {
    if (!entry.nextAttemptAt) continue;
    const at = new Date(entry.nextAttemptAt).getTime();
    if (Number.isNaN(at)) continue;
    if (soonest == null || at < soonest) soonest = at;
  }
  if (soonest == null) return 'retrying shortly';
  const mins = Math.round((soonest - Date.now()) / 60_000);
  if (mins < 1) return 'retrying now';
  if (mins < 60) return `retrying in ${mins}m`;
  return `retrying in ${Math.round(mins / 60)}h`;
}
