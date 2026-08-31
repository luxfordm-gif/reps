import { toSentenceCase } from './textCase';
import { normalizeExerciseName as normalizeName } from './normalizeExerciseName';
import { levenshtein } from './stringSimilarity';

// Parses the raw text of a trainer's training plan PDF into a structured plan with
// days, exercises, prescribed sets/reps/tempo and notes.
//
// A plan is split into day sections, each containing a table of rows in the shape:
//   BODY_PART  EXERCISE_NAME  TOTAL_SETS  REP_RANGE  TEMPO(4 digits)  NOTES?
//
// Day sections are titled differently by different trainers. Some use split names
// (PUSH / PULL / LEGS / UPPER / ARMS); others title each day after the body part(s)
// it trains (CHEST, LEGS, BACK / REAR DELT, ARMS, DELTS). We therefore detect a day
// header two ways: (1) a known split keyword, or (2) structurally — a short title
// line that sits directly above the table's column-header row. Relying only on the
// keyword list meant unfamiliar titles (e.g. CHEST, DELTS) weren't recognised as new
// days, so their exercises were dropped or merged into the previous day.
//
// Loose rules — parser surfaces unparsed lines as warnings rather than crashing.

export type SetScheme =
  | 'standard'
  | 'dropset'
  | 'superset'
  | 'muscle_round'
  | 'rest_pause'
  | 'hold';

// A movement the plan says to rotate to on alternate weeks (parsed from a coach
// note like "Alternate weeks with Magnum bench press machine"). Surfaced on the
// upload review screen for the user to confirm/tweak, then saved as a
// weekly-rotation alternative on the exercise slot.
export interface WeeklyAlternative {
  name: string;
  normalizedName: string;
}

export interface ParsedExercise {
  bodyPart: string;
  name: string;
  normalizedName: string;
  totalSets: number | null;
  repRange: string;
  tempo: string | null; // "1-1-3-2"
  notes: string;
  setScheme: SetScheme;
  position: number;
  repRangeUncertain?: boolean;
  tempoUncertain?: boolean;
  // Detected "alternate weeks with X" partner movement, if the coach notes name one.
  weeklyAlternative?: WeeklyAlternative | null;
  // Raw text naming the movement(s) this one is supersetted with, straight from
  // the notes and not yet resolved to exercises in the day.
  supersetWith?: string[] | null;
  // Exercises sharing a group number are performed together — a superset, tri-set
  // or giant set: you cycle through them and only rest once the round is done.
  // Assigned per day after all its rows are parsed, null for everything else.
  supersetGroup?: number | null;
  // The other members' display names, for showing the pairing on the review screen.
  supersetPartnerNames?: string[] | null;
  // True when the total-sets column said SUPERSET rather than a number, i.e. the
  // row is one movement of a group performed back to back.
  supersetColumn?: boolean;
}

export interface ParsedTrainingDay {
  name: string;
  position: number;
  exercises: ParsedExercise[];
  inlineNotes: string[]; // lines like "CALVES WORKOUT" notes that weren't exercise rows
  // Which week of a rotating plan this day belongs to ("ROTATION WEEK 2" → 2).
  // null means it runs every week — the home abs workout, or any plan with no
  // rotation at all.
  weekIndex: number | null;
}

export interface ParsedPlan {
  days: ParsedTrainingDay[];
  warnings: string[];
  unparsedLines: string[];
}

const DAY_HEADERS = ['PUSH', 'PULL', 'LEGS', 'UPPER', 'ARMS'];
const ABDOMINALS_HEADER = 'Abdominals 2x Per Week';

export const BODY_PARTS = [
  'GLUTES/HAMS',
  'REAR DELTS',
  'ABDOMINALS',
  'SHOULDERS',
  'TRICEPS',
  'BICEPS',
  'CHEST',
  'BACK',
  'QUADS',
  'CALVES',
];

