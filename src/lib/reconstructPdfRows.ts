// Reconstructs a trainer plan's table rows from positioned PDF text items.
//
// Trainer plans are laid out as tables: BODY PART | EXERCISE | TOTAL SETS |
// REP RANGE | TEMPO | NOTES. A naive "group text by vertical position" pass
// breaks whenever a cell wraps onto more than one visual line — long exercise
// names and long coach notes are vertically centred in their cell, so they
// straddle the row's data line (the line carrying the numbers). Grouping by Y
// alone then splits one logical row into three physical lines, the data line
// loses its exercise name, and the row fails to parse — the exercise is dropped
// or swallowed into the previous row's notes.
//
// Instead we detect the column geometry (from the numeric SETS/REP/TEMPO block)
// and stitch each row back together: wrapped name fragments (text in the
// exercise column) and wrapped note fragments (text in the notes column) are
// attached to their nearest data line and re-ordered into reading order. The
// result is one clean line per exercise for parseTrainingPlan to consume.

export interface PositionedText {
  x: number;
  y: number;
  str: string;
}

const Y_TOLERANCE = 3; // pixels — items within this Y distance count as one line

const REP = String.raw`\d+(?:\s*-\s*\d+)?|Max\s+Reps|Max\s+Hold`;
const TEMPO = String.raw`\d\s+\d\s+\d\s+\d|N\/A`;
// A line is a "data line" if it contains the sets + rep-range + tempo run.
const DATA_RE = new RegExp(String.raw`(^|\s)(\d{1,2})\s+(${REP})\s+(${TEMPO})(\s|$)`, 'i');
const SETS_HEAD_RE = new RegExp(String.raw`^\d{1,2}\s+(${REP})\s+(${TEMPO})`, 'i');

interface Line {
  y: number;
  parts: PositionedText[];
  sorted: PositionedText[];
  isData: boolean;
  si: number; // index of the sets token in `sorted`
  ni: number; // index where notes begin in `sorted`
  setsX: number;
  bodyX: number;
  tempoEndX: number;
  kind: 'data' | 'name' | 'notes' | 'other';
  nameFrags: Line[];
  notesFrags: Line[];
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function joinParts(parts: PositionedText[]): string {
  return [...parts]
    .sort((a, b) => a.x - b.x)
    .map((p) => p.str)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// First index in the x-sorted parts where the numeric block (sets number,
// followed by rep-range and tempo) begins. -1 if the line has no such block.
function setsIndex(sorted: PositionedText[]): number {
  for (let i = 0; i < sorted.length; i++) {
    if (!/^\d{1,2}$/.test(sorted[i].str)) continue;
    const rest = sorted
      .slice(i)
      .map((p) => p.str)
      .join(' ');
    if (SETS_HEAD_RE.test(rest)) return i;
  }
  return -1;
}

// Index where the NOTES column begins: past sets (1 token), rep-range (1 token)
// and tempo (four single digits, or one "N/A" token).
function notesStartIndex(sorted: PositionedText[], si: number): number {
  let i = si + 1; // past sets
  i += 1; // past rep-range
  if (sorted[i] && /^N\/A$/i.test(sorted[i].str)) i += 1;
  else i += 4; // four single-digit tempo tokens
  return i;
}

export function reconstructRows(items: PositionedText[]): string[] {
  // 1. Cluster items into visual lines by Y.
  const lines: Line[] = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    let line = lines.find((l) => Math.abs(l.y - it.y) <= Y_TOLERANCE);
    if (!line) {
      line = {
        y: it.y,
        parts: [],
        sorted: [],
        isData: false,
        si: -1,
        ni: -1,
        setsX: 0,
        bodyX: 0,
        tempoEndX: 0,
        kind: 'other',
        nameFrags: [],
        notesFrags: [],
      };
      lines.push(line);
    }
    line.parts.push({ x: it.x, y: it.y, str: it.str });
  }
  lines.sort((a, b) => b.y - a.y); // top -> bottom (pdf.js uses a bottom-left origin)

  // 2. Identify data lines and their column anchors.
  for (const l of lines) {
    l.sorted = [...l.parts].sort((a, b) => a.x - b.x);
    l.isData = DATA_RE.test(joinParts(l.parts));
    l.si = l.isData ? setsIndex(l.sorted) : -1;
    if (l.si < 0) l.isData = false;
    if (l.isData) {
      l.ni = notesStartIndex(l.sorted, l.si);
      l.setsX = l.sorted[l.si].x;
      l.bodyX = l.sorted[0].x;
      l.tempoEndX = (l.sorted[l.ni - 1] ?? l.sorted[l.si]).x;
    }
  }
  const dataLines = lines.filter((l) => l.isData);
  // No recognisable table on this page — fall back to a plain Y-ordered join.
  if (dataLines.length === 0) {
    return lines.map((l) => joinParts(l.parts)).filter((t) => t && !/^\d{1,3}$/.test(t));
  }

  const colSetsX = median(dataLines.map((l) => l.setsX));
  const colBodyX = median(dataLines.map((l) => l.bodyX));
  const colTempoEndX = median(dataLines.map((l) => l.tempoEndX));
  const nameLo = colBodyX + 5;
  const nameHi = colSetsX - 5;
  const notesLo = colTempoEndX + 8;

  // 3. Classify each non-data line by which column its text sits in.
  for (const l of lines) {
    if (l.isData) {
      l.kind = 'data';
    } else if (l.parts.every((p) => p.x > nameLo && p.x < nameHi)) {
      l.kind = 'name';
    } else if (l.parts.every((p) => p.x >= notesLo)) {
      l.kind = 'notes';
    } else {
      l.kind = 'other';
    }
  }

  // 4. Attach each wrapped fragment to its nearest data line (same row band).
  for (const l of lines) {
    if (l.kind !== 'name' && l.kind !== 'notes') continue;
    let best: Line | null = null;
    let bestD = Infinity;
    for (const d of dataLines) {
      const dd = Math.abs(d.y - l.y);
      if (dd < bestD) {
        bestD = dd;
        best = d;
      }
    }
    if (best && bestD <= 12) {
      (l.kind === 'name' ? best.nameFrags : best.notesFrags).push(l);
    } else {
      l.kind = 'other'; // no row close enough — leave it as its own line
    }
  }

  // 5. Emit: rebuilt data lines in place, other lines as-is, fragments merged away.
  const out: string[] = [];
  for (const l of lines) {
    if (l.kind === 'name' || l.kind === 'notes') continue;
    if (l.kind !== 'data') {
      out.push(joinParts(l.parts));
      continue;
    }
    const body = l.sorted[0];
    const nameGroup: PositionedText[] = l.sorted.slice(1, l.si);
    for (const f of l.nameFrags) nameGroup.push(...f.parts);
    nameGroup.sort((a, b) => b.y - a.y || a.x - b.x); // reading order: top line first

    const dataCols = l.sorted.slice(l.si, l.ni);

    const notesGroup: PositionedText[] = l.sorted.slice(l.ni);
    for (const f of l.notesFrags) notesGroup.push(...f.parts);
    notesGroup.sort((a, b) => b.y - a.y || a.x - b.x);

    const tokens = [
      body.str,
      ...nameGroup.map((p) => p.str),
      ...dataCols.map((p) => p.str),
      ...notesGroup.map((p) => p.str),
    ];
    out.push(tokens.join(' ').replace(/\s+/g, ' ').trim());
  }
  // Drop bare page numbers (a lone 1-3 digit line) that would otherwise dangle
  // onto the previous exercise's notes.
  return out.filter((t) => t && !/^\d{1,3}$/.test(t));
}
