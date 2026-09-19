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
  /** Index of the superset or giant set this row was listed under, for plans
   *  that head the group instead of lettering each row. */
  groupId: number | null;
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
  WORK: 'sets',
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
  PROTOCOL: 'notes',
  DROP: 'notes',
  STATION: 'notes',
  EQUIPMENT: 'notes',
  ORDER: 'name',
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
    const word = w.replace(/[^A-Z]/g, '');
    if (!word) continue; // a separator between headings ("Station / Equipment")
    const kind = COLUMN_WORDS[word];
    if (!kind) return null;
    // A heading can run to several words ("Drop Set Protocol", "Coaching
    // Notes"), and the later ones may collide with a column name we know. So
    // once a free-text heading starts, a word only ends it by naming a column
    // the table doesn't already have.
    if (kinds[kinds.length - 1] === 'notes' && (kind === 'notes' || kinds.includes(kind))) {
      continue;
    }
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

  // A dash means "nothing here" — but only for the trimmings. Sets and reps are
  // what make a row an exercise at all, and letting a dash satisfy them turns a
  // day heading like "DAY 2 - BACK & BICEPS" into a two-set movement called DAY.
  if (BLANK_RE.test(t) && OPTIONAL_COLUMNS.has(kind)) return { value: '', next: i + 1 };

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

  // The columns whose width we can't know in advance: the movement's name, and
  // any free-text column that isn't the last one ("Station / Equipment" sits
  // between the name and the figures). Everything else has a shape we can test a
  // token against, so we search over where the stretchy ones start and end and
  // let the testable columns decide which split was right.
  const lastIdx = template.length - 1;
  const isStretchy = (k: ColumnKind, idx: number): boolean =>
    k === 'name' || (k === 'notes' && idx < lastIdx);

  const cells: Partial<Record<ColumnKind, string>> = {};
  const put = (kind: ColumnKind, value: string): void => {
    cells[kind] = cells[kind] ? `${cells[kind]} ${value}`.trim() : value;
  };

  const attempt = (ti: number, ki: number): boolean => {
    if (ki > lastIdx) return ti === tokens.length;
    const kind = template[ki];

    if (kind === 'bodyPart') {
      // Declared but often merged down a block of rows, so it may be absent.
      const head = splitLeadingBodyPart(tokens.slice(ti).join(' '), bodyParts);
      if (head.bodyPart) {
        const width = head.bodyPart.split(/\s+/).length;
        const saved = cells.bodyPart;
        cells.bodyPart = head.bodyPart;
        if (attempt(ti + width, ki + 1)) return true;
        cells.bodyPart = saved;
      }
      return attempt(ti, ki + 1);
    }

    if (isStretchy(kind, ki)) {
      for (let width = 1; ti + width <= tokens.length; width++) {
        const saved = cells[kind];
        cells[kind] = tokens.slice(ti, ti + width).join(' ');
        if (attempt(ti + width, ki + 1)) return true;
        cells[kind] = saved;
      }
      return false;
    }

    const got = consume(tokens, ti, kind, ki === lastIdx);
    if (got) {
      const saved = cells[kind];
      put(kind, got.value);
      if (attempt(got.next, ki + 1)) return true;
      cells[kind] = saved;
    }
    // Trainers leave the trimmings out on individual rows — no tempo on the
    // warm-up, no RPE on the finisher — while always writing the sets and reps.
    // So an extra column that doesn't match is treated as blank rather than
    // failing the row, which is what used to drop it on the floor.
    if (OPTIONAL_COLUMNS.has(kind)) return attempt(ti, ki + 1);
    return false;
  };

  if (!attempt(0, 0)) return null;
  // Both are required: a row with no rep count isn't something you can train.
  if (!cells.sets || !cells.reps) return null;

  const { groupCode, name } = splitGroupCode((cells.name ?? '').split(/\s+/).filter(Boolean));
  // A movement is named, not numbered. Without this a wrapped note that opens
  // with figures ("1 X 8-10 REPS / 1 12-15 REPS BACK OFF") lines up against a
  // loose template and becomes an exercise of its own.
  if (!name || !/^[A-Za-z]/.test(name) || !/[A-Za-z]{2}/.test(name)) return null;
  return {
    name,
    totalSets: toSets(cells.sets),
    repRange: cells.reps ?? '',
    tempo: cells.tempo ? cells.tempo : null,
    notes: joinNotes(cells),
    bodyPart: cells.bodyPart ?? null,
    groupCode,
    groupId: null,
  };
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