// Words that appear in the table column headers. A line whose words are ENTIRELY
// from this set is treated as a (possibly line-wrapped) header and stripped.
const TABLE_HEADER_WORDS = new Set([
  'BODY',
  'PART',
  'EXERCISE',
  'TOTAL',
  'SETS',
  'REP',
  'RANGE',
  'TEMPO',
  'NOTES',
]);

const HEADER_BOILERPLATE_PREFIXES = [
  'MATT LUXFORD',
  'ALL SETS LISTED',
  'TRAIN CALVES',
  'ABS &',
  'TAKE REST DAYS',
  'REST PERIODS',
];

// Coach notes sometimes name a movement to rotate to on alternate weeks. Trainers
// phrase this a few ways, so we match a small family: "alternate weeks with X",
// "alternate with X", and the "alternative" keyword ("Alternative: X",
// "Alternative is X", "Alternative - X"). Whatever we capture the user confirms
// or tweaks on the upload screen, so it's fine to be a little generous here.
const WEEKLY_ALTERNATE_PATTERNS: RegExp[] = [
  /\balternates?\s+weeks?\s+with\s+(.+)$/i,
  /\balternates?\s+with\s+(.+)$/i,
  /\balternatively\s+(?:use\s+|with\s+)?(.+)$/i,
  /\balternatives?\s*(?:movement|machine|exercise)?\s*(?:is|are|:|-|–|—|=)\s*(.+)$/i,
];

export function detectWeeklyAlternative(notes: string): WeeklyAlternative | null {
  if (!notes) return null;
  for (const pattern of WEEKLY_ALTERNATE_PATTERNS) {
    const m = notes.match(pattern);
    if (!m) continue;
    // Trim trailing punctuation and any leading connector left over ("of choice").
    const raw = m[1].trim().replace(/^[:\-–—=\s]+/, '').replace(/[.;,]+$/, '').trim();
    if (raw.length < 2) continue;
    return { name: toSentenceCase(raw), normalizedName: normalizeName(raw) };
  }
  return null;
}

// The terms trainers use for "do these back to back": a superset is two
// movements, a tri-set three, a giant set four or more. A compound set is the
// same idea under another name. They all behave identically here — you cycle
// through the group and rest once at the end of the round.
const SUPERSET_KEYWORDS =
  /SUPERSETT?E?D?|TRI[\s-]?SET|GIANT\s?SET|COMPOUND\s?SET/;

// How many further rows a bare marker pulls in when it names no partner: a
// superset takes the next row, a tri-set the next two, a giant set the next
// three. Ordered longest-keyword-first so "tri-set" isn't read as "set".
const BARE_CHAIN_LENGTHS: { re: RegExp; others: number }[] = [
  { re: /\bGIANT\s?SET\b/i, others: 3 },
  { re: /\bTRI[\s-]?SET\b/i, others: 2 },
  { re: /\bCOMPOUND\s?SET\b/i, others: 1 },
  { re: /\bSUPERSETT?E?D?\b/i, others: 1 },
];

// A grouped set names its partners a few ways: "superset with X", "tri-set: X
// and Y", "supersetted into X". We capture the raw text and resolve it against
// the day's other exercises later — the same phrasing also describes a variation
// of the SAME movement ("dropset superset with reverse grip"), which must NOT
// become a group, and only a successful match tells the two apart.
const SUPERSET_PARTNER_PATTERNS: RegExp[] = [
  /(?:SUPERSETT?E?D?|TRI[\s-]?SET|GIANT\s?SET|COMPOUND\s?SET)\s+(?:WITH|INTO)\s+([^.;]+)/i,
  /(?:SUPERSETT?E?D?|TRI[\s-]?SET|GIANT\s?SET|COMPOUND\s?SET)\s*(?::|-|\u2013|\u2014)\s*([^.;]+)/i,
  /\bPAIRED\s+WITH\s+([^.;]+)/i,
];

/**
 * The movements a row says to pair with, in the order they're named.
 *
 * "Tri-set with leg extensions and leg curls" gives two; a plain superset gives
 * one. Returns an empty array when the notes name nobody.
 */
