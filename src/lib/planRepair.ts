import {
  BODY_PARTS,
  NO_DAY_TAG,
  detectSetScheme,
  detectSupersetPartners,
  detectWeeklyAlternative,
  type ParsedExercise,
  type ParsedPlan,
  type ParsedTrainingDay,
} from './parseTrainingPlan';
import { normalizeExerciseName } from './normalizeExerciseName';
import { toSentenceCase } from './textCase';

// Fixing an import before it's saved.
//
// The parser is built for the PDFs we've seen; a trainer we haven't will lay
// things out differently and rows will be missed or mangled. Re-uploading gets
// the same result, so the review screen has to be able to repair the plan by
// hand: add the row that was dropped, fix a wrong count, move an exercise to
// the day it belongs to, give a day its week. Everything here is pure so it can
// be tested without a browser; the screen owns the state.

export function newUid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Give every exercise a stable identity for editing. Idempotent. */
export function withUids(plan: ParsedPlan): ParsedPlan {
  return {
    ...plan,
    days: plan.days.map((d) => ({
      ...d,
      exercises: d.exercises.map((e) => (e.uid ? e : { ...e, uid: newUid() })),
    })),
  };
}

/**
 * Renumber positions to match the current order. savePlan keys history resets
 * by `${day.position}:${exercise.position}`, so after rows have been added,
 * moved or deleted the positions must be made contiguous again before saving.
 */
export function normalizePositions(plan: ParsedPlan): ParsedPlan {
  return {
    ...plan,
    days: plan.days.map((d, i) => ({
      ...d,
      position: i,
      exercises: d.exercises.map((e, j) => ({ ...e, position: j })),
    })),
  };
}

// --- Unparsed lines ------------------------------------------------------------

export interface UnparsedEntry {
  /** The day the line was found under, or null if it came before any day. */
  dayName: string | null;
  /** The line itself, without the day tag. */
  text: string;
  /** The original entry, used as its identity. */
  raw: string;
}

/** "[Legs 1] QUADS ADDUCTOR 2 6-8" → { dayName: 'Legs 1', text: 'QUADS ADDUCTOR 2 6-8' }. */
export function splitUnparsed(raw: string): UnparsedEntry {
  const m = raw.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (!m) return { dayName: null, text: raw.trim(), raw };
  return { dayName: m[1] === NO_DAY_TAG ? null : m[1], text: m[2].trim(), raw };
}

// --- Drafts --------------------------------------------------------------------

/** What the editor sheet edits. A subset of ParsedExercise, all optional-ish. */
export interface ExerciseDraft {
  bodyPart: string;
  name: string;
  totalSets: number | null;
  repRange: string;
  tempo: string | null;
  notes: string;
}

export const EMPTY_DRAFT: ExerciseDraft = {
  bodyPart: '',
  name: '',
  totalSets: 3,
  repRange: '',
  tempo: null,
  notes: '',
};

export function draftFromExercise(e: ParsedExercise): ExerciseDraft {
  return {
    bodyPart: e.bodyPart,
    name: e.name,
    totalSets: e.totalSets,
    repRange: e.repRange,
    tempo: e.tempo,
    notes: e.notes,
  };
}

/** Body parts as they appear in saved plans (sentence case). */
export const BODY_PART_OPTIONS: string[] = BODY_PARTS.map((bp) => toSentenceCase(bp));

