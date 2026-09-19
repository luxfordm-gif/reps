// Layout recognition for trainer plans whose tables aren't the one shape the
// original parser was built around.
//
// parseTrainingPlan reads a specific table — BODY PART | EXERCISE | TOTAL SETS |
// REP RANGE | TEMPO | NOTES — and reads it very well, because it was written
// against real PDFs in exactly that form. The trouble is that every trainer
// lays a plan out differently, and we get no say in it: a beginner sheet writes
// "Goblet Squat - 3 sets of 10 reps" in prose, a bro split heads each day with a
// weekday and drops the body-part column, an advanced sheet adds an RPE column
// and letters its supersets A1/A2, and plenty of coaches just type "4x6" into a
// notes app. None of those parse, and hard-coding each one is how you end up
// with a parser that breaks on the next PDF.
//
// So this module doesn't recognise formats, it recognises *structure*:
//
//   1. If a day's table has a header row, learn the column order from it. That
//      turns "Exercise Sets Reps Tempo RPE Rest Coaching Notes" into a template
//      and reads every row beneath it positionally, whatever the columns are.
//   2. If there's no header, fall back to the shapes a rep prescription takes in
//      prose: "3 sets of 10 reps", "4x6", "3 x AMRAP", "3 rounds, 12 each".
//   3. Find day headers from that classification rather than from a list of
//      names: a short line that isn't itself a row, sitting directly on top of a
//      run of rows, is a day header — whether it says "Day 1", "MONDAY - CHEST",
//      "PUSH A" or "UPPER 1 (mon)".
//
// It deliberately produces raw rows rather than finished exercises: naming,
// casing, set schemes and superset resolution stay in parseTrainingPlan, so
// there's one place that decides what a row *means*.

/** One table row, still in the words the PDF used. */
export interface RawRow {
  name: string;
  totalSets: number | null;
  repRange: string;
  tempo: string | null;
  notes: string;
  bodyPart: string | null;
  /** Superset code from a lettered plan ("A1", "B2") — rows sharing a letter
   *  are performed together. Null when the plan doesn't letter its rows. */
  groupCode: string | null;
}

export interface RawDay {
  name: string;
  rows: RawRow[];
  notes: string[];
}

export interface LayoutResult {
  days: RawDay[];
  unparsed: string[];
}

// --- column templates -------------------------------------------------------

type ColumnKind =
  | 'name'
  | 'bodyPart'
  | 'sets'
  | 'reps'
  | 'tempo'
  | 'rest'
  | 'rpe'
  | 'weight'
  | 'notes';

// Header words we know how to place. Multi-word headers ("BODY PART", "REP
// RANGE", "TOTAL SETS", "COACHING NOTES") collapse because consecutive words
// mapping to the same kind are folded into one column.
const COLUMN_WORDS: Record<string, ColumnKind> = {
  BODY: 'bodyPart',
  PART: 'bodyPart',
  MUSCLE: 'bodyPart',
  GROUP: 'bodyPart',
  EXERCISE: 'name',
  EXERCISES: 'name',
  MOVEMENT: 'name',
  LIFT: 'name',
  TOTAL: 'sets',
  SET: 'sets',
  SETS: 'sets',
  WORKING: 'sets',
  REP: 'reps',
  REPS: 'reps',
  RANGE: 'reps',
  REPETITIONS: 'reps',
  TEMPO: 'tempo',
  REST: 'rest',
  RECOVERY: 'rest',
  RPE: 'rpe',
  INTENSITY: 'rpe',
  RIR: 'rpe',
  WEIGHT: 'weight',
  LOAD: 'weight',
  KG: 'weight',
  NOTES: 'notes',
  NOTE: 'notes',
  COACHING: 'notes',
  COMMENTS: 'notes',
  CUES: 'notes',
};

/**
 * Read a line as a table header, returning the column order it defines.
 *
 * Every word has to be one we know, so a line of real content can't be mistaken
 * for a header, and the result has to describe an exercise table — a name column
 * plus at least sets or reps. "WEEKS VOLUME" and "Client copy | Phase 1" fail
 * both tests.
 */
export function parseColumnTemplate(line: string): ColumnKind[] | null {
  const words = line.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 12) return null;
  const kinds: ColumnKind[] = [];
  for (const w of words) {
    const kind = COLUMN_WORDS[w.replace(/[^A-Z/]/g, '')];
    if (!kind) return null;
    if (kinds[kinds.length - 1] !== kind) kinds.push(kind);
  }
  if (!kinds.includes('name')) return null;
  if (!kinds.includes('sets') && !kinds.includes('reps')) return null;
  return kinds;
}