export function detectSupersetPartners(notes: string): string[] {
  if (!notes) return [];
  for (const pattern of SUPERSET_PARTNER_PATTERNS) {
    const m = notes.match(pattern);
    if (!m) continue;
    const names = m[1]
      .split(/\s*(?:,|\+|\band\b|\bthen\b|\binto\b)\s*/i)
      .map((part) =>
        part.trim().replace(/^[:\-\u2013\u2014\s]+/, '').replace(/[.;,]+$/, '').trim()
      )
      .filter((part) => part.length >= 2);
    if (names.length > 0) return names;
  }
  return [];
}

// How close a note's partner text has to be to an exercise name in the same day
// before we treat them as the same movement.
const PARTNER_MAX_EDIT_DISTANCE = 2;
const PARTNER_MIN_SUBSTRING = 5;

function matchesExerciseName(partnerText: string, exercise: ParsedExercise): boolean {
  const t = normalizeName(partnerText);
  const n = exercise.normalizedName;
  if (!t || !n) return false;
  if (t === n) return true;
  if (
    Math.min(t.length, n.length) >= PARTNER_MIN_SUBSTRING &&
    (t.includes(n) || n.includes(t))
  ) {
    return true;
  }
  return levenshtein(t, n) <= PARTNER_MAX_EDIT_DISTANCE;
}

/** How many rows a bare marker (no partner named) chains in after itself. */
function bareChainLength(notes: string): number {
  for (const { re, others } of BARE_CHAIN_LENGTHS) {
    if (re.test(notes)) return others;
  }
  return 0;
}

/**
 * Group up the day's supersets, tri-sets and giant sets.
 *
 * A row that names its partners is grouped with whichever rows in the day those
 * names match. A row carrying a bare marker ("SUPERSET", "TRI-SET") groups with
 * the rows directly beneath it, which is how plans lay them out. A row whose
 * partner text matches nothing — "superset with reverse grip", i.e. a variation
 * of the same movement rather than a second exercise — is left ungrouped on
 * purpose, and its drop/rep handling in parseSetMods covers it instead.
 */
/**
 * Group the rows whose total-sets column said SUPERSET.
 *
 * The plan writes a giant set as a run of consecutive rows sharing one merged
 * body-part cell, with SUPERSET where the set count would be and a single
 * "repeat superset x N" note across the block. That note is what says how many
 * rounds each movement gets, since the rows themselves carry no count.
 */
function resolveSupersetColumnGroups(day: ParsedTrainingDay, startGroup: number): number {
  let nextGroup = startGroup;
  let rounds: number | null = null;
  for (const ex of day.exercises) {
    const m = (ex.notes ?? '').match(/REPEAT[^.]{0,40}?\bX\s*(\d+)/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!Number.isNaN(n) && n > 0) {
        rounds = n;
        break;
      }
    }
  }

  let i = 0;
  while (i < day.exercises.length) {
    if (!day.exercises[i].supersetColumn) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < day.exercises.length && day.exercises[j].supersetColumn) j += 1;
    const members = day.exercises.slice(i, j);
    if (members.length >= 2) {
      const id = nextGroup++;
      for (const m of members) {
        m.supersetGroup = id;
        m.supersetPartnerNames = members.filter((o) => o !== m).map((o) => o.name);
        if (m.setScheme === 'standard') m.setScheme = 'superset';
      }
    }
    // No number in the sets column, so the rounds come from the repeat note.
    for (const m of members) {
      if (m.totalSets == null) m.totalSets = rounds ?? 1;
    }
    i = j;
  }
  return nextGroup;
}

