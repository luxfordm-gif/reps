// What we'll accept as a plan PDF, checked before pdf.js is handed the file.
//
// The upload screen has always promised "Max ~10MB" and never enforced it, so
// an oversized file went straight into the parser. pdf.js reads the whole thing
// into memory in the browser, and the browser in question is usually a phone in
// a gym — a file big enough to matter is one that takes the tab down rather than
// showing an error.

/** Matches what the upload screen tells the user. */
export const MAX_PLAN_PDF_BYTES = 10 * 1024 * 1024;

/**
 * Why this file can't be read as a plan, or null if it can.
 *
 * Only the two cases a byte count can settle. Whether it's really a PDF, and
 * whether there's any text in it to read, are the parser's to answer — and it
 * gives a better account of them than a guess from the file name would.
 */
export function describePlanFileProblem(file: { name: string; size: number }): string | null {
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > MAX_PLAN_PDF_BYTES) {
    const mb = Math.ceil(file.size / (1024 * 1024));
    return `${file.name} is ${mb}MB — the limit is 10MB. A plan is usually well under 1MB; if yours is a scan, a PDF exported from the original will be far smaller and reads better too.`;
  }
  return null;
}