// --- cell shapes ------------------------------------------------------------

const SETS_RE = /^(\d{1,2})$/;
// "8-10", "12", "12/leg", "10each" — a count, optionally qualified.
const REPS_RE = /^(\d{1,3}(?:\s*-\s*\d{1,3})?)(?:\/[A-Za-z]+)?$/;
// Rep prescriptions that aren't a number at all.
const REPS_WORD_RE = /^(AMRAP|MAX|FAILURE)$/i;
const REPS_TWO_WORD_RE = /^(TO\s+FAILURE|MAX\s+REPS|MAX\s+HOLD|MAX\s+TIME|MAX\s+EFFORT)$/i;
// "3-1-1-0", "2-0-X-0", or four separate digits. "-" means the column is blank.
const TEMPO_RE = /^(\d|X){1}(-(\d|X)){3}$/i;
const BLANK_RE = /^[-–—]$/;
// "90s", "180s", "2min", "1:30"
const REST_RE = /^(\d{1,4}\s*(?:s|sec|secs|seconds|m|min|mins|minutes)|\d{1,2}:\d{2})$/i;
const RPE_RE = /^(\d{1,2}(?:\.\d)?)$/;
const WEIGHT_RE = /^(\d{1,4}(?:\.\d+)?\s*(?:kg|lb|lbs|%))$/i;
// "A1", "B2", "C" — a superset code ahead of the movement name.
const GROUP_CODE_RE = /^([A-Z])(\d{1,2})?$/;

/** Columns a row may simply not fill in. Sets and reps are the two that make a
 *  row an exercise, so those are never optional. */
const OPTIONAL_COLUMNS = new Set<ColumnKind>(['tempo', 'rest', 'rpe', 'weight']);

interface Consumed {
  value: string;
  next: number;
}

/** Take the tokens one column of `kind` occupies, starting at `i`. */
function consume(tokens: string[], i: number, kind: ColumnKind, isLast: boolean): Consumed | null {
  const t = tokens[i];
  // Running out of tokens is only legal for the notes column, which is empty far
  // more often than not — most rows carry no coaching note at all.
  if (t == null) return kind === 'notes' ? { value: '', next: i } : null;

  // Any column but the name can be left blank with a dash.
  if (BLANK_RE.test(t) && kind !== 'notes') return { value: '', next: i + 1 };

  switch (kind) {
    case 'sets':
      if (SETS_RE.test(t)) return { value: t, next: i + 1 };
      if (/^superset$/i.test(t)) return { value: t, next: i + 1 };
      return null;
    case 'reps': {
      if (REPS_RE.test(t)) {
        // "12 each", "10 each side" — the qualifier belongs with the count.
        if (/^(each|per|a)$/i.test(tokens[i + 1] ?? '')) {
          const third = tokens[i + 2] ?? '';
          const span = /^(side|leg|arm|way)$/i.test(third) ? 3 : 2;
          return { value: tokens.slice(i, i + span).join(' '), next: i + span };
        }
        return { value: t, next: i + 1 };
      }
      if (REPS_WORD_RE.test(t)) return { value: t, next: i + 1 };
      const pair = `${t} ${tokens[i + 1] ?? ''}`;
      if (REPS_TWO_WORD_RE.test(pair)) return { value: pair, next: i + 2 };
      return null;
    }
    case 'tempo': {
      if (TEMPO_RE.test(t)) return { value: t.replace(/-/g, ' '), next: i + 1 };
      if (/^N\/A$/i.test(t)) return { value: '', next: i + 1 };
      // Four loose digits, as pdf.js emits them for a spaced tempo cell.
      const four = tokens.slice(i, i + 4);
      if (four.length === 4 && four.every((x) => /^[\dX]$/i.test(x))) {
        return { value: four.join(' '), next: i + 4 };
      }
      return null;
    }
    case 'rest':
      if (REST_RE.test(t)) return { value: t, next: i + 1 };
      // "90 s" split across two tokens.
      if (/^\d{1,4}$/.test(t) && /^(s|sec|secs|min|mins)$/i.test(tokens[i + 1] ?? '')) {
        return { value: `${t}${tokens[i + 1]}`, next: i + 2 };
      }
      return null;
    case 'rpe':
      return RPE_RE.test(t) ? { value: t, next: i + 1 } : null;
    case 'weight':
      return WEIGHT_RE.test(t) ? { value: t, next: i + 1 } : null;
    case 'notes':
      // Notes run to the end of the line, and may legitimately be empty.
      return { value: tokens.slice(i).join(' '), next: tokens.length };
    default:
      return isLast ? { value: tokens.slice(i).join(' '), next: tokens.length } : null;
  }
}

