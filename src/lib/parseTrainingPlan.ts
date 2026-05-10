import { toSentenceCase } from './textCase';

// Parses the raw text of a trainer's training plan PDF (The Condition Coaches format)
// into a structured plan with days, exercises, prescribed sets/reps/tempo and notes.
//
// The PDF has 5 main day sections (PUSH, PULL, LEGS, UPPER, ARMS) plus an Abdominals
// section, each containing a table of rows in the shape:
//   BODY_PART  EXERCISE_NAME  TOTAL_SETS  REP_RANGE  TEMPO(4 digits)  NOTES?
//
// Loose rules — parser surfaces unparsed lines as warnings rather than crashing.

export type SetScheme =
  | 'standard'
  | 'dropset'
  | 'superset'
  | 'muscle_round'
  | 'rest_pause'
  | 'hold';

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
}

export interface ParsedTrainingDay {
  name: string;
  position: number;
  exercises: ParsedExercise[];
  inlineNotes: string[]; // lines like "CALVES WORKOUT" notes that weren't exercise rows
}

export interface ParsedPlan {
  days: ParsedTrainingDay[];
  warnings: string[];
  unparsedLines: string[];
}

const DAY_HEADERS = ['PUSH', 'PULL', 'LEGS', 'UPPER', 'ARMS'];
const ABDOMINALS_HEADER = 'Abdominals 2x Per Week';

const BODY_PARTS = [
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

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function detectSetScheme(notes: string, repRange: string): SetScheme {
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
  if (/SUPERSET/.test(upper)) return 'superset';
  if (/MAX HOLD/i.test(repRange)) return 'hold';
  return 'standard';
}

// Match an exercise row. Body parts are matched first (longest first so REAR DELTS / GLUTES/HAMS
// take precedence over BACK / GLUTES). After body part, capture the exercise name (up to the first
// integer that's followed by a space and another integer or rep-range).
const ROW_REGEX = (() => {
  const bodyPartAlt = BODY_PARTS.map((bp) =>
    bp.replace(/\//g, '\\/').replace(/ /g, '\\s+')
  ).join('|');
  // Exercise name = lazy capture of letters/spaces/punct, ending before the sets count
  // Sets = 1-2 digit integer
  // Rep range = either "<num>-<num>" or "Max Reps" or "Max Hold"
  // Tempo = four single-digit numbers separated by single spaces, OR "N/A"
  // Notes = rest of the line (optional)
  return new RegExp(
    String.raw`^(${bodyPartAlt})\s+(.+?)\s+(\d{1,2})\s+(\d+(?:\s*-\s*\d+)?|Max\s+Reps|Max\s+Hold)\s+(\d\s+\d\s+\d\s+\d|N\/A)(?:\s+(.*))?$`,
    'i'
  );
})();

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
  if (DAY_HEADERS.includes(trimmed.toUpperCase())) return trimmed.toUpperCase();
  if (trimmed === ABDOMINALS_HEADER) return 'ABS';
  if (/^Abdominals\s+\d+x?\s+Per\s+Week/i.test(trimmed)) return 'ABS';
  return null;
}

export function parseTrainingPlan(rawText: string): ParsedPlan {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.replace(/ /g, ' ').trim())
    .filter((l) => l.length > 0);

  const days: ParsedTrainingDay[] = [];
  const warnings: string[] = [];
  const unparsedLines: string[] = [];

  let currentDay: ParsedTrainingDay | null = null;
  let exercisePosition = 0;
  let lastExercise: ParsedExercise | null = null;
  let inSubsection = false; // true after "CALVES WORKOUT" / "ABS WORKOUT" until next exercise/day

  for (const line of lines) {
    if (looksLikeBoilerplate(line)) continue;
    if (looksLikeTableHeader(line)) continue;

    const dayName = isDayHeader(line);
    if (dayName) {
      currentDay = {
        name: dayName === 'ABS' ? 'Abs' : capitaliseDayName(dayName),
        position: days.length,
        exercises: [],
        inlineNotes: [],
      };
      days.push(currentDay);
      exercisePosition = 0;
      lastExercise = null;
      inSubsection = false;
      continue;
    }

    if (!currentDay) continue;

    const rowMatch = line.match(ROW_REGEX);
    if (rowMatch) {
      const [, bodyPart, name, totalSetsStr, repRange, tempoStr, notes = ''] = rowMatch;
      const tempo = tempoStr === 'N/A' ? null : tempoStr.trim().split(/\s+/).join('-');
      const cleanedName = name.trim();
      const cleanedNotes = notes.trim();
      const prettyName = toSentenceCase(cleanedName);
      const prettyBodyPart = toSentenceCase(bodyPart.replace(/\s+/g, ' '));
      const prettyNotes = toSentenceCase(cleanedNotes);
      const exercise: ParsedExercise = {
        bodyPart: prettyBodyPart,
        name: prettyName,
        normalizedName: normalizeName(cleanedName),
        totalSets: Number.isNaN(parseInt(totalSetsStr, 10)) ? null : parseInt(totalSetsStr, 10),
        repRange: repRange.replace(/\s+/g, ' ').trim(),
        tempo,
        notes: prettyNotes,
        setScheme: detectSetScheme(cleanedNotes, repRange),
        position: exercisePosition++,
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
      continue;
    }

    currentDay.inlineNotes.push(line);
    unparsedLines.push(`[${currentDay.name}] ${line}`);
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
