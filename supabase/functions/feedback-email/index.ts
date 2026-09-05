// Emails each piece of in-app feedback to you the moment it lands.
//
// Triggered by a Database Webhook on INSERT into public.feedback. Without this,
// feedback only exists as rows in a table you'd have to remember to check;
// with it, a tester's bug report is in your inbox before they've finished
// their set, with the screenshot or clip they attached as a clickable link.
//
// The attachments bucket is private on purpose (a screen recording can show
// someone's whole training history), so the email carries 7-day signed URLs
// rather than raw paths. Sending uses Resend — free tier is 100 emails a day,
// plenty for a beta.
//
// Setup (once), from the repo root with the Supabase CLI logged in:
//
//   1. Create a Resend account, verify a sender, copy the API key.
//   2. supabase secrets set \
//        RESEND_API_KEY=re_... \
//        FEEDBACK_TO=you@example.com \
//        FEEDBACK_FROM="Reps <feedback@yourdomain.com>" \
//        FEEDBACK_WEBHOOK_SECRET=$(openssl rand -hex 24)
//   3. supabase functions deploy feedback-email --no-verify-jwt
//      (--no-verify-jwt because the caller is the database, not a signed-in
//      user; the shared secret header below is what authenticates it.)
//   4. Dashboard → Database → Webhooks → Create:
//        table public.feedback, event INSERT, type "Supabase Edge Function",
//        function feedback-email, and add an HTTP header
//        x-webhook-secret: <the FEEDBACK_WEBHOOK_SECRET value>.
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import { createClient } from 'npm:@supabase/supabase-js@2';

interface FeedbackRow {
  id: string;
  user_id: string;
  kind: string;
  message: string;
  attachments: string[];
  context: Record<string, unknown>;
  created_at: string;
}

interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  record: FeedbackRow | null;
}

const KIND_LABEL: Record<string, string> = {
  bug: 'Something broke',
  plan_import: 'Plan import',
  idea: 'Idea',
  general: 'Something else',
};

const SIGNED_URL_SECONDS = 7 * 24 * 60 * 60;

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing secret ${name}`);
  return v;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  // The database is the only legitimate caller. Anyone else who finds the URL
  // gets nothing, and can't make us email ourselves junk.
  const expected = Deno.env.get('FEEDBACK_WEBHOOK_SECRET');
  if (expected && req.headers.get('x-webhook-secret') !== expected) {
    return new Response('forbidden', { status: 403 });
  }

  let payload: WebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response('bad payload', { status: 400 });
  }
  if (payload.type !== 'INSERT' || payload.table !== 'feedback' || !payload.record) {
    return new Response('ignored', { status: 200 });
  }
  const row = payload.record;

  const supabase = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));

  // Who sent it. Feedback is far more useful with a name to reply to.
  let sender = row.user_id;
  try {
    const { data } = await supabase.auth.admin.getUserById(row.user_id);
    if (data.user?.email) sender = data.user.email;
  } catch {
    // Fall back to the id.
  }

  // Signed links to whatever they attached.
  const links: { name: string; url: string }[] = [];
  for (const path of row.attachments ?? []) {
    const { data } = await supabase.storage
      .from('feedback')
      .createSignedUrl(path, SIGNED_URL_SECONDS);
    if (data?.signedUrl) links.push({ name: path.split('/').pop() ?? path, url: data.signedUrl });
  }

  const ctx = row.context ?? {};
  const kind = KIND_LABEL[row.kind] ?? row.kind;
  const subject = `[Reps feedback] ${kind}: ${row.message.slice(0, 60).replace(/\s+/g, ' ')}${
    row.message.length > 60 ? '…' : ''
  }`;

  const contextLines = [
    ['From', sender],
    ['Screen', String(ctx.screen ?? '')],
    ['App version', String(ctx.version ?? '')],
    ['Viewport', String(ctx.viewport ?? '')],
    ['Online when sent', ctx.queuedOffline ? 'No — queued and sent later' : 'Yes'],
    ['Device', String(ctx.userAgent ?? '')],
    ['Sent', row.created_at],
  ].filter(([, v]) => v);

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;color:#0a0a0a">
      <p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8e8e93;margin:0 0 6px">${escapeHtml(kind)}</p>
      <p style="font-size:16px;line-height:1.5;white-space:pre-wrap;margin:0 0 20px">${escapeHtml(row.message)}</p>
      ${
        links.length
          ? `<p style="margin:0 0 20px">${links
              .map((l) => `<a href="${l.url}" style="color:#0a0a0a">${escapeHtml(l.name)}</a>`)
              .join(' · ')}<br><span style="font-size:12px;color:#8e8e93">Links work for 7 days.</span></p>`
          : ''
      }
      <table style="font-size:13px;color:#8e8e93;border-collapse:collapse">
        ${contextLines
          .map(
            ([k, v]) =>
              `<tr><td style="padding:2px 12px 2px 0;vertical-align:top">${escapeHtml(k)}</td><td style="padding:2px 0;word-break:break-all">${escapeHtml(v)}</td></tr>`
          )
          .join('')}
      </table>
    </div>`;

  const text = [
    kind.toUpperCase(),
    '',
    row.message,
    '',
    ...links.map((l) => `${l.name}: ${l.url}`),
    links.length ? '' : null,
    ...contextLines.map(([k, v]) => `${k}: ${v}`),
  ]
    .filter((l) => l !== null)
    .join('\n');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env('FEEDBACK_FROM'),
      to: [env('FEEDBACK_TO')],
      subject,
      html,
      text,
      headers: { 'X-Entity-Ref-ID': row.id },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error('resend failed', res.status, body);
    // A non-2xx makes the webhook record the failure so it shows in the
    // dashboard's webhook logs; the row itself is safe in the table regardless.
    return new Response(`email failed: ${res.status}`, { status: 502 });
  }
  return new Response('ok', { status: 200 });
});
