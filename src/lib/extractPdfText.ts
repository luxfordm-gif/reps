// Extract text from a PDF File using pdfjs-dist. We use the page text-content
// items' transform (x/y) coordinates to reconstruct the table rows, since
// trainer plans are tabular and naive text extraction scrambles columns and
// splits wrapped cells (long exercise names / notes) away from their row.
//
// pdf.js ships two builds, and we load the *legacy* one deliberately. The
// default build is compiled for the very newest browsers: getDocument itself
// calls Promise.withResolvers — Safari only got that in 17.4, March 2024 — and
// the parser goes on to use Math.sumPrecise, Uint8Array.toBase64 and
// AbortSignal.any, all newer still. On a phone a year or two behind, every
// upload died inside pdf.js with "undefined is not a function" before a byte of
// the plan had been read, and that raw browser error was what the screen showed.
// The legacy build is the same parser, transpiled with its polyfills, and it's
// the build the PDF corpus tests already run under Node — so what we test is now
// what we ship.
//
// That build can't cover everything, though. getTextContent reads a page with
// `for await (const value of readableStream)`, and a ReadableStream only became
// async-iterable in Safari 17.4 — which is a property of the browser's stream,
// not of the language, so no amount of transpiling supplies it. We add it
// ourselves before the reader loads; see ./streamAsyncIterator.
//
// It's also ~1.4MB, and this is the only screen that needs it, so it loads on
// demand rather than riding in the app bundle.

import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { reconstructRows, type PositionedText } from './reconstructPdfRows';
import { installStreamAsyncIterator } from './streamAsyncIterator';

type Pdfjs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

let loading: Promise<Pdfjs> | null = null;

function loadPdfjs(): Promise<Pdfjs> {
  if (!loading) {
    // Before the reader, not after: pdf.js reaches for the stream's async
    // iterator on the first page it reads, and an older Safari hasn't got one.
    installStreamAsyncIterator();
    loading = import('pdfjs-dist/legacy/build/pdf.mjs')
      .then((lib) => {
        lib.GlobalWorkerOptions.workerSrc = workerUrl;
        return lib;
      })
      .catch((cause) => {
        // A failed load must not be remembered: picking the file again on a
        // better connection should get a fresh attempt, not the old rejection.
        loading = null;
        throw new Error(
          "Couldn't load the PDF reader — check your connection and try again.",
          { cause }
        );
      });
  }
  return loading;
}

/**
 * Start fetching the reader before there's a file to read.
 *
 * The upload screen calls this when it opens. Reading a plan takes about a
 * fifth of a second once the reader is here, but fetching the reader is 1-4
 * seconds on gym signal, and it used to be spent staring at the file picker's
 * drop zone. Spent instead while someone hunts through Files for their plan,
 * it's usually over before they've chosen one. Failure is silent on purpose:
 * extractPdfText tries again on the real upload, and has something to say if
 * it fails then.
 */
export function prewarmPdfReader(): void {
  loadPdfjs().catch(() => {});
}

/**
 * What to tell someone when pdf.js won't read their file.
 *
 * Whatever comes out of here lands in the red box under the file picker, so it
 * has to say what they can do about it. pdf.js's own errors are named rather
 * than typed in any way we can switch on, and its message text is written for
 * developers, so we translate the cases a trainer's plan actually hits.
 */
function describeReadFailure(err: unknown): Error {
  const name = err instanceof Error ? err.name : '';
  const detail = err instanceof Error ? err.message : String(err);
  if (name === 'PasswordException') {
    return new Error(
      'That PDF is password-protected. Save an unlocked copy and upload that instead.'
    );
  }
  if (name === 'InvalidPDFException' || name === 'MissingPDFException') {
    return new Error(
      "That file isn't a PDF Reps can read — it may be damaged, or not a PDF at all."
    );
  }
  if (err instanceof TypeError || err instanceof ReferenceError) {
    // The browser is missing something pdf.js needs. Nothing about the plan is
    // wrong, so don't send them back to the file picker to try another file.
    return new Error(
      `This browser can't run the PDF reader (${detail}). Updating it, or opening Reps in another browser, should fix it.`
    );
  }
  return new Error(`Couldn't read that PDF (${detail}).`);
}

/**
 * Where the build serves pdf.js's standard fonts (see vite.config.ts).
 *
 * A plan PDF names Helvetica and leaves it out of the file — that's what every
 * tool a trainer exports from does — so pdf.js needs a copy of its own to know
 * how wide each character is. Character widths are how we know where a word
 * sits on the page, and where it sits is how we know which column it's in.
 */
const STANDARD_FONT_DATA_URL = `${import.meta.env.BASE_URL}assets/standard_fonts/`;

export async function extractPdfText(file: File): Promise<string> {
  const pdfjsLib = await loadPdfjs();
  const buffer = await file.arrayBuffer();
  const allLines: string[] = [];

  try {
    const pdf = await pdfjsLib.getDocument({
      data: buffer,
      standardFontDataUrl: STANDARD_FONT_DATA_URL,
      // Left to itself, pdf.js measures a font the PDF didn't embed using
      // whichever Helvetica the phone happens to have — so the same plan is
      // measured slightly differently on an iPhone, a Pixel and the machine
      // the corpus tests run on, and the column boundaries move with it. The
      // fonts above ship with the reader and are the ones those tests measure
      // with, so this pins every device to them.
      useSystemFonts: false,
    }).promise;

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const items = content.items as Array<{ str?: string; transform?: number[] }>;

      const positioned: PositionedText[] = [];
      for (const item of items) {
        // Marked-content items carry no text or position at all.
        if (!item.str || !item.str.trim() || !item.transform) continue;
        positioned.push({ x: item.transform[4], y: item.transform[5], str: item.str });
      }

      // Column geometry is per-page (headers repeat on each page), so reconstruct
      // each page independently.
      allLines.push(...reconstructRows(positioned));
    }
  } catch (err) {
    throw describeReadFailure(err);
  }

  if (allLines.length === 0) {
    throw new Error(
      "There's no text in that PDF — it looks like a scan or a photo of a plan. Ask your trainer for the file they exported, and Reps can read that."
    );
  }

  return allLines.join('\n');
}
