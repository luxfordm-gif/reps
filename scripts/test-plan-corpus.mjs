// The upload parser's scoreboard.
//
// Every plan format we've ever had to read is listed here with what it should
// produce. The parser is judged against all of them at once, so widening it to
// fit a new trainer's PDF can't quietly break the one it already handled.
//
// Two kinds of fixture:
//   • text  — the raw extracted text of a plan, inlined. This is what the app
//             stores in plans.raw_text, so a real upload can be turned into a
//             fixture by pasting its raw_text here.
//   • pdf   — a file under fixtures/plans, run through the same reconstruction
//             the app does, which also covers extraction and row-stitching.
//
// `floor` is the score this fixture is already known to reach. It only ever goes
// up: that's what makes this a ratchet rather than a wish list. A fixture scoring
// below its floor fails the run.
//
// Usage: npm test  —  or: node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/test-plan-corpus.mjs

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { parseTrainingPlan } from '../src/lib/parseTrainingPlan.ts';
import { reconstructRows } from '../src/lib/reconstructPdfRows.ts';
import { FORMAT_A_TEXT, FORMAT_B_TEXT } from './fixtures/plans/trainer-formats.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PDF_DIR = join(HERE, 'fixtures', 'plans');

/**
 * @typedef {object} Fixture
 * @property {string} name
 * @property {'text'|'pdf'} kind
 * @property {string} source          text body, or pdf filename
 * @property {string[]} days          expected day names, in order
 * @property {number} exercises       expected total exercise count
 * @property {number} floor           lowest acceptable score (0-1)
 * @property {string} [note]          why the floor isn't 1
 */

/** @type {Fixture[]} */
const CORPUS = [
  {
    name: 'trainer-format-a (split keywords)',
    kind: 'text',
    source: FORMAT_A_TEXT,
    days: ['Push', 'Pull', 'Legs', 'Upper', 'Arms', 'Abs'],
    exercises: 42,
    floor: 1,
  },
  {
    name: 'trainer-format-b (body-part titles)',
    kind: 'text',
    source: FORMAT_B_TEXT,
    days: ['Chest', 'Legs', 'Back / Rear Delt', 'Arms', 'Delts'],
    exercises: 11,
    floor: 1,
  },
  {
    name: 'plan-1 beginner full body (prose rows)',
    kind: 'pdf',
    source: 'plan-1-beginner-full-body.pdf',
    days: ['Day 1', 'Day 2', 'Day 3'],
    exercises: 15,
    floor: 1,
  },
  {
    name: 'plan-2 bro split (weekday headers)',
    kind: 'pdf',
    source: 'plan-2-bro-split.pdf',
    days: ['Monday - Chest', 'Tuesday - Back', 'Wednesday - Legs', 'Thursday - Shoulders', 'Friday - Arms'],
    exercises: 25,
    floor: 1,
  },
  {
    name: 'plan-3 advanced ppl (lettered supersets, RPE column)',
    kind: 'pdf',
    source: 'plan-3-advanced-ppl.pdf',
    days: ['Push A', 'Pull A', 'Legs A'],
    exercises: 20,
    floor: 1,
  },
  {
    name: 'plan-4 weekly grid (day per column)',
    kind: 'pdf',
    source: 'plan-4-weekly-grid.pdf',
    days: ['Monday - Upper Push', 'Tuesday - Lower', 'Thursday - Upper Pull', 'Friday - Full Body'],
    exercises: 26,
    floor: 1,
    note: "Wednesday is a rest day with nothing loggable, so it isn't a training day.",
  },
  {
    name: 'plan-5 messy upper/lower (freeform notes)',
    kind: 'pdf',
    source: 'plan-5-messy-upper-lower.pdf',
    days: ['Upper 1', 'Lower 1', 'Upper 2', 'Lower 2'],
    exercises: 21,
    floor: 1,
  },
  {
    name: 'plan-6 drop set intensifier (unknown column names)',
    kind: 'pdf',
    source: 'plan-6-drop-set-intensifier.pdf',
    days: ['Day 1 - Chest & Triceps', 'Day 2 - Back & Biceps', 'Day 3 - Legs'],
    exercises: 17,
    floor: 1,
  },
  {
    name: 'plan-7 station supersets (paired A1/A2 rows)',
    kind: 'pdf',
    source: 'plan-7-station-supersets.pdf',
    days: ['Session A - Push', 'Session B - Pull'],
    exercises: 12,
    floor: 1,
  },
  {
    name: 'plan-8 giant sets (bulleted groups, rounds not sets)',
    kind: 'pdf',
    source: 'plan-8-giant-sets.pdf',
    days: ['Day 1 - Upper Body', 'Day 2 - Lower Body'],
    exercises: 26,
    floor: 1,
  },
  {
    name: 'plan-9 two week rotation (Week A / Week B)',
    kind: 'pdf',
    source: 'plan-9-two-week-rotation.pdf',
    days: [
      'Week A - Push',
      'Week A - Pull',
      'Week A - Legs',
      'Week B - Push',
      'Week B - Pull',
      'Week B - Legs',
    ],
    exercises: 34,
    floor: 1,
  },
  {
    name: 'plan-10 basic with typos (sets x reps prose)',
    kind: 'pdf',
    source: 'plan-10-basic-with-typos.pdf',
    days: ['Day 1 - Upper Body', 'Day 2 - Lower Body', 'Day 3 - Full Body'],
    exercises: 18,
    floor: 1,
  },
  {
    name: 'plan-11 banded body part (body part is the section)',
    kind: 'pdf',
    source: 'plan-11-banded-body-part.pdf',
    days: ['Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Core'],
    exercises: 26,
    floor: 1,
  },
  {
    name: 'plan-12 vertical labels (body part bands inside a session)',
    kind: 'pdf',
    source: 'plan-12-vertical-labels.pdf',
    days: ['Session A - Upper Body', 'Session B - Lower Body'],
    exercises: 25,
    floor: 1,
  },
  {
    name: 'plan-13 per-set log grid (a column per set)',
    kind: 'pdf',
    source: 'plan-13-per-set-log-grid.pdf',
    days: ['Push - Chest & Triceps', 'Pull - Back & Biceps', 'Legs', 'Shoulders & Core'],
    exercises: 20,
    floor: 0.8,
    note: 'A filled-in log, not a prescription: each column is one set written as load x reps.',
  },
];

