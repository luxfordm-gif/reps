import { supabase, currentUserId } from './supabase';
import { CHANGELOG } from './changelog';

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
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
export const MAX_ATTACHMENTS = 3;

export const ACCEPTED_ATTACHMENT_TYPES =
  'image/png,image/jpeg,image/webp,image/heic,image/heif,image/gif,video/mp4,video/quicktime,video/webm';

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
    return `${file.name} is ${mb}MB — the limit is 50MB. A shorter clip should fit.`;
  }
  if (file.size === 0) return `${file.name} is empty.`;
  return null;
}

export interface SendFeedbackInput {
  kind: FeedbackKind;
  message: string;
  files: File[];
  screen: string;
}

export interface SendFeedbackResult {
  /** Attachments that could not be uploaded. The message is sent regardless. */
  failedAttachments: string[];
}

/**
 * Send one piece of feedback.
 *
 * Attachments are uploaded first, but a failed upload never blocks the report:
 * a bad connection in a basement gym is exactly when people find bugs, and the
 * words matter more than the video. Whatever did upload is attached, and the
 * caller is told what didn't so it can say so.
 */
export async function sendFeedback(
  input: SendFeedbackInput
): Promise<SendFeedbackResult> {
  const userId = await currentUserId();
  if (!userId) throw new Error('Sign in to send feedback');

  const message = input.message.trim();
  if (!message) throw new Error('Add a short description first');

  const attachments: string[] = [];
  const failedAttachments: string[] = [];

  for (const [i, file] of input.files.slice(0, MAX_ATTACHMENTS).entries()) {
    const path = storagePath(userId, file, i);
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { contentType: file.type || undefined, upsert: false });
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

  return { failedAttachments };
}