// --- per-set logs -----------------------------------------------------------

/**
 * A log sheet with one column per set, each filled in as "weight x reps".
 *
 * This isn't a prescription, it's a record of what was lifted, and reading it as
 * one turns "60 x 12" into sixty sets of twelve. It's recognisable from its
 * heading — "Exercise | Set 1 | Set 2 | … | Notes" — so we count the set columns
 * and read the row as the sets it holds.
 *
 * Returns how many set columns the heading declares, or null if it isn't one.
 */
export function parseSetLogHeader(line: string): number | null {
  const t = line.trim();
  const setColumns = t.match(/\bset\s*\d+\b/gi);
  if (!setColumns || setColumns.length < 2) return null;
  // It still has to be an exercise table rather than, say, a set-by-set note.
  if (!/^\s*(exercise|movement|lift)\b/i.test(t)) return null;
  return setColumns.length;
}

/** A word that can be part of a load: a figure, or the handful of words gyms
 *  write instead of one ("BW", "Plate 6", "Assist 20kg", "Band"). */
const LOAD_TOKEN_RE =
  /^(\d+(?:\.\d+)?(?:kg|lbs?)?|BW|bodyweight|plate|pin|band|assist|each|pair)$/i;

interface SetCell {
  load: string | null;
  reps: number | null;
  /** A hold written in seconds rather than a rep count. */
  seconds: number | null;
  next: number;
}

/** Read one set's entry: "60 x 12", "Plate 5 x 15", "BW x 8", "60 sec", "-". */
function consumeSetCell(tokens: string[], i: number): SetCell | null {
  const t = tokens[i];
  if (t == null) return null;
  if (BLANK_RE.test(t)) return { load: null, reps: null, seconds: null, next: i + 1 };
  if (/^\d{1,4}$/.test(t) && /^(s|sec|secs|seconds)$/i.test(tokens[i + 1] ?? '')) {
    return { load: null, reps: null, seconds: parseInt(t, 10), next: i + 2 };
  }
  // The load can run to a couple of words ("Plate 5", "BW", "Assist 20kg")
  // before the "x" that separates it from the rep count — but only words that
  // can be a load. Without that check "Barbell Bench Press 60 x 12" reads as a
  // set of 12 at "Bench Press 60", and the movement loses most of its name.
  for (let k = 1; k <= 3; k++) {
    if (!/^x$/i.test(tokens[i + k] ?? '')) continue;
    const load = tokens.slice(i, i + k);
    if (!load.every((w) => LOAD_TOKEN_RE.test(w))) return null;
    const reps = tokens[i + k + 1];
    if (!/^\d{1,3}$/.test(reps ?? '')) return null;
    return {
      load: load.join(' '),
      reps: parseInt(reps, 10),
      seconds: null,
      next: i + k + 2,
    };
  }
  return null;
}

/** Read a row of a per-set log into the movement it records. */
export function matchSetLogRow(line: string, columns: number): RawRow | null {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;

  for (let split = 1; split < tokens.length; split++) {
    const name = tokens.slice(0, split).join(' ');
    if (!/^[A-Za-z]/.test(name) || !/[A-Za-z]{2}/.test(name)) continue;
    const cells: SetCell[] = [];
    let i = split;
    let ok = true;
    for (let c = 0; c < columns; c++) {
      const cell = consumeSetCell(tokens, i);
      if (!cell) {
        // The trailing columns may simply be absent rather than dashed.
        if (i >= tokens.length) break;
        ok = false;
        break;
      }
      cells.push(cell);
      i = cell.next;
    }
    const filled = cells.filter((c) => c.reps != null || c.seconds != null);
    if (!ok || filled.length === 0) continue;

    const reps = filled.map((c) => c.reps).filter((r): r is number => r != null);
    const secs = filled.map((c) => c.seconds).filter((s): s is number => s != null);
    const span = (ns: number[], suffix: string): string => {
      const lo = Math.min(...ns);
      const hi = Math.max(...ns);
      return lo === hi ? `${lo}${suffix}` : `${lo}-${hi}${suffix}`;
    };
    const loads = filled.map((c) => c.load).filter((l): l is string => !!l);
    const trailing = tokens.slice(i).join(' ').trim();
    const noteBits = [];
    if (loads.length > 0) noteBits.push(`Logged: ${loads.join(', ')}`);
    if (trailing) noteBits.push(trailing);

    return {
      name,
      totalSets: filled.length,
      repRange: reps.length > 0 ? span(reps, '') : span(secs, 's'),
      tempo: null,
      notes: noteBits.join(' · '),
      bodyPart: null,
      groupCode: null,
      groupId: null,
    };
  }
  return null;
}

