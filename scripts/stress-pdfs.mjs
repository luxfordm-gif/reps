// Stress-tests the plan-upload pipeline against real trainer PDFs.
//
// Usage:
//   node --experimental-strip-types --import ./scripts/register-ts.mjs \
//     scripts/stress-pdfs.mjs <file.pdf|directory>... [--dump] [--runs N]
//
// READ-ONLY BY CONSTRUCTION. This runs everything the Upload plan screen does
// between choosing a file and tapping "Save plan": text extraction, row
// reconstruction, parsing, and every derived figure the review screen shows
// (rest defaults, set-modifier overrides, superset pairing, blocking problems).
// It deliberately stops there. `savePlan` — the one step that writes to
// Supabase — is never imported, so no run of this script can touch an account's
// plans or logged sets. Keep it that way: this file must not import plansApi.
//
// What it reports per PDF: how long each stage took, what the parser found, and
// where it lost information — lines it couldn't read, days with no exercises,
// and rows missing the fields the logger needs.

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { reconstructRows } from '../src/lib/reconstructPdfRows.ts';
import { parseTrainingPlan } from '../src/lib/parseTrainingPlan.ts';
import { parseSetMods } from '../src/lib/parseSetMods.ts';
import { restSecondsForExercises } from '../src/lib/restDefaults.ts';
import { normalizePositions, planProblems, withUids } from '../src/lib/planRepair.ts';

/** The standard fonts the app serves, read straight from the package here.
 *  A plan names Helvetica without embedding it, and the character widths are
 *  what put each word in a column — so the corpus has to be read with the same
 *  font data the browser gets, or it isn't reading what users read. */
const STANDARD_FONT_DATA_URL = fileURLToPath(
  new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)
);

const args = process.argv.slice(2);
const dump = args.includes('--dump');
const runsFlag = args.indexOf('--runs');
const RUNS = runsFlag >= 0 ? Math.max(1, parseInt(args[runsFlag + 1], 10) || 1) : 1;
const inputs = args.filter((a, i) => !a.startsWith('--') && !(runsFlag >= 0 && i === runsFlag + 1));

async function collectPdfs(paths) {
  const out = [];
  for (const p of paths) {
    const s = await stat(p);
    if (s.isDirectory()) {
      for (const entry of (await readdir(p)).sort()) {
        if (extname(entry).toLowerCase() === '.pdf') out.push(join(p, entry));
      }
    } else {
      out.push(p);
    }
  }
  return out;
}

/** The Node-side twin of extractPdfText: the same pdf.js build (legacy, the one
 *  the app ships) and the same positioned-text reconstruction, without the Vite
 *  `?url` worker import that only resolves in the browser. */
async function extractLines(data) {
  const pdf = await pdfjsLib.getDocument({
    data,
    useSystemFonts: false,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
  }).promise;
  const lines = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const positioned = [];
    for (const item of content.items) {
      if (!item.str || !item.str.trim()) continue;
      positioned.push({ x: item.transform[4], y: item.transform[5], str: item.str, width: item.width });
    }
    lines.push(...reconstructRows(positioned));
  }
  return { lines, pages: pdf.numPages };
}

/** Everything the review screen derives from a parsed plan. Runs for its side
 *  effects — we're checking it doesn't throw on messy input, and counting what
 *  it surfaces to the user. */
function reviewScreenWork(parsed) {
  const normalized = normalizePositions(withUids(parsed));
  let restCount = 0;
  let overrideCount = 0;
  let supersetCount = 0;
  let weeklyAltCount = 0;
  for (const day of normalized.days) {
    const rests = restSecondsForExercises(
      day.exercises.map((e) => ({
        name: e.name,
        notes: e.notes,
        supersetGroup: e.supersetGroup ?? null,
      }))
    );
    restCount += rests.filter((r) => r != null).length;
    for (const e of day.exercises) {
      if (parseSetMods(e.notes ?? '', e.totalSets ?? 0).bySetIndex.size > 0) overrideCount += 1;
      if (e.supersetGroup != null) supersetCount += 1;
      if (e.weeklyAlternative) weeklyAltCount += 1;
    }
  }
  return {
    problems: planProblems(normalized),
    restCount,
    overrideCount,
    supersetCount,
    weeklyAltCount,
  };
}

/** Rows the logger can't fully drive: a missing set count or rep range means the
 *  user has to fix the row by hand before the plan is usable. */
