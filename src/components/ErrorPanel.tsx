import { useEffect, useRef, useState } from 'react';
import { copyText } from '../lib/copyText';

// The red box, with the part you can send on.
//
// The message says what to do; the report under it says what happened, in the
// detail someone debugging it needs and nobody reading it wants. So the report
// is folded away by default and Copy doesn't make you unfold it — the whole
// interaction we're asking for, from a person standing in a gym, is one tap
// before they go back to WhatsApp.

interface Props {
  /** What to tell the person. Plain English, says what they can do. */
  message: string;
  /** The detail block to copy, from buildErrorReport. */
  report?: string | null;
  className?: string;
}

const COPIED_FOR_MS = 2500;

export function ErrorPanel({ message, report, className }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null);
  const timer = useRef<number | null>(null);

  // A new error means the old "Copied" is about the old report, and leaving it
  // up would have someone paste the last failure into a message. Adjusted
  // during render rather than in an effect, which is React's own answer to
  // state that has to follow a prop and avoids a second pass over the tree.
  const [shownFor, setShownFor] = useState(report);
  if (shownFor !== report) {
    setShownFor(report);
    setCopied(null);
    setOpen(false);
  }

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    []
  );

  async function handleCopy() {
    if (!report) return;
    const ok = await copyText(report);
    setCopied(ok ? 'yes' : 'no');
    if (!ok) {
      // Nothing we can do from here, so show them the thing to long-press.
      setOpen(true);
    }
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(null), COPIED_FOR_MS);
  }

  return (
    <div
      className={`rounded-panel border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger ${className ?? ''}`}
    >
      <div>{message}</div>

      {report && (
        <>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="pressable rounded-pill bg-danger-strong px-3 py-1.5 text-xs font-semibold text-white"
            >
              {copied === 'yes' ? 'Copied' : copied === 'no' ? 'Copy failed' : 'Copy details'}
            </button>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="pressable rounded-pill px-3 py-1.5 text-xs font-semibold text-danger-strong"
              aria-expanded={open}
            >
              {open ? 'Hide details' : 'Show details'}
            </button>
          </div>
          {copied === 'yes' && (
            <div className="mt-2 text-caption text-danger">
              Paste it into a message to whoever sent you Reps — it says which phone and
              browser you're on, and what the app was doing.
            </div>
          )}
          {open && (
            // select-text and the touch callout are explicit: if Copy failed,
            // long-pressing this is the only way left to get it out.
            <pre className="mt-2 max-h-56 select-text overflow-auto whitespace-pre-wrap break-words rounded-control bg-paper-card px-3 py-2 text-caption leading-relaxed text-ink-soft [-webkit-touch-callout:default] [-webkit-user-select:text]">
              {report}
            </pre>
          )}
        </>
      )}
    </div>
  );
}