/**
 * Read a row against a learned column template.
 *
 * The name is whatever sits before the value columns, so we slide the boundary
 * rightwards until every remaining column matches its expected shape. Requiring
 * the whole template to line up is what stops a wrapped coach note from being
 * read as an exercise: a note has numbers in it, but not in this order.
 */
export function matchTemplateRow(
  line: string,
  template: ColumnKind[],
  bodyParts: readonly string[] = []
): RawRow | null {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;
  const valueKinds = template.filter((k) => k !== 'name' && k !== 'bodyPart');
  if (valueKinds.length === 0) return null;

  for (let split = 1; split < tokens.length; split++) {
    let i = split;
    let ok = true;
    const cells: Partial<Record<ColumnKind, string>> = {};
    for (let c = 0; c < valueKinds.length; c++) {
      const kind = valueKinds[c];
      const got = consume(tokens, i, kind, c === valueKinds.length - 1);
      if (!got) {
        // Trainers leave the trimmings out on individual rows — no tempo on the
        // warm-up, no RPE on the finisher — while always writing the sets and
        // reps. So an extra column that doesn't match is treated as blank rather
        // than failing the row, which is what used to drop it on the floor.
        if (OPTIONAL_COLUMNS.has(kind)) continue;
        ok = false;
        break;
      }
      // A repeated kind (two notes columns) appends rather than overwrites.
      cells[kind] = cells[kind] ? `${cells[kind]} ${got.value}`.trim() : got.value;
      i = got.next;
    }
    // Every value column matched, and nothing was left dangling.
    if (!ok || i < tokens.length) continue;
    if (cells.sets == null && cells.reps == null) continue;

    const nameTokens = tokens.slice(0, split);
    const { groupCode, name } = splitGroupCode(nameTokens);
    // A movement is named, not numbered. Without this a wrapped note that opens
    // with figures ("1 X 8-10 REPS / 1 12-15 REPS BACK OFF") lines up against a
    // loose template and becomes an exercise of its own.
    if (!name || !/^[A-Za-z]/.test(name) || !/[A-Za-z]{2}/.test(name)) continue;
    // The body-part column sits ahead of the name and isn't a value column, so
    // it's still stuck to the front of it — peel it off if the table declared one.
    const { bodyPart, rest } = template.indexOf('bodyPart') < template.indexOf('name')
      ? splitLeadingBodyPart(name, bodyParts)
      : { bodyPart: null, rest: name };
    if (!rest) continue;
    return {
      name: rest,
      totalSets: toSets(cells.sets),
      repRange: cells.reps ?? '',
      tempo: cells.tempo ? cells.tempo : null,
      notes: joinNotes(cells),
      bodyPart,
      groupCode,
    };
  }
  return null;
}

/**
 * Take a known body part off the front of a name: "CHEST FLAT BENCH PRESS" →
 * "Chest" + "FLAT BENCH PRESS". Longest match first, so "REAR DELTS" wins over
 * a shorter entry that happens to be a prefix of it. Only what the caller
 * recognises is peeled — an unknown first word stays part of the name.
 */
function splitLeadingBodyPart(
  name: string,
  bodyParts: readonly string[]
): { bodyPart: string | null; rest: string } {
  const upper = name.toUpperCase();
  const sorted = [...bodyParts].sort((a, b) => b.length - a.length);
  for (const bp of sorted) {
    const head = bp.toUpperCase();
    if (upper === head) return { bodyPart: bp, rest: '' };
    if (upper.startsWith(`${head} `)) {
      return { bodyPart: bp, rest: name.slice(bp.length).trim() };
    }
  }
  return { bodyPart: null, rest: name };
}

/** "A1 Barbell Bench Press" → code A1, name "Barbell Bench Press". */
function splitGroupCode(nameTokens: string[]): { groupCode: string | null; name: string } {
  if (nameTokens.length >= 2 && GROUP_CODE_RE.test(nameTokens[0])) {
    return { groupCode: nameTokens[0].toUpperCase(), name: nameTokens.slice(1).join(' ') };
  }
  return { groupCode: null, name: nameTokens.join(' ') };
}

function toSets(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? null : n;
}

/** Fold the columns that aren't first-class fields into the coach notes, so
 *  nothing the trainer wrote is thrown away. */
function joinNotes(cells: Partial<Record<ColumnKind, string>>): string {
  const bits: string[] = [];
  if (cells.rpe) bits.push(`RPE ${cells.rpe}`);
  if (cells.rest) bits.push(`Rest ${cells.rest}`);
  if (cells.weight) bits.push(cells.weight);
  if (cells.notes) bits.push(cells.notes);
  return bits.join(' · ').trim();
}