function resolveSupersets(day: ParsedTrainingDay, startGroup: number): void {
  let nextGroup = startGroup;
  const group = (members: ParsedExercise[]) => {
    if (members.length < 2) return;
    const id = nextGroup++;
    for (const m of members) {
      m.supersetGroup = id;
      m.supersetPartnerNames = members.filter((o) => o !== m).map((o) => o.name);
      // The trailing rows usually carry no superset wording of their own, so tag
      // them too — but never overwrite a more specific scheme they already have.
      if (m.setScheme === 'standard') m.setScheme = 'superset';
    }
  };

  for (let i = 0; i < day.exercises.length; i++) {
    const ex = day.exercises[i];
    if (ex.supersetGroup != null) continue;
    const named = ex.supersetWith ?? [];
    if (named.length > 0) {
      const partners: ParsedExercise[] = [];
      for (const name of named) {
        const found = day.exercises.find(
          (other, j) =>
            j !== i &&
            other.supersetGroup == null &&
            !partners.includes(other) &&
            matchesExerciseName(name, other)
        );
        if (found) partners.push(found);
      }
      group([ex, ...partners]);
      continue;
    }
    // A bare marker with nothing named: the rows beneath it are the other halves.
    const chain = ex.setScheme === 'superset' ? bareChainLength(ex.notes) : 0;
    if (chain > 0) {
      const members = [ex];
      for (let k = 1; k <= chain; k++) {
        const next = day.exercises[i + k];
        if (!next || next.supersetGroup != null) break;
        members.push(next);
      }
      group(members);
    }
  }
}

export function detectSetScheme(notes: string, repRange: string): SetScheme {
  const upper = notes.toUpperCase();
  if (/MAX HOLD/i.test(repRange) || /HOLD/.test(upper)) {
    if (/HOLD/.test(upper) && !/MUSCLE ROUND|REST PAUSE|DROPSET|DROP SET|SUPERSET/.test(upper)) {
      // ambiguous but bias to hold for plank-like
      if (/MAX HOLD/i.test(repRange)) return 'hold';
    }
  }
  if (/MUSCLE ROUND/.test(upper)) return 'muscle_round';
  if (/REST.?PAUSE/.test(upper)) return 'rest_pause';
  if (/DROP\s?SET|DROPSET/.test(upper)) return 'dropset';
  if (SUPERSET_KEYWORDS.test(upper)) return 'superset';
  if (/MAX HOLD/i.test(repRange)) return 'hold';
  return 'standard';
}

// Match an exercise row. Body parts are matched first (longest first so REAR DELTS / GLUTES/HAMS
// take precedence over BACK / GLUTES). After body part, capture the exercise name (up to the first
// integer that's followed by a space and another integer or rep-range).
// Rep ranges that aren't a number: work to failure, hold or go for time. The
// plan writes these in the rep-range column exactly like a numeric range.
const REP_SENTINEL = String.raw`Max\s+Reps|Max\s+Hold|Max\s+Time|Failure`;
const REP_RANGE_ALT = String.raw`\d+(?:\s*-\s*\d+)?|${REP_SENTINEL}`;

function isRepSentinel(repRange: string): boolean {
  return new RegExp(`^(?:${REP_SENTINEL})$`, 'i').test(repRange.trim());
}

