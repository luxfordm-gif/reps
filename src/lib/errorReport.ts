// The block of detail under an error message, written to be copied out of the
// app and pasted into a message.
//
// A beta tester's bug report is whatever their thumb can manage in a gym, and
// "the PDF thing didn't work" costs a day of back-and-forth. The last one took
// four: the screen said what had gone wrong in the browser's words and nothing
// about which browser, so the first thing anyone could do was guess. What
// settles it is boring — the iOS version, whether the app was opened from the
// home screen, which build was running, what the app was doing when it stopped.
// All of it is known at the moment of failure and none of it survives a
// retelling, so we write it down and make it one tap to send.
//
// Deliberately not the feedback sheet's collectContext, which reaches Supabase
// through its module and so can't be read by a test. The version comes from the
// changelog either way, which is the app's one answer to "which build is this".

import { CHANGELOG } from './changelog';

/** What went wrong, from the point of view of the code that caught it. */
export interface ErrorFacts {
  /**
   * A short stable slug for this kind of failure — `browser-too-old`,
   * `plan-save`. Wording drifts as we rewrite messages; this doesn't, so two
   * reports six months apart are still comparable.
   */
  code: string;
  /** What the app was trying to do, in a few plain words. */
  doing: string;
  /** Whatever was thrown. Its name and message go in verbatim. */
  cause?: unknown;
  /** The file in hand, when there was one. */
  file?: { name: string; size: number } | null;
}

/** What the app knew about itself when it failed. */
export interface ReportEnvironment {
  version: string;
  /** When this bundle was built — see __BUILD_STAMP__ in vite.config.ts. */
  build: string;
  userAgent: string;
  viewport: string;
  /** Opened from the home screen rather than a browser tab. */
  installed: boolean;
  online: boolean;
  /** ISO 8601. */
  at: string;
}

/** pdf.js messages can run long, and a wall of text doesn't get pasted. */
const MAX_CAUSE_CHARS = 300;

export function readEnvironment(): ReportEnvironment {
  const w = typeof window === 'undefined' ? null : window;
  const nav = w?.navigator as (Navigator & { standalone?: boolean }) | undefined;
  let installed = false;
  try {
    installed = nav?.standalone === true || w?.matchMedia?.('(display-mode: standalone)').matches === true;
  } catch {
    // matchMedia can throw on an unknown feature query in older browsers —
    // which is exactly the kind of browser this report is written for.
  }
  return {
    version: CHANGELOG[0]?.version ?? 'unknown',
    build: typeof __BUILD_STAMP__ === 'string' ? __BUILD_STAMP__ : 'dev',
    userAgent: nav?.userAgent ?? 'unknown',
    viewport: w ? `${w.innerWidth}x${w.innerHeight}@${w.devicePixelRatio ?? 1}` : 'unknown',
    installed,
    online: nav?.onLine ?? true,
    at: new Date().toISOString(),
  };
}

/**
 * The phone, in the words someone would use to describe it.
 *
 * The user-agent string goes in the report too, so this doesn't have to be
 * exhaustive — it has to put the one number that usually explains everything,
 * the OS version, on a line you can read at a glance. Anything it can't place
 * falls through to the raw string below it, which loses nothing.
 */
export function describeDevice(ua: string): string {
  const parts: string[] = [];

  const ios = /(iPhone|iPad|iPod).+?OS (\d+)[._](\d+)/.exec(ua);
  const android = /Android (\d+(?:\.\d+)?)/.exec(ua);
  const mac = /Mac OS X (\d+)[._](\d+)/.exec(ua);
  if (ios) {
    // An iPad reports "CPU OS 17_4" and runs iPadOS; calling that iOS in a bug
    // report sends whoever reads it looking at the wrong release notes.
    parts.push(ios[1], `${ios[1] === 'iPad' ? 'iPadOS' : 'iOS'} ${ios[2]}.${ios[3]}`);
  } else if (android) {
    parts.push(`Android ${android[1]}`);
  } else if (mac) {
    parts.push(`macOS ${mac[1]}.${mac[2]}`);
  } else if (/Windows NT [\d.]+/.test(ua)) {
    parts.push('Windows');
  }

  // Order matters: every iOS browser says "Safari" at the end of its string,
  // so the ones pretending to be something else have to be asked first.
  const browser =
    /(?:CriOS|Chrome)\/(\d+)/.exec(ua)?.[0].replace(/^CriOS/, 'Chrome') ??
    /(?:FxiOS|Firefox)\/(\d+)/.exec(ua)?.[0].replace(/^FxiOS/, 'Firefox') ??
    /Edg(?:iOS|A|)\/(\d+)/.exec(ua)?.[0].replace(/^Edg(?:iOS|A)?/, 'Edge') ??
    (/Safari\//.test(ua) ? `Safari ${/Version\/(\d+(?:\.\d+)?)/.exec(ua)?.[1] ?? ''}`.trim() : null);
  if (browser) parts.push(browser.replace('/', ' '));

  return parts.length ? parts.join(' · ') : 'unknown device';
}

/** A size a person can read, at the precision a person cares about. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

/** The thrown thing, named and quoted, short enough to paste. */
export function describeCause(cause: unknown): string {
  let text: string;
  if (cause instanceof Error) {
    text = cause.name && cause.name !== 'Error' ? `${cause.name}: ${cause.message}` : cause.message;
  } else if (cause === undefined || cause === null) {
    return 'none';
  } else {
    text = String(cause);
  }
  text = text.replace(/\s+/g, ' ').trim();
  if (!text) return 'none';
  return text.length > MAX_CAUSE_CHARS ? `${text.slice(0, MAX_CAUSE_CHARS)}…` : text;
}

/**
 * The report itself: one `key: value` per line, in the order someone reading it
 * would want them, with the long user-agent string last so the useful lines are
 * all visible before a message app folds the rest away.
 */
export function buildErrorReport(
  facts: ErrorFacts,
  env: ReportEnvironment = readEnvironment()
): string {
  const lines = [
    `Reps ${env.version} — ${facts.doing} failed`,
    `build: ${env.build}`,
    `code: ${facts.code}`,
    `error: ${describeCause(facts.cause)}`,
  ];
  if (facts.file) {
    lines.push(`file: ${facts.file.name} (${formatBytes(facts.file.size)})`);
  }
  lines.push(
    `device: ${describeDevice(env.userAgent)}`,
    `opened: ${env.installed ? 'home screen' : 'browser tab'}, ${env.online ? 'online' : 'offline'}`,
    `screen: ${env.viewport}`,
    `when: ${env.at}`,
    `ua: ${env.userAgent}`
  );
  return lines.join('\n');
}