function incompleteRows(parsed) {
  const out = [];
  for (const day of parsed.days) {
    for (const e of day.exercises) {
      const missing = [];
      if (e.totalSets == null) missing.push('sets');
      if (!e.repRange) missing.push('reps');
      if (e.repRangeUncertain) missing.push('reps?');
      if (e.tempoUncertain) missing.push('tempo?');
      if (missing.length) out.push(`${day.name} › ${e.name} (${missing.join(', ')})`);
    }
  }
  return out;
}

function ms(n) {
  return `${n.toFixed(1)}ms`;
}

const totals = { pdfs: 0, days: 0, exercises: 0, warnings: 0, unparsed: 0, failures: 0 };

const files = await collectPdfs(inputs);
if (files.length === 0) {
  console.error('No PDFs given. Usage: stress-pdfs.mjs <file.pdf|directory>... [--dump] [--runs N]');
  process.exit(1);
}

for (const file of files) {
  const label = basename(file);
  const bytes = await readFile(file);
  console.log(`\n=== ${label} — ${(bytes.length / 1024).toFixed(1)}KB ===`);

  let extractMs = Infinity;
  let parseMs = Infinity;
  let reviewMs = Infinity;
  let lines;
  let pages;
  let parsed;
  let review;

  try {
    for (let run = 0; run < RUNS; run++) {
      // Each run gets its own copy: pdf.js transfers the buffer to its worker.
      const t0 = performance.now();
      const extracted = await extractLines(new Uint8Array(bytes));
      const t1 = performance.now();
      parsed = parseTrainingPlan(extracted.lines.join('\n'));
      const t2 = performance.now();
      review = reviewScreenWork(parsed);
      const t3 = performance.now();
      // Report the best run: the slowest is dominated by first-run JIT warmup.
      extractMs = Math.min(extractMs, t1 - t0);
      parseMs = Math.min(parseMs, t2 - t1);
      reviewMs = Math.min(reviewMs, t3 - t2);
      lines = extracted.lines;
      pages = extracted.pages;
    }
  } catch (e) {
    totals.failures += 1;
    console.log(`  THREW: ${e instanceof Error ? e.stack : e}`);
    continue;
  }

  if (dump) {
    console.log('--- reconstructed lines ---');
    for (const l of lines) console.log(`  | ${l}`);
    console.log('--- end ---');
  }

  const exercises = parsed.days.reduce((n, d) => n + d.exercises.length, 0);
  totals.pdfs += 1;
  totals.days += parsed.days.length;
  totals.exercises += exercises;
  totals.warnings += parsed.warnings.length;
  totals.unparsed += parsed.unparsedLines.length;

  console.log(
    `  ${pages} page(s), ${lines.length} lines · extract ${ms(extractMs)} · parse ${ms(parseMs)} · review ${ms(reviewMs)}`
  );
  console.log(`  Days: ${parsed.days.length} · Exercises: ${exercises}`);
  for (const d of parsed.days) {
    const wk = d.weekIndex != null ? ` [week ${d.weekIndex}]` : '';
    const ref = d.referenceOnly ? ' [reference]' : '';
    console.log(`    • ${d.name}${wk}${ref}: ${d.exercises.length} exercises, ${d.inlineNotes.length} notes`);
  }
  console.log(
    `  Rest set on ${review.restCount}/${exercises} · set overrides ${review.overrideCount} · supersets ${review.supersetCount} · weekly alts ${review.weeklyAltCount}`
  );

  const incomplete = incompleteRows(parsed);
  if (incomplete.length) {
    console.log(`  Incomplete rows (${incomplete.length}):`);
    for (const r of incomplete) console.log(`    ! ${r}`);
  }
  if (parsed.warnings.length) {
    console.log(`  Warnings (${parsed.warnings.length}):`);
    for (const w of parsed.warnings) console.log(`    ⚠ ${w}`);
  }
  if (review.problems.length) {
    console.log(`  Blocks save (${review.problems.length}):`);
    for (const p of review.problems) console.log(`    ✗ ${p}`);
  }
  if (parsed.unparsedLines.length) {
    console.log(`  Unparsed lines (${parsed.unparsedLines.length}):`);
    for (const u of parsed.unparsedLines) console.log(`    ? ${u}`);
  }
}

console.log(
  `\n=== TOTAL: ${totals.pdfs} parsed, ${totals.failures} threw · ${totals.days} days · ${totals.exercises} exercises · ${totals.warnings} warnings · ${totals.unparsed} unparsed lines ===`
);