const BODY_PART_ALT = BODY_PARTS.map((bp) =>
  bp.replace(/\//g, '\\/').replace(/ /g, '\\s+')
).join('|');

const ROW_REGEX = (() => {
  // Exercise name = lazy capture of letters/spaces/punct, ending before the sets count
  // Sets = 1-2 digit integer
  // Rep range = "<num>-<num>", a single number, or one of the sentinels above
  // Tempo = four single-digit numbers separated by single spaces, OR "N/A"
  // Notes = rest of the line (optional)
  return new RegExp(
    String.raw`^(${BODY_PART_ALT})\s+(.+?)\s+(\d{1,2})\s+(${REP_RANGE_ALT})\s+(\d\s+\d\s+\d\s+\d|N\/A)(?:\s+(.*))?$`,
    'i'
  );
})();

// A looser shape for rows the strict regex can't express, used only when it
// fails AND the row is unmistakably one of those cases (see matchExerciseRow):
//   • the body part is missing, because the PDF merged that cell down a block
//     of rows — every movement in the abs giant set shares one ABDOMINALS cell;
//   • the total-sets column says SUPERSET instead of a number;
//   • there's no tempo at all ("FLUTTER KICKS 3 Max Time").
const ROW_REGEX_LOOSE = new RegExp(
  String.raw`^(?:(${BODY_PART_ALT})\s+)?(.+?)\s+(\d{1,2}|SUPERSET)\s+(${REP_RANGE_ALT})(?:\s+(\d\s+\d\s+\d\s+\d|N\/A))?(?:\s+(.*))?$`,
  'i'
);

interface RowMatch {
  bodyPart: string | null;
  name: string;
  totalSets: string;
  repRange: string;
  tempo: string | null;
  notes: string;
}

/**
 * Match one line of a day's table, tolerating the shapes a merged-cell PDF
 * produces. The loose fallback is deliberately gated: without the gate it would
 * happily swallow a wrapped coach note as an exercise.
 */
function matchExerciseRow(line: string): RowMatch | null {
  const strict = line.match(ROW_REGEX);
  if (strict) {
    return {
      bodyPart: strict[1],
      name: strict[2],
      totalSets: strict[3],
      repRange: strict[4],
      tempo: strict[5],
      notes: strict[6] ?? '',
    };
  }
  const loose = line.match(ROW_REGEX_LOOSE);
  if (!loose) return null;
  const totalSets = loose[3];
  const repRange = loose[4];
  const isSuperset = /^superset$/i.test(totalSets);
  // Only trust the loose match where the strict one structurally could not have
  // fired: a supersetted row, or a non-numeric rep range.
  if (!isSuperset && !isRepSentinel(repRange)) return null;
  return {
    bodyPart: loose[1] ?? null,
    name: loose[2],
    totalSets,
    repRange,
    tempo: loose[5] ?? null,
    notes: loose[6] ?? '',
  };
}

function looksLikeBoilerplate(line: string): boolean {
  const upper = line.toUpperCase().trim();
  if (!upper) return true;
  return HEADER_BOILERPLATE_PREFIXES.some((p) => upper.startsWith(p));
}

function looksLikeTableHeader(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  const words = trimmed.toUpperCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  // Every word must be from the header vocabulary
  return words.every((w) => TABLE_HEADER_WORDS.has(w));
}

function isDayHeader(line: string): string | null {
  const trimmed = line.trim();
  const upper = trimmed.toUpperCase();
  if (DAY_HEADERS.includes(upper)) return upper;
  // Rotating plans number each day by the week it belongs to: "LEGS 1",
  // "PUSH 2". The number is kept in the title so the two weeks' days stay
  // tellable apart; the week itself is tracked separately.
  const numbered = upper.match(/^(PUSH|PULL|LEGS|UPPER|ARMS)\s+(\d+)$/);
  if (numbered) return `${numbered[1]} ${numbered[2]}`;
  if (trimmed === ABDOMINALS_HEADER) return 'ABS';
  if (/^Abdominals\s+\d+x?\s+Per\s+Week/i.test(trimmed)) return 'ABS';
  // "Abdominals Home Workout (1x Weekly)" — done at home, outside the rotation.
  if (/^Abdominals\b.*\bHome\b/i.test(trimmed)) return 'ABS';
  return null;
}

// "ROTATION WEEK 1" / "ROTATION WEEK 2" — every day below one of these belongs
// to that week of the rotation, until the next marker.
function rotationWeekMarker(line: string): number | null {
  const m = line.trim().match(/^ROTATION\s+WEEK\s+(\d+)$/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isNaN(n) || n < 1 ? null : n;
}

// The next line that carries real content, skipping boilerplate. Used to look at
// what immediately follows a candidate day-title line.
function nextMeaningfulLine(lines: string[], i: number): string | null {
  for (let j = i + 1; j < lines.length; j++) {
    if (looksLikeBoilerplate(lines[j])) continue;
    return lines[j];
  }
  return null;
}

// Structural day-header detection for trainers who title each day after the body
// part(s) it trains (e.g. CHEST, BACK / REAR DELT, DELTS) rather than a fixed split
// keyword. In every plan we've seen the section title is a short, all-caps line that
// sits directly above the table's column header ("BODY PART … TEMPO NOTES"). We use
// that adjacency as the signal, so we don't need to enumerate every possible title.
function isSectionTitleAboveTable(line: string, lines: string[], i: number): boolean {
  const trimmed = line.trim();
  // Title-only line: starts with a letter, all-caps letters plus spaces / slashes /
  // ampersands / hyphens / apostrophes. Digits are allowed because rotating plans
  // number their days ("LEGS 1"); the adjacency check below is what keeps a
  // volume-table entry like "CHEST 8" out, since nothing follows it but more of
  // the same table.
  if (!/^[A-Z][A-Z0-9 /&'-]*$/.test(trimmed)) return false;
  if (trimmed.split(/\s+/).filter(Boolean).length > 6) return false;
  const next = nextMeaningfulLine(lines, i);
  return next != null && looksLikeTableHeader(next);
}

// Title-case a structurally-detected day name: "BACK / REAR DELT" -> "Back / Rear Delt".
function titleCaseDayName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/(^|[\s/&-])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
}

export function parseTrainingPlan(rawText: string): ParsedPlan {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.replace(/\u00A0/g, ' ').trim())
    .filter((l) => l.length > 0);

  const days: ParsedTrainingDay[] = [];
  const warnings: string[] = [];
  const unparsedLines: string[] = [];

  let currentDay: ParsedTrainingDay | null = null;
  let exercisePosition = 0;
  let lastExercise: ParsedExercise | null = null;
  let inSubsection = false; // true after "CALVES WORKOUT" / "ABS WORKOUT" until next exercise/day
  // Set by a "ROTATION WEEK n" marker and applied to every day beneath it.
  let currentWeek: number | null = null;
  // The body part of the last row that named one, so rows under a merged cell
  // inherit it instead of coming through with none.
  let lastBodyPart: string | null = null;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (looksLikeBoilerplate(line)) continue;
    if (looksLikeTableHeader(line)) continue;

    const week = rotationWeekMarker(line);
    if (week != null) {
      currentWeek = week;
      continue;
    }

    const knownDay = isDayHeader(line);
    const dayName = knownDay
      ? knownDay === 'ABS'
        ? 'Abs'
        : capitaliseDayName(knownDay)
      : isSectionTitleAboveTable(line, lines, idx)
        ? titleCaseDayName(line)
        : null;
    if (dayName) {
      currentDay = {
        name: dayName,
        position: days.length,
        exercises: [],
        inlineNotes: [],
        // The home abs workout sits outside the rotation — it's done every week
        // whichever week the gym days are on.
        weekIndex: dayName === 'Abs' ? null : currentWeek,
      };
      days.push(currentDay);
      exercisePosition = 0;
      lastExercise = null;
      inSubsection = false;
      lastBodyPart = null;
      continue;
    }

    if (!currentDay) continue;

    const rowMatch = matchExerciseRow(line);
    if (rowMatch) {
      const { name, totalSetsStr, repRange, tempoStr, notes } = {
        name: rowMatch.name,
        totalSetsStr: rowMatch.totalSets,
        repRange: rowMatch.repRange,
        tempoStr: rowMatch.tempo,
        notes: rowMatch.notes,
      };
      // A merged body-part cell only prints on its first row, so the rest of the
      // block inherits it.
      const bodyPart = rowMatch.bodyPart ?? lastBodyPart ?? '';
      if (rowMatch.bodyPart) lastBodyPart = rowMatch.bodyPart;
      const tempo =
        tempoStr == null || tempoStr === 'N/A'
          ? null
          : tempoStr.trim().split(/\s+/).join('-');
      const cleanedName = name.trim();
      const cleanedNotes = notes.trim();
      const prettyName = toSentenceCase(cleanedName);
      const prettyBodyPart = toSentenceCase(bodyPart.replace(/\s+/g, ' '));
      const prettyNotes = toSentenceCase(cleanedNotes);
      const cleanedRepRange = repRange.replace(/\s+/g, ' ').trim();
      // Rep range is well-formed if it's a numeric range, single number, or a recognised
      // "Max Reps" / "Max Hold" sentinel. Anything else is flagged for review.
      const repRangeUncertain =
        !cleanedRepRange ||
        !(/^\d+(\s*-\s*\d+)?$/.test(cleanedRepRange) || isRepSentinel(cleanedRepRange));
      // Tempo missing (N/A in the PDF) — flag so the user can supply one if intended.
      const tempoUncertain = tempo === null;
      const exercise: ParsedExercise = {
        bodyPart: prettyBodyPart,
        name: prettyName,
        normalizedName: normalizeName(cleanedName),
        // "SUPERSET" in the total-sets column marks a member of a group rather
        // than a count; how many rounds comes from a "repeat x N" note, applied
        // once the day is fully parsed.
        totalSets: Number.isNaN(parseInt(totalSetsStr, 10)) ? null : parseInt(totalSetsStr, 10),
        supersetColumn: /^superset$/i.test(totalSetsStr),
        repRange: cleanedRepRange,
        tempo,
        notes: prettyNotes,
        setScheme: detectSetScheme(cleanedNotes, repRange),
        position: exercisePosition++,
        repRangeUncertain,
        tempoUncertain,
        weeklyAlternative: detectWeeklyAlternative(cleanedNotes),
        supersetWith: detectSupersetPartners(cleanedNotes),
        supersetGroup: null,
      };
      currentDay.exercises.push(exercise);
      lastExercise = exercise;
      inSubsection = false;
      continue;
    }

    // Sub-section markers ("CALVES WORKOUT", "ABS WORKOUT") and the lines beneath them
    // belong to the day, not to the previous exercise.
    if (/^(CALVES|ABS)\s+WORKOUT/i.test(line)) {
      inSubsection = true;
      currentDay.inlineNotes.push(line);
      continue;
    }

    if (inSubsection) {
      currentDay.inlineNotes.push(line);
      continue;
    }

    // Otherwise — continuation of the previous exercise's notes (e.g. "1 X 8-10 REPS / 1 12-15 REPS BACK OFF",
    // "Optional intensifier for set 3 ...").
    if (lastExercise) {
      const cased = toSentenceCase(line);
      lastExercise.notes = lastExercise.notes ? `${lastExercise.notes} ${cased}` : cased;
      lastExercise.setScheme = detectSetScheme(lastExercise.notes, lastExercise.repRange);
      // The rotation phrase may spill onto a wrapped note line — detect from the
      // freshly-appended line so it isn't lost. Don't overwrite an earlier hit.
      if (!lastExercise.weeklyAlternative) {
        lastExercise.weeklyAlternative = detectWeeklyAlternative(line);
      }
      if ((lastExercise.supersetWith ?? []).length === 0) {
        lastExercise.supersetWith = detectSupersetPartners(line);
      }
      continue;
    }

    currentDay.inlineNotes.push(line);
    unparsedLines.push(`[${currentDay.name}] ${line}`);
  }

  // Pairing needs every row in the day, so it runs once parsing is finished.
  // The sets-column groups are settled first: they're explicit in the table,
  // and claiming their rows stops a stray "superset" in a note from pulling an
  // unrelated exercise into a group.
  for (const d of days) {
    const next = resolveSupersetColumnGroups(d, 1);
    resolveSupersets(d, next);
  }

  if (days.length === 0) {
    warnings.push('No training days found — is this the right PDF?');
  }
  for (const d of days) {
    if (d.exercises.length === 0) {
      warnings.push(`Day "${d.name}" has no exercises detected.`);
    }
  }

  return { days, warnings, unparsedLines };
}

function capitaliseDayName(upper: string): string {
  return upper.charAt(0) + upper.slice(1).toLowerCase();
}