async function pdfText(file) {
  const data = new Uint8Array(await readFile(join(PDF_DIR, file)));
  const pdf = await pdfjsLib.getDocument({ data, useSystemFonts: false }).promise;
  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const content = await (await pdf.getPage(p)).getTextContent();
    const positioned = [];
    for (const item of content.items) {
      if (!item.str || !item.str.trim()) continue;
      positioned.push({ x: item.transform[4], y: item.transform[5], str: item.str });
    }
    lines.push(...reconstructRows(positioned));
  }
  return lines.join('\n');
}

/**
 * How much of the plan came through, as a single number.
 *
 * Days and exercises are weighted equally: a parse that finds every exercise but
 * files them under one day is as wrong, for training off, as one that finds the
 * days and loses half the movements. Extra days count against it too — a
 * mis-detected header splits a day in two.
 */
function score(parsed, expected) {
  const gotDays = parsed.days.map((d) => d.name);
  const wantDays = expected.days;
  let dayHits = 0;
  for (const w of wantDays) if (gotDays.includes(w)) dayHits += 1;
  const dayScore = wantDays.length === 0 ? 1 : dayHits / Math.max(wantDays.length, gotDays.length);

  const gotEx = parsed.days.reduce((n, d) => n + d.exercises.length, 0);
  const exScore = expected.exercises === 0 ? 1 : Math.min(gotEx, expected.exercises) / Math.max(expected.exercises, gotEx);

  return { total: (dayScore + exScore) / 2, dayScore, exScore, gotDays, gotEx };
}

const results = [];
let failed = 0;

for (const fx of CORPUS) {
  const text = fx.kind === 'pdf' ? await pdfText(fx.source) : fx.source;
  let parsed;
  try {
    parsed = parseTrainingPlan(text);
  } catch (e) {
    console.log(`\n✗ ${fx.name}\n  THREW: ${e instanceof Error ? e.message : e}`);
    failed += 1;
    continue;
  }
  const s = score(parsed, fx);
  const ok = s.total >= fx.floor - 1e-9;
  if (!ok) failed += 1;
  results.push({ fx, s, ok, parsed });

  const pct = (n) => `${(n * 100).toFixed(0)}%`;
  console.log(`\n${ok ? '✓' : '✗'} ${fx.name}`);
  console.log(
    `   score ${pct(s.total)} (floor ${pct(fx.floor)}) · days ${pct(s.dayScore)} · exercises ${s.gotEx}/${fx.exercises}`
  );
  if (fx.note) console.log(`   note: ${fx.note}`);
  const missing = fx.days.filter((d) => !s.gotDays.includes(d));
  const extra = s.gotDays.filter((d) => !fx.days.includes(d));
  if (missing.length) console.log(`   missing days: ${missing.join(', ')}`);
  if (extra.length) console.log(`   unexpected days: ${extra.join(', ')}`);
  if (parsed.unparsedLines.length) {
    console.log(`   unparsed: ${parsed.unparsedLines.length} line(s)`);
  }
}

const mean = results.reduce((n, r) => n + r.s.total, 0) / (results.length || 1);
console.log(
  `\n=== corpus: ${results.filter((r) => r.ok).length}/${CORPUS.length} at or above floor · mean score ${(mean * 100).toFixed(1)}% ===`
);

if (failed > 0) {
  console.log(`\n${failed} fixture(s) below floor.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
