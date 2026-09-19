// Quick test harness — runs the parser against sample trainer PDF text content.
// Usage: npm test  —  or: node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/test-parser.mjs
import { parseTrainingPlan } from '../src/lib/parseTrainingPlan.ts';
import { FORMAT_A_TEXT, FORMAT_B_TEXT } from './fixtures/plans/trainer-formats.mjs';

// Format A — split-keyword day headers (PUSH / PULL / LEGS / UPPER / ARMS + Abdominals).
const sampleText = FORMAT_A_TEXT;

// Format B — day headers titled after the body part(s) each day trains
// (CHEST / LEGS / BACK / REAR DELT / ARMS / DELTS). These titles aren't split
// keywords, so they're recognised structurally: a short all-caps title line sitting
// directly above the table's "BODY PART … TEMPO NOTES" column header. The column
// header wraps ("REP" / "RANGE" on their own lines) exactly as pdf.js extracts it.
const bodyPartHeaderText = FORMAT_B_TEXT;

function report(label, text) {
  const result = parseTrainingPlan(text);
  console.log(`\n=== ${label} ===`);
  console.log(`Days: ${result.days.length}`);
  for (const d of result.days) {
    console.log(
      `  ${d.name}: ${d.exercises.length} exercises, ${d.inlineNotes.length} inline notes`
    );
  }
  console.log(`Warnings: ${result.warnings.length}`);
  console.log(`Unparsed lines: ${result.unparsedLines.length}`);
  if (result.unparsedLines.length) {
    for (const u of result.unparsedLines) console.log(' • ' + u);
  }
}

report('Format A — split keywords', sampleText);
report('Format B — body-part titles', bodyPartHeaderText);