// --- freeform shapes --------------------------------------------------------

// Units that mean the number is a duration, not a rep count — "2 x 30min zone 2"
// is a cardio instruction, not a set scheme.
const DURATION_UNIT = /^(min|mins|minute|minutes|hr|hour|hours|km|mile|miles)\b/i;

const PROSE_RE =
  /^(.+?)\s*[-–—:]?\s*(\d{1,2})\s*(?:x\s*)?sets?\s+of\s+(\d{1,3}(?:\s*-\s*\d{1,3})?|AMRAP|max)\s*(reps?|seconds?|secs?|s)?\b\s*(.*)$/i;

const COMPACT_RE =
  /^(.+?)\s*[-–—:]?\s*(\d{1,2})\s*x\s*(\d{1,3}(?:\s*-\s*\d{1,3})?|AMRAP|max)\s*(s|secs?|seconds?)?\b\s*(.*)$/i;

const ROUNDS_RE = /^(.+?)[,:]?\s*(\d{1,2})\s*rounds?\b[,\s]*(\d{1,3})\s*(?:reps?\s*)?(?:each|per)?\b\s*(.*)$/i;

/** "Barbell Bench Press 4 8-10 90s" with no header to tell us the columns. */
const BARE_RE =
  /^(.+?)\s+(\d{1,2})\s+(\d{1,3}(?:\s*-\s*\d{1,3})?|to\s+failure|AMRAP|max(?:\s+\w+)?)\b\s*(.*)$/i;

function cleanName(raw: string): string {
  return raw
    .replace(/[.…]+$/, '') // "OHP...." → "OHP"
    .replace(/\s*[-–—:,]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Read a row from a plan that has no table at all — a prose list, or a coach's
 * notes-app dump. Ordered most specific first: "3 sets of 10" can't be confused
 * with anything, "NAME 4 8-10" very nearly can, so it goes last.
 */
export function matchFreeformRow(line: string, bodyParts: readonly string[] = []): RawRow | null {
  const trimmed = line.trim();

  const prose = trimmed.match(PROSE_RE);
  if (prose) {
    const unit = prose[4] ?? '';
    const isTime = /^s(ec|econds?)?$/i.test(unit);
    return row(prose[1], prose[2], isTime ? `${prose[3]}s` : prose[3], prose[5]);
  }

  const compact = trimmed.match(COMPACT_RE);
  if (compact && !DURATION_UNIT.test(compact[5] ?? '')) {
    const isTime = Boolean(compact[4]);
    return row(compact[1], compact[2], isTime ? `${compact[3]}s` : compact[3], compact[5]);
  }

  const rounds = trimmed.match(ROUNDS_RE);
  if (rounds) return row(rounds[1], rounds[2], rounds[3], rounds[4]);

  const bare = trimmed.match(BARE_RE);
  if (bare && !DURATION_UNIT.test(bare[4] ?? '')) {
    // The name has to read like a name: letters, not a number or a fragment of
    // a sentence that happened to open with one.
    if (/^\d/.test(bare[1].trim())) return null;
    if (!/[A-Za-z]{2}/.test(bare[1])) return null;
    return row(bare[1], bare[2], bare[3], bare[4], bodyParts);
  }

  return null;
}

// A tempo cell that trailed the rep range with no header to announce it —
// "2 0 1 0" or "2-0-1-0", as the four-phase notation is always written.
const LEADING_TEMPO_RE = /^([\dX](?:[\s-][\dX]){3})(?:\s+(.*))?$/i;

function row(
  name: string,
  sets: string,
  reps: string,
  notes: string,
  bodyParts: readonly string[] = []
): RawRow | null {
  const { groupCode, name: coded } = splitGroupCode(cleanName(name).split(/\s+/));
  const { bodyPart, rest } = splitLeadingBodyPart(cleanName(coded), bodyParts);
  const cleaned = cleanName(rest);
  if (!cleaned || !/[A-Za-z]{2}/.test(cleaned)) return null;
  // Without a header we only find out a row had a tempo by looking at what came
  // after the reps; left alone it reads as the opening of the coach's note.
  const trailing = (notes ?? '').trim();
  const withTempo = trailing.match(LEADING_TEMPO_RE);
  return {
    name: cleaned,
    totalSets: toSets(sets),
    repRange: reps.replace(/\s+/g, ''),
    tempo: withTempo ? withTempo[1].replace(/-/g, ' ') : null,
    notes: withTempo ? (withTempo[2] ?? '').trim() : trailing,
    bodyPart,
    groupCode,
  };
}

// --- day headers ------------------------------------------------------------

/** Lines that are plainly not content: a rule, a page number, a bare bullet. */
function isNoise(line: string): boolean {
  const t = line.trim();
  return !t || /^[-–—_=*·•\s]+$/.test(t) || /^\d{1,3}$/.test(t);
}

/**
 * Title a detected day header the way the app shows it: "MONDAY - CHEST" →
 * "Monday - Chest", "UPPER 1 (mon)" → "Upper 1", "PUSH A" → "Push A".
 * Short all-caps tokens are left alone so codes and numbers survive.
 */
export function cleanDayName(raw: string): string {
  return raw
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) =>
      /^[A-Z0-9]{1,2}$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    )
    .join(' ')
    .trim();
}

