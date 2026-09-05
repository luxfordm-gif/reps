import { supabase, currentUserId } from './supabase';
import { CHANGELOG } from './changelog';
import { enqueue } from './offline/outbox';
import { isReachable, isTransportError, reportNetworkFail } from './offline/net';
import { putBlob } from './offline/blobStore';

// Sending feedback from inside the app.
//
// Built for beta: the person who spots something is standing in a gym holding
// their phone, and the report is only worth having if it takes ten seconds. So
// the message is the only required field, attachments are optional, and the
// context that would otherwise need a follow-up question is collected for them.

export type FeedbackKind = 'bug' | 'idea' | 'plan_import' | 'general';

export const FEEDBACK_KINDS: { id: FeedbackKind; label: string }[] = [
  { id: 'bug', label: 'Something broke' },
  { id: 'plan_import', label: 'Plan import' },
  { id: 'idea', label: 'Idea' },
  { id: 'general', label: 'Something else' },
];

const BUCKET = 'feedback';

/** Matches the bucket's file_size_limit in migration 0015. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS = 3;

// Screenshots only. Video was allowed at first, but a screen recording is
// 50MB of upload from a gym with one bar of signal, and a screenshot says
// what's wrong just as well.
export const ACCEPTED_ATTACHMENT_TYPES =
  'image/png,image/jpeg,image/webp,image/heic,image/heif,image/gif';

export interface FeedbackContext {
  version: string;
  screen: string;
  online: boolean;
  viewport: string;
  userAgent: string;
  language: string;
  sentAt: string;
}

/** What the app knew when Send was tapped. */
export function collectContext(screen: string): FeedbackContext {
  const w = typeof window === 'undefined' ? null : window;
  return {
    version: CHANGELOG[0]?.version ?? 'unknown',
    screen,
    online: w?.navigator?.onLine ?? true,
    viewport: w ? `${w.innerWidth}x${w.innerHeight}@${w.devicePixelRatio ?? 1}` : 'unknown',
    userAgent: w?.navigator?.userAgent ?? 'unknown',
    language: w?.navigator?.language ?? 'unknown',
    sentAt: new Date().toISOString(),
  };
}

/** A filename that can't collide and can't escape the user's own folder. */
function storagePath(userId: string, file: File, index: number): string {
  const dot = file.name.lastIndexOf('.');
  const rawExt = dot > 0 ? file.name.slice(dot + 1) : '';
  const ext = /^[a-z0-9]{1,5}$/i.test(rawExt) ? rawExt.toLowerCase() : 'bin';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${userId}/${stamp}-${index}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
}

export function describeAttachmentProblem(file: File): string | null {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    const mb = Math.ceil(file.size / (1024 * 1024));
    return `${file.name} is ${mb}MB — the limit is 10MB. A screenshot should fit easily.`;
  }
  if (file.size === 0) return `${file.name} is empty.`;
  return null;
}

/**
 * A message for the sheet when a send is rejected.
 *
 * The first version said "check your connection" for every failure, which is
 * exactly wrong when the server answered — it points the user at their wifi
 * for a problem that is ours. Connection problems never reach here now (they
 * queue), so what's left is the server saying no, and the common case is the
 * feedback migration not having been run on this project yet.
 */
export function describeSendError(e: unknown): string {
  const err = (e ?? {}) as { code?: string; message?: string; status?: number };
  const msg = `${err.message ?? ''}`.toLowerCase();
  if (
    err.code === 'PGRST205' ||
    err.code === '42P01' ||
    msg.includes('could not find the table') ||
    msg.includes('does not exist')
  ) {
    return "Feedback isn't switched on for this server yet — the feedback database migration hasn't been run.";
  }
  if (err.code === '42501' || msg.includes('row-level security') || msg.includes('permission denied')) {
    return "The server refused this — a permissions problem on the feedback table, not your connection.";
  }
  if (e instanceof Error && e.message) return e.message;
  if (err.message) return `Couldn't send: ${err.message}`;
  return "Couldn't send that. It wasn't your connection — try again in a moment.";
}

export interface SendFeedbackInput {
  kind: FeedbackKind;
  message: string;
  files: File[];
  screen: string;
}

export interface SendFeedbackResult {
  /** True when the report is banked on the device and will go when signal returns. */
  queued: boolean;
  /** Attachments that could not be uploaded. The message is sent regardless. */
  failedAttachments: string[];
}

/**
 * Bank the report on the device for the outbox to replay.
 *
 * Attachment bytes go into IndexedDB first: only once they are safe is the
 * queue entry written, so an entry can never reference a file that was never
 * stored. A file that won't store (no IndexedDB, no room) is dropped from the
 * report rather than losing the whole thing — the words are the part that
 * matters.
 */
async function queueFeedback(
  userId: string,
  input: SendFeedbackInput,
  message: string
): Promise<SendFeedbackResult> {
  const attachments: { blobId: string; name: string; type: string }[] = [];
  const failedAttachments: string[] = [];
  for (const file of input.files.slice(0, MAX_ATTACHMENTS)) {
    try {
      const blobId = await putBlob(file);
      attachments.push({ blobId, name: file.name, type: file.type });
    } catch {
      failedAttachments.push(file.name);
    }
  }
  enqueue(userId, {
    kind: 'feedback',
    row: {
      id: crypto.randomUUID(),
      kind: input.kind,
      message,
      context: { ...collectContext(input.screen), queuedOffline: true },
    },
    attachments,
  });
  return { queued: true, failedAttachments };
}

/**
 * Send one piece of feedback.
 *
 * With signal, it goes straight out. Without it — or if the send dies on the
 * way — the report is queued on the device and replayed by the outbox when the
 * phone can reach the server again, the same guarantee a logged set gets. A
 * bug found in a basement gym is still a bug worth reporting, and asking
 * someone to remember it until they get home is asking to never hear about it.
 *
 * When online, a failed *attachment* upload still never blocks the report: the
 * words go regardless and the caller is told what didn't make it.
 */
export async function sendFeedback(
  input: SendFeedbackInput
): Promise<SendFeedbackResult> {
  const userId = await currentUserId();
  if (!userId) throw new Error('Sign in to send feedback');

  const message = input.message.trim();
  if (!message) throw new Error('Add a short description first');

  if (!isReachable()) return queueFeedback(userId, input, message);

  const attachments: string[] = [];
  const failedAttachments: string[] = [];

  try {
    for (const [i, file] of input.files.slice(0, MAX_ATTACHMENTS).entries()) {
      const path = storagePath(userId, file, i);
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type || undefined, upsert: false });
      // supabase-storage returns its error rather than throwing, so a
      // transport failure arrives as a value and has to be re-thrown to reach
      // the offline fallback below.
      if (isTransportError(error)) {
        reportNetworkFail();
        throw error;
      }
      if (error) failedAttachments.push(file.name);
      else attachments.push(path);
    }

    const { error } = await supabase.from('feedback').insert({
      user_id: userId,
      kind: input.kind,
      message,
      attachments,
      context: collectContext(input.screen),
    });
    if (error) throw error;
  } catch (e) {
    // Signal died part-way through. Bank the whole report and let the outbox
    // replay it rather than dropping it on the floor. Any attachment that did
    // upload before the connection went is left orphaned in the bucket, which
    // is only wasted space; re-sending the report whole is worth that.
    if (isTransportError(e)) {
      reportNetworkFail();
      return queueFeedback(userId, input, message);
    }
    throw e;
  }

  return { queued: false, failedAttachments };
}