// --- freeform shapes --------------------------------------------------------

// Units that mean the number is a duration, not a rep count — "2 x 30min zone 2"
// is a cardio instruction, not a set scheme.
const DURATION_UNIT = /^(min|mins|minute|minutes|hr|hour|hours|km|mile|miles)\b/i;

// "3 sets of 10 reps", "3 sets x 10 reps", "3 sets × 12" — coaches write the
// connector either way round and the difference means nothing.
const PROSE_RE =
  // The unit is matched loosely on its stem: these sheets are typed by hand and
  // "secconds" is as likely as "seconds".
  /^(.+?)\s*[-–—:]?\s*(\d{1,2})\s*sets?\s*(?:of|x|×)\s*(\d{1,3}(?:\s*-\s*\d{1,3})?|AMRAP|max)\s*(rep\w*|sec\w*|s)?\b\s*(.*)$/i;

const COMPACT_RE =
  /^(.+?)\s*[-–—:]?\s*(\d{1,2})\s*x\s*(\d{1,3}(?:\s*-\s*\d{1,3})?|AMRAP|max)\s*(s|secs?|seconds?)?\b\s*(.*)$/i;

const ROUNDS_RE = /^(.+?)[,:]?\s*(\d{1,2})\s*rounds?\b[,\s]*(\d{1,3})\s*(?:reps?\s*)?(?:each|per)?\b\s*(.*)$/i;

// A bulleted movement inside a giant set: "- Incline Dumbbell Press - 10 reps -
// 24kg pair", "- Wall Sit - 45 seconds - bodyweight". There's no set count on
// the line at all; it comes from the "Rounds: 4" that closes the group.
const BULLET_RE =
  /^[-–—•*]\s*(.+?)\s*[-–—]\s*(\d{1,3}(?:\s*-\s*\d{1,3})?)\s*(reps?|seconds?|secs?|mins?)\b\s*((?:each|per)\s+\w+)?\s*(?:[-–—]\s*(.*))?$/i;

/** "GIANT SET 1 - Chest dominant", "SUPERSET A (repeat 4 times)", "CIRCUIT 2". */
const GROUP_HEADER_RE = /^(GIANT\s*SET|SUPER\s*SET|SUPERSET|TRI[-\s]?SET|CIRCUIT)\b/i;

/** "Rounds: 4. Rest 2 minutes between rounds." — the set count for the group
 *  that came just above it. */
const ROUNDS_LINE_RE = /^rounds?\s*[:-]?\s*(\d{1,2})\b\s*\.?\s*(.*)$/i;

