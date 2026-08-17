import { useEffect, useRef, useState } from 'react';
import { useNetStatus } from '../lib/offline/net';
import { useOutboxStatus } from '../lib/offline/outbox';

/**
 * The one bit of UI the offline layer needs: a quiet line telling you whether
 * what you just logged is on the server yet.
 *
 * It shows nothing at all when there's signal and nothing queued — the point is
 * reassurance when you're training with no bars, not a permanent badge.
 */
export function SyncStatus({ className = '' }: { className?: string }) {
  const { reachable } = useNetStatus();
  const { pending, failed, syncing } = useOutboxStatus();
  const [justSynced, setJustSynced] = useState(false);
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

  if (reachable && pending === 0 && failed === 0 && !justSynced) return null;

  const offline = !reachable;
  const label = offline
    ? pending > 0
      ? `Offline · ${pending} ${pending === 1 ? 'change' : 'changes'} saved on this phone`
      : 'Offline · everything you log is saved on this phone'
    : syncing
      ? `Syncing ${pending}…`
      : pending > 0
        ? `${pending} ${pending === 1 ? 'change' : 'changes'} waiting to sync`
        : failed > 0
          ? `${failed} ${failed === 1 ? 'change' : 'changes'} couldn't be saved`
          : 'All synced';

  const dotClass = offline
    ? 'bg-muted'
    : syncing || pending > 0
      ? 'bg-ink animate-pulse'
      : failed > 0
        ? 'bg-red-600'
        : 'bg-[#34C759]';

  return (
    <div
      className={`flex items-center gap-2 rounded-pill bg-line/70 px-3 py-1.5 text-xs font-medium text-muted ${className}`}
      role="status"
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
      <span className="truncate">{label}</span>
    </div>
  );
}
