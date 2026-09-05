import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ACCEPTED_ATTACHMENT_TYPES,
  FEEDBACK_KINDS,
  MAX_ATTACHMENTS,
  describeAttachmentProblem,
  describeSendError,
  sendFeedback,
  type FeedbackKind,
} from '../lib/feedbackApi';

// The feedback sheet, reachable from the chat icon in the bottom bar.
//
// Deliberately one screen: pick what kind of thing it is, type it, optionally
// attach a screenshot, send. Someone noticing a bug mid-set will not fill
// in a form, so there is nothing here that isn't the report itself.

interface Props {
  /** Which screen the user was on — sent with the report so it needn't be asked. */
  screen: string;
  onClose: () => void;
}

type Status = 'editing' | 'sending' | 'sent';

interface Outcome {
  queued: boolean;
  failedAttachments: string[];
}

export function FeedbackSheet({ screen, onClose }: Props) {
  const [kind, setKind] = useState<FeedbackKind>('bug');
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<Status>('editing');
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>({ queued: false, failedAttachments: [] });
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    // Straight into typing — the keyboard is the next thing they need.
    const t = window.setTimeout(() => textRef.current?.focus(), 120);
    return () => window.clearTimeout(t);
  }, []);

  // Object URLs for the thumbnails. Derived from the files rather than held in
  // state, with the effect doing only what an effect is for: revoking the URLs
  // once the set they belong to is replaced or the sheet closes.
  const previews = useMemo(
    () => files.map((file) => ({ url: URL.createObjectURL(file), file })),
    [files]
  );
  useEffect(() => {
    return () => {
      for (const p of previews) URL.revokeObjectURL(p.url);
    };
  }, [previews]);

  function addFiles(picked: FileList | null) {
    if (!picked || picked.length === 0) return;
    setError(null);
    const room = MAX_ATTACHMENTS - files.length;
    if (room <= 0) {
      setError(`You can attach up to ${MAX_ATTACHMENTS} files.`);
      return;
    }
    const accepted: File[] = [];
    for (const file of Array.from(picked).slice(0, room)) {
      const problem = describeAttachmentProblem(file);
      if (problem) setError(problem);
      else accepted.push(file);
    }
    if (accepted.length > 0) setFiles((prev) => [...prev, ...accepted]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function removeFile(target: File) {
    setFiles((prev) => prev.filter((f) => f !== target));
  }

  async function handleSend() {
    if (!message.trim() || status === 'sending') return;
    setStatus('sending');
    setError(null);
    try {
      const result = await sendFeedback({ kind, message, files, screen });
      setOutcome(result);
      setStatus('sent');
      // Long enough to read the confirmation, short enough not to be in the way.
      const dwell = result.queued || result.failedAttachments.length > 0 ? 3200 : 1400;
      window.setTimeout(onClose, dwell);
    } catch (e) {
      setStatus('editing');
      setError(describeSendError(e));
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 backdrop-blur-sm"
      onClick={status === 'sending' ? undefined : onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Send feedback"
    >
      <div
        className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-card bg-paper-card p-6 shadow-card"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {status === 'sent' ? (
          <SentState outcome={outcome} />
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold tracking-tight text-ink">Send feedback</h2>
              <button
                onClick={onClose}
                className="-mr-2 -mt-1 flex h-9 w-9 items-center justify-center rounded-full text-muted active:bg-line/60"
                aria-label="Close"
              >
                <CloseIcon />
              </button>
            </div>

            <div className="mt-4 flex flex-wrap gap-1.5">
              {FEEDBACK_KINDS.map((k) => (
                <button
                  key={k.id}
                  onClick={() => setKind(k.id)}
                  className={`rounded-pill px-3 py-1.5 text-xs font-semibold transition-colors ${
                    kind === k.id
                      ? 'bg-ink text-white'
                      : 'border border-line bg-paper text-muted'
                  }`}
                >
                  {k.label}
                </button>
              ))}
            </div>

            <textarea
              ref={textRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              maxLength={4000}
              placeholder={placeholderFor(kind)}
              className="mt-3 w-full resize-none rounded-2xl border border-line bg-paper px-4 py-3 text-sm text-ink placeholder:text-muted focus:border-ink focus:outline-none"
            />

            {previews.length > 0 && (
              <ul className="mt-3 flex gap-2">
                {previews.map((p) => (
                  <li key={p.url} className="relative">
                    <img
                      src={p.url}
                      alt={p.file.name}
                      className="h-20 w-20 rounded-2xl bg-ink/5 object-cover"
                    />
                    <button
                      onClick={() => removeFile(p.file)}
                      className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-ink text-white shadow-card"
                      aria-label={`Remove ${p.file.name}`}
                    >
                      <CloseIcon small />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_ATTACHMENT_TYPES}
              multiple
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
            />

            {files.length < MAX_ATTACHMENTS && (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line py-3 text-sm font-semibold text-muted active:bg-line/30"
              >
                <PaperclipIcon />
                {files.length === 0 ? 'Add a screenshot' : 'Add another'}
              </button>
            )}

            {error && (
              <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
                {error}
              </p>
            )}

            <button
              onClick={handleSend}
              disabled={!message.trim() || status === 'sending'}
              className="mt-4 w-full rounded-pill bg-ink py-4 text-base font-semibold text-white transition-opacity active:opacity-80 disabled:opacity-40"
            >
              {status === 'sending' ? 'Sending…' : 'Send feedback'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function SentState({ outcome }: { outcome: Outcome }) {
  const { queued, failedAttachments } = outcome;
  return (
    <div className="py-6 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-ink text-white">
        {queued ? <ClockIcon /> : <TickIcon />}
      </div>
      <p className="mt-4 text-base font-bold text-ink">
        {queued ? "Saved — it'll send itself." : "Thanks — that's sent."}
      </p>
      <p className="mt-1 text-sm text-muted">{sentDetail(queued, failedAttachments)}</p>
    </div>
  );
}

function sentDetail(queued: boolean, failedAttachments: string[]): string {
  const n = failedAttachments.length;
  if (queued) {
    const base =
      "No signal right now, so it's saved on your phone and goes the moment you're back online. You can close the app.";
    return n > 0
      ? `${base} ${n} ${n === 1 ? 'attachment was' : 'attachments were'} too big to store, so ${n === 1 ? "it isn't" : "they aren't"} included.`
      : base;
  }
  if (n > 0) {
    return `Your message got through, but ${n} ${
      n === 1 ? "attachment wouldn't" : "attachments wouldn't"
    } upload on this connection. Send it again on wifi if it matters.`;
  }
  return 'It really does help. Back to it.';
}

function TickIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <path
        d="M5 11.5l4 4 8-9"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <circle cx="11" cy="11" r="7.5" stroke="currentColor" strokeWidth="1.9" />
      <path
        d="M11 7v4.3l2.8 1.7"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function placeholderFor(kind: FeedbackKind): string {
  switch (kind) {
    case 'bug':
      return 'What happened, and what did you expect instead? A screenshot helps more than anything.';
    case 'plan_import':
      return 'Which part of your plan came in wrong — a missing exercise, the wrong day, the wrong week?';
    case 'idea':
      return "What would make this better? Don't polish it, just say it.";
    default:
      return 'Anything at all.';
  }
}

function CloseIcon({ small = false }: { small?: boolean }) {
  const s = small ? 12 : 20;
  return (
    <svg width={s} height={s} viewBox="0 0 20 20" fill="none">
      <path
        d="M5 5l10 10M15 5L5 15"
        stroke="currentColor"
        strokeWidth={small ? 2.6 : 1.9}
        strokeLinecap="round"
      />
    </svg>
  );
}

function PaperclipIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
      <path
        d="M13.5 6.5l-5.9 5.9a1.9 1.9 0 0 0 2.7 2.7l6.2-6.2a3.6 3.6 0 0 0-5.1-5.1l-6.2 6.2a5.3 5.3 0 0 0 7.5 7.5l5.4-5.4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