const BODY_PART_PATTERNS = [...BODY_PARTS]
  .sort((a, b) => b.length - a.length)
  .map((bp) => ({
    label: toSentenceCase(bp),
    re: new RegExp('^' + bp.replace(/\//g, '\\/').replace(/ /g, '\\s+') + '\\b\\s*', 'i'),
  }));

/**
 * A best guess at an exercise from a line the parser couldn't read.
 *
 * Deliberately lenient where the parser is strict: it will take a row with no
 * tempo, no body part, a three-digit rep count, a hyphenated tempo. The user
 * sees the guess in the editor and corrects whatever's wrong, so a near miss
 * costs a tap, not the row.
 */
export function guessDraftFromText(text: string): ExerciseDraft {
  let rest = text.trim();
  let bodyPart = '';
  for (const { label, re } of BODY_PART_PATTERNS) {
    const m = rest.match(re);
    if (m) {
      bodyPart = label;
      rest = rest.slice(m[0].length);
      break;
    }
  }

  // The name runs up to the first number that stands on its own.
  const numAt = rest.search(/(?:^|\s)\d/);
  const name = numAt > 0 ? rest.slice(0, numAt).trim() : numAt === 0 ? '' : rest.trim();
  let tail = numAt >= 0 ? rest.slice(numAt).trim() : '';

  let totalSets: number | null = null;
  let repRange = '';
  let tempo: string | null = null;
  const m = tail.match(
    /^(\d{1,2})\s+(\d{1,3}(?:\s*-\s*\d{1,3})?|max\s+\w+|failure)(?:\s+(\d\s+\d\s+\d\s+\d|\d-\d-\d-\d|n\/a))?\s*(.*)$/i
  );
  if (m) {
    totalSets = parseInt(m[1], 10);
    repRange = m[2].replace(/\s*-\s*/, '-').replace(/\s+/g, ' ');
    tempo = m[3] && !/n\/a/i.test(m[3]) ? m[3].trim().split(/[\s-]+/).join('-') : null;
    tail = m[4] ?? '';
  }

  return {
    bodyPart,
    name: toSentenceCase(name),
    totalSets,
    repRange,
    tempo,
    notes: toSentenceCase(tail.trim()),
  };
}

/** Normalise a typed tempo: "2 0 1 0", "2-0-1-0", "2010" → "2-0-1-0". Empty → null. */
export function normalizeTempo(input: string | null | undefined): string | null {
  const t = (input ?? '').trim();
  if (!t) return null;
  const digits = t.replace(/[^0-9]/g, '');
  if (digits.length === 4) return digits.split('').join('-');
  return t;
}

/**
 * A full exercise from a draft. `base` keeps whatever the editor doesn't touch
 * — the uid, superset grouping, a confirmed weekly alternative — so editing a
 * name doesn't quietly reset the rest of the row.
 */
export function buildExercise(draft: ExerciseDraft, base?: ParsedExercise): ParsedExercise {
  const name = draft.name.trim();
  const notes = draft.notes.trim();
  const repRange = draft.repRange.trim();
  const tempo = normalizeTempo(draft.tempo);
  const nameChanged = !base || base.name !== name;
  return {
    ...(base ?? {}),
    uid: base?.uid ?? newUid(),
    bodyPart: draft.bodyPart.trim(),
    name,
    // A renamed row is a different machine as far as history goes; an
    // unchanged name keeps an identity the user may have confirmed.
    normalizedName:
      nameChanged || !base?.normalizedName ? normalizeExerciseName(name) : base.normalizedName,
    totalSets: draft.totalSets != null && draft.totalSets > 0 ? Math.floor(draft.totalSets) : null,
    repRange,
    tempo,
    notes,
    setScheme: detectSetScheme(notes, repRange),
    position: base?.position ?? 0,
    repRangeUncertain: false,
    tempoUncertain: tempo == null,
    weeklyAlternative: base?.weeklyAlternative ?? detectWeeklyAlternative(notes),
    supersetWith: base?.supersetWith ?? detectSupersetPartners(notes),
    supersetGroup: base?.supersetGroup ?? null,
    supersetPartnerNames: base?.supersetPartnerNames ?? null,
  };
}

export function newDay(name: string, weekIndex: number | null, position: number): ParsedTrainingDay {
  return {
    name: name.trim(),
    position,
    exercises: [],
    inlineNotes: [],
    weekIndex,
    referenceOnly: false,
  };
}

// --- Validation ----------------------------------------------------------------

/**
 * What stops this plan being saved. Empty means go ahead.
 *
 * An empty day is a blocker, not a warning: saving it gives the user a card on
 * Home that opens onto nothing, and the old screen let that through.
 */
export function planProblems(plan: ParsedPlan): string[] {
  const out: string[] = [];
  if (plan.days.length === 0) {
    out.push('No training days. Add a day, or upload a different PDF.');
    return out;
  }
  for (const d of plan.days) {
    if (!d.name.trim()) out.push('A day has no name.');
    if (d.exercises.length === 0) out.push(`"${d.name}" has no exercises — add some or remove the day.`);
    for (const e of d.exercises) {
      if (!e.name.trim()) out.push(`An exercise in "${d.name}" has no name.`);
    }
  }
  return out;
}