export function isGroupHeader(line: string): boolean {
  return GROUP_HEADER_RE.test(line.trim());
}

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

  const bullet = trimmed.match(BULLET_RE);
  if (bullet) {
    const isTime = /^(sec\w*|min\w*)$/i.test(bullet[3] ?? '');
    const qualifier = (bullet[4] ?? '').trim();
    const reps = isTime ? `${bullet[2]}s` : bullet[2];
    // Sets stay null: the group's "Rounds: N" line supplies them.
    return row(
      bullet[1],
      '',
      qualifier ? `${reps} ${qualifier}` : reps,
      bullet[5] ?? '',
      bodyParts
    );
  }

  const prose = trimmed.match(PROSE_RE);
  if (prose) {
    const unit = prose[4] ?? '';
    const isTime = /^(s|sec\w*)$/i.test(unit);
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
  // The body part is left on the front here. Whether "CHEST FLAT BENCH PRESS"
  // is a body-part column or "Back Extension" is simply the movement's name
  // can't be told from one line — see peelBodyPartColumn, which decides it once
  // for the whole sheet.
  const cleaned = cleanName(coded);
  if (!cleaned || !/[A-Za-z]{2}/.test(cleaned)) return null;
  void bodyParts;
  // Without a header we only find out a row had a tempo by looking at what came
  // after the reps; left alone it reads as the opening of the coach's note.
  const trailing = (notes ?? '').trim();
  const withTempo = trailing.match(LEADING_TEMPO_RE);
  return {
    name: cleaned,
    totalSets: toSets(sets),
    repRange: reps.trim().replace(/\s*-\s*/g, '-'),
    tempo: withTempo ? withTempo[1].replace(/-/g, ' ') : null,
    notes: withTempo ? (withTempo[2] ?? '').trim() : trailing,
    bodyPart: null,
    groupCode,
    groupId: null,
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

// Section labels that name a muscle group rather than a training day. Broader
// than the app's canonical body-part list, because this is about how coaches
// caption a band of rows, not about what the app files an exercise under.
const BODY_PART_LABELS = new Set([
  'CHEST',
  'BACK',
  'LATS',
  'UPPER BACK',
  'LEGS',
  'QUADS',
  'HAMSTRINGS',
  'HAMS',
  'GLUTES',
  'GLUTES/HAMS',
  'CALVES',
  'SHOULDERS',
  'DELTS',
  'REAR DELTS',
  'TRAPS',
  'ARMS',
  'BICEPS',
  'TRICEPS',
  'FOREARMS',
  'CORE',
  'ABS',
  'ABDOMINALS',
]);

function isBodyPartLabel(line: string): boolean {
  return BODY_PART_LABELS.has(line.trim().toUpperCase().replace(/\s+/g, ' '));
}

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
  if (/^[a-z]/.test(t)) return true;
  // A title is capitalised — "SESSION A - PUSH", "Day 1", "Monday - Chest". A
  // line of prose that happens to be short isn't ("Rest after the pair: 60
  // seconds", "Dip/chin assist by the changing"), and those sit above rows just
  // as convincingly as a real heading does.
  const words = t.split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
  if (words.length === 0) return true;
  const capitalised = words.filter((w) => /^[A-Z]/.test(w)).length;
  return capitalised * 2 < words.length;
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
    // A column header or a group caption sits between a day title and its first
    // row, so neither counts against the run of rows we're looking for.
    if (
      isNoise(lines[j]) ||
      parseColumnTemplate(lines[j]) ||
      parseSetLogHeader(lines[j]) ||
      isGroupHeader(lines[j])
    ) {
      continue;
    }
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
  // The app's canonical list plus the looser captions coaches actually write.
  const labels = [...new Set([...bodyParts, ...BODY_PART_LABELS])];
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.replace(/\u00A0/g, ' ').trim())
    .filter((l) => l.length > 0);

  // Pass 1 — classify, carrying the most recent column template forward.
  const classified: (RawRow | null)[] = new Array(lines.length).fill(null);
  const templateAt: (ColumnKind[] | null)[] = new Array(lines.length).fill(null);
  let template: ColumnKind[] | null = null;
  let setLogColumns: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    // A per-set log is checked first: its heading also reads as an ordinary
    // table ("Exercise … Set … Notes"), but its rows mean something else.
    const asSetLog = parseSetLogHeader(lines[i]);
    if (asSetLog) {
      setLogColumns = asSetLog;
      template = null;
      templateAt[i] = [];
      continue;
    }
    const asHeader = parseColumnTemplate(lines[i]);
    if (asHeader) {
      template = asHeader;
      setLogColumns = null;
      templateAt[i] = asHeader;
      continue;
    }
    if (isNoise(lines[i])) continue;
    if (setLogColumns != null) classified[i] = matchSetLogRow(lines[i], setLogColumns);
    if (!classified[i] && template) classified[i] = matchTemplateRow(lines[i], template, bodyParts);
    if (!classified[i]) classified[i] = matchFreeformRow(lines[i], bodyParts);
  }

  // Are the leading body parts a column, or part of the movements' names?
  //
  // "CHEST FLAT BENCH PRESS" is a table whose first column is the body part.
  // "Back Extension" and "Chest Supported Row" are just what those machines are
  // called. One line can't tell you which, but a sheet can: a body-part column
  // is in front of nearly every row, whereas a movement that happens to start
  // with a muscle name is the odd one out. So we decide it once, from the whole
  // page, instead of guessing row by row and eating the front of a name.
  const freeform = classified.filter((r): r is RawRow => r != null && r.bodyPart == null);
  const leading = freeform.filter(
    (r) => splitLeadingBodyPart(r.name, labels).bodyPart != null
  );
  const peelBodyPartColumn =
    leading.length >= 2 && leading.length >= freeform.length * 0.6;
  for (const r of freeform) {
    const { bodyPart, rest } = splitLeadingBodyPart(r.name, labels);
    if (!bodyPart || !rest) continue;
    // The other way a body part ends up glued to a name: a label printed down
    // the side of a band of rows, which lands in front of whichever row it was
    // level with. Those are set in capitals while the movement isn't, and that
    // is the whole difference between "QUADS Leg Extension" and the machine
    // actually called "Chest Supported Row".
    // Compare the words as the sheet printed them, not the label we matched —
    // the label list is uppercase by construction.
    const printed = r.name.slice(0, r.name.length - rest.length).trim();
    const shouted = printed === printed.toUpperCase() && rest !== rest.toUpperCase();
    if (!peelBodyPartColumn && !shouted) continue;
    r.bodyPart = bodyPart;
    r.name = rest;
  }

  // Pass 2 — a header is a short non-row line that rows follow.
  const isHeader = (i: number): boolean => {
    if (templateAt[i] || isNoise(lines[i]) || classified[i]) return false;
    // A giant set or superset caption groups rows inside a day; it isn't one.
    if (isGroupHeader(lines[i]) || ROUNDS_LINE_RE.test(lines[i])) return false;
    const words = lines[i].split(/\s+/).filter(Boolean);
    return (
      words.length <= MAX_HEADER_WORDS &&
      !looksLikeSentenceFragment(lines[i]) &&
      rowsFollow(classified, lines, i)
    );
  };

  // A muscle group can caption either a day or a band of rows inside one, and
  // the difference is only visible from the whole sheet: if the plan captions
  // anything by session or weekday, then "CHEST" is a band within it. If muscle
  // groups are the only captions there are, they're how the plan splits its days.
  const headerIdxs: number[] = [];
  for (let i = 0; i < lines.length; i++) if (isHeader(i)) headerIdxs.push(i);
  const bodyPartHeaders = headerIdxs.filter((i) => isBodyPartLabel(lines[i])).length;
  const otherHeaders = headerIdxs.length - bodyPartHeaders;
  // Bands are the many inside the few: a handful of sessions, each broken into
  // muscle groups. When the muscle groups don't outnumber the other headings
  // they're peers of them — a sheet with PUSH, PULL, LEGS and SHOULDERS & CORE
  // is four days, one of which happens to be named after a muscle group.
  const bandsAreBodyParts = otherHeaders > 0 && bodyPartHeaders > otherHeaders;

  // Pass 3 — assign rows to days.
  const days: RawDay[] = [];
  const unparsed: string[] = [];
  let current: RawDay | null = null;
  let band: string | null = null;
  // The giant set / superset currently being listed, and its rows — they only
  // learn their set count when the group's "Rounds: N" line closes it.
  let groupId: number | null = null;
  let nextGroupId = 1;
  let openGroup: RawRow[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (templateAt[i] || isNoise(line)) continue;

    const rowHere = classified[i];
    if (!rowHere) {
      if (isGroupHeader(line) && current) {
        groupId = nextGroupId++;
        openGroup = [];
        continue;
      }
      const rounds = line.match(ROUNDS_LINE_RE);
      if (rounds && openGroup.length > 0) {
        const sets = parseInt(rounds[1], 10);
        for (const r of openGroup) if (r.totalSets == null) r.totalSets = sets;
        const trailing = (rounds[2] ?? '').trim();
        if (trailing && current) current.notes.push(trailing);
        openGroup = [];
        groupId = null;
        continue;
      }
      if (isHeader(i)) {
        if (bandsAreBodyParts && isBodyPartLabel(line) && current) {
          band = line.trim();
          continue;
        }
        current = { name: cleanDayName(line), rows: [], notes: [] };
        band = null;
        groupId = null;
        openGroup = [];
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
    // The band caption applies to the rows under it unless the row named its
    // own body part.
    const placed: RawRow = {
      ...rowHere,
      bodyPart: rowHere.bodyPart ?? band,
      groupId: rowHere.groupId ?? groupId,
    };
    if (groupId != null) openGroup.push(placed);
    current.rows.push(placed);
  }

  return { days, unparsed };
}