const MAX_HEADER_WORDS = 6;

/**
 * Rule out the tail of a wrapped coach note.
 *
 * A long note wraps onto a short line ("at peak contraction.", "touch and go."),
 * which sits above the next exercise row and otherwise looks exactly like a day
 * header. Titles don't punctuate like sentences and don't open in lower case, so
 * that's the tell — and it doesn't need to know what any particular plan's days
 * are called.
 */
function looksLikeSentenceFragment(line: string): boolean {
  const t = line.trim();
  if (/[.,;:]$/.test(t)) return true;
  return /^[a-z]/.test(t);
}

/**
 * Does a run of exercise rows start just below line `i`?
 *
 * This is the whole of day detection: we don't care what the title says, only
 * that rows follow it. Table headers are stepped over, since a day title sits
 * above the column header, not above the first row. Two rows are required so a
 * stray line above a single row can't split a day in half.
 */
function rowsFollow(classified: (RawRow | null)[], lines: string[], i: number): boolean {
  let seen = 0;
  let looked = 0;
  let j = i + 1;
  for (; j < lines.length && looked < 3; j++) {
    if (isNoise(lines[j]) || parseColumnTemplate(lines[j])) continue;
    looked += 1;
    if (classified[j]) seen += 1;
    else if (looked === 1) return false; // the very next content line isn't a row
  }
  if (seen >= 2) return true;
  // A day with a single movement is rare but real, and it's usually the last
  // one on the sheet. Accept one row only when the plan ends there, so a lone
  // row mid-document can't split a day in two.
  return seen === 1 && j >= lines.length;
}

/**
 * Split the plan into days of rows.
 *
 * Runs in two passes: classify every line as a row or not, then read the day
 * structure off that classification. Doing it in that order is what lets a day
 * title be anything at all — it's recognised by what follows it, not by name.
 */
export function recogniseLayout(
  rawText: string,
  options: { bodyParts?: readonly string[] } = {}
): LayoutResult {
  const bodyParts = options.bodyParts ?? [];
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.replace(/ /g, ' ').trim())
    .filter((l) => l.length > 0);

  // Pass 1 — classify, carrying the most recent column template forward.
  const classified: (RawRow | null)[] = new Array(lines.length).fill(null);
  const templateAt: (ColumnKind[] | null)[] = new Array(lines.length).fill(null);
  let template: ColumnKind[] | null = null;
  for (let i = 0; i < lines.length; i++) {
    const asHeader = parseColumnTemplate(lines[i]);
    if (asHeader) {
      template = asHeader;
      templateAt[i] = asHeader;
      continue;
    }
    if (isNoise(lines[i])) continue;
    classified[i] = template ? matchTemplateRow(lines[i], template, bodyParts) : null;
    if (!classified[i]) classified[i] = matchFreeformRow(lines[i], bodyParts);
  }

  // Pass 2 — day headers are the short non-row lines that rows follow.
  const days: RawDay[] = [];
  const unparsed: string[] = [];
  let current: RawDay | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (templateAt[i] || isNoise(line)) continue;

    const rowHere = classified[i];
    if (!rowHere) {
      const words = line.split(/\s+/).filter(Boolean);
      if (
        words.length <= MAX_HEADER_WORDS &&
        !looksLikeSentenceFragment(line) &&
        rowsFollow(classified, lines, i)
      ) {
        current = { name: cleanDayName(line), rows: [], notes: [] };
        days.push(current);
        continue;
      }
      // Not a row and not a header: a coach note on the row above, or preamble.
      if (current && current.rows.length > 0) {
        const last = current.rows[current.rows.length - 1];
        last.notes = last.notes ? `${last.notes} ${line}` : line;
      } else if (current) {
        current.notes.push(line);
      }
      continue;
    }

    if (!current) {
      // A row before any day header — keep it for the review screen to rescue.
      unparsed.push(line);
      continue;
    }
    current.rows.push(rowHere);
  }

  return { days, unparsed };
}
