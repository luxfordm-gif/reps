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
  /** Rendered width, when the extractor reports it. Centred cells can only be
   *  placed in a column by their middle, and the middle needs the width. */
  width?: number;
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

// --- week-at-a-glance grids -------------------------------------------------

/** One cell of a grid: the text at a position, after neighbouring words in the
 *  same box have been joined up. */
interface Cell {
  x: number;
  y: number;
  text: string;
}

const CELL_GAP = 25; // px between words before they count as separate cells
const COLUMN_GAP = 60; // px between cells before they count as separate columns
/** A lone wide line is a caption or a footnote spanning the sheet, not a cell. */
const FULL_WIDTH_CHARS = 60;

/** "4 x 6", "3 x 45s", "3x12" — a set prescription rather than a movement. */
const PRESCRIPTION_RE = /^\d{1,2}\s*x\s*\d/i;
/** Anything of the form "… x <number>": a prescription, but also a logged set
 *  like "60 x 12", "Plate 5 x 15" or "BW x 8". A training log writes these
 *  across the row, one per set, which is the opposite of a day grid. */
const CROSS_NUMBER_RE = /\bx\s*\d/i;

function isNameLike(text: string): boolean {
  return /[A-Za-z]{2}/.test(text) && !CROSS_NUMBER_RE.test(text);
}

/** Split one visual line into cells, joining words that sit side by side. */
function cellsOf(line: Line): Cell[] {
  const sorted = [...line.parts].sort((a, b) => a.x - b.x);
  const cells: Cell[] = [];
  for (const p of sorted) {
    const last = cells[cells.length - 1];
    if (last && p.x - last.x <= CELL_GAP + last.text.length * 4) {
      last.text = `${last.text} ${p.str}`.trim();
    } else {
      cells.push({ x: p.x, y: line.y, text: p.str.trim() });
    }
  }
  return cells;
}

/** Group x positions into columns, returning one representative x each. */
function columnCentres(xs: number[]): number[] {
  const sorted = [...xs].sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const x of sorted) {
    const last = groups[groups.length - 1];
    if (last && x - last[last.length - 1] <= COLUMN_GAP) last.push(x);
    else groups.push([x]);
  }
  return groups.map((g) => median(g));
}

/**
 * Read a plan laid out as a week grid — one column per day, one row per slot.
 *
 * Stitching this by rows is what produces "Bench Press Back Squat Pull Ups
 * Deadlift" followed by "4 x 6 4 x 6 4 x 8 3 x 5": five days interleaved into
 * lines that belong to none of them. So when a page has several rows of three
 * or more *named* cells — a numeric table has one name per row and figures in
 * the rest, which is what tells the two apart — we read it down the columns
 * instead, and hand back one day per column with its movements already paired
 * to their set schemes.
 *
 * Returns null when the page isn't a grid, so the ordinary path still runs.
 */
function reconstructGrid(lines: Line[]): string[] | null {
  const byLine = lines.map(cellsOf);
  // A day grid's rows are movements — several names side by side and no figures
  // among them, because the set schemes live on their own line underneath. A
  // per-set training log looks superficially similar but writes "60 x 12" in
  // every column, so requiring the row to be free of those tells them apart.
  const gridRows = byLine.filter(
    (cells) =>
      cells.length >= 3 &&
      cells.filter((c) => isNameLike(c.text)).length >= 3 &&
      !cells.some((c) => CROSS_NUMBER_RE.test(c.text))
  );
  if (gridRows.length < 3) return null;

  const centres = columnCentres(gridRows.flatMap((cells) => cells.map((c) => c.x)));
  if (centres.length < 3) return null;

  // The header is whatever sits above the first row of movements, which is the
  // named row directly above the first set prescription on the page.
  const firstPrescriptionY = Math.max(
    ...byLine
      .filter((cells) => cells.some((c) => PRESCRIPTION_RE.test(c.text)))
      .map((cells) => cells[0].y),
    -Infinity
  );
  if (!Number.isFinite(firstPrescriptionY)) return null;
  const nameRowYs = gridRows.map((cells) => cells[0].y).filter((y) => y > firstPrescriptionY);
  if (nameRowYs.length === 0) return null;
  const firstMovementY = Math.min(...nameRowYs);
  const headerTop = Math.max(...gridRows.map((cells) => cells[0].y));

  // Everything from the header down belongs to the grid; anything above it is
  // the sheet's title block and is kept as-is.
  const preamble: string[] = [];
  const columns: Cell[][] = centres.map(() => []);
  for (const cells of byLine) {
    if (cells.length === 0) continue;
    if (cells[0].y > headerTop) {
      preamble.push(cells.map((c) => c.text).join(' '));
      continue;
    }
    for (const cell of cells) {
      // A single cell running the width of the page is a footnote for the whole
      // plan, not an entry in one day's column.
      if (cells.length === 1 && cell.text.length > FULL_WIDTH_CHARS) {
        preamble.push(cell.text);
        continue;
      }
      let best = 0;
      for (let i = 1; i < centres.length; i++) {
        if (Math.abs(cell.x - centres[i]) < Math.abs(cell.x - centres[best])) best = i;
      }
      columns[best].push(cell);
    }
  }

  const out = [...preamble];
  for (const column of columns) {
    if (column.length === 0) continue;
    column.sort((a, b) => b.y - a.y);
    const headers = column.filter((c) => c.y > firstMovementY).map((c) => c.text);
    const body = column.filter((c) => c.y <= firstMovementY);
    if (headers.length === 0) continue;
    // "MONDAY" over "Upper Push" is one day with two lines of title.
    out.push(headers.join(' - '));
    for (const cell of body) {
      if (PRESCRIPTION_RE.test(cell.text) && out.length > 0) {
        out[out.length - 1] = `${out[out.length - 1]} ${cell.text}`;
      } else {
        out.push(cell.text);
      }
    }
  }
  // Last line of defence. Reading a page as a grid it isn't can drop most of it
  // on the floor, and a plan that silently arrives half-empty is worse than one
  // that doesn't parse at all. If we've ended up with far less than the page
  // had, we were wrong about the layout — hand back nothing and let the
  // ordinary path read it.
  const cellCount = byLine.reduce((n, cells) => n + cells.length, 0);
  if (out.length * 2 < Math.min(lines.length, cellCount)) return null;
  return out;
}

// --- numbered tables with tall rows -----------------------------------------

/**
 * A spreadsheet exported to PDF: ORDER | EXERCISE | REST PERIOD | REPS / SETS |
 * NOTES, with each exercise a tall row whose cells hold several lines —
 * "1 x 8-12" over "1 x 12-15" in one, "Lat pulldown" over "Mag Grip" in
 * another — all centred vertically. Read by lines, one exercise comes out
 * spread over three of them and interleaved with its neighbours, and nothing
 * parses.
 *
 * So this reads it as cells instead. The header row says where each column
 * sits across the page; the numbers in the ORDER column say where each row
 * sits down it (a row runs halfway to the number either side). Every word then
 * belongs to exactly one cell, however many lines that cell spans, and each row
 * is written back out as one line under a header the parser already knows.
 */
type OrderedColumn = 'order' | 'name' | 'setsReps' | 'rest' | 'notes';

const ORDERED_HEADER_CELLS: Array<[RegExp, OrderedColumn]> = [
  [/^(order|#|no\.?)$/i, 'order'],
  [/^(exercises?|movements?)$/i, 'name'],
  [/^(reps?\s*\/\s*sets?|sets?\s*\/\s*reps?|sets?\s*(?:x|&|and)\s*reps?|reps?\s*(?:x|&|and)\s*sets?)$/i, 'setsReps'],
  [/^rest(\s+period)?$/i, 'rest'],
  [/^(notes?|coaching\s+notes|comments|cues)$/i, 'notes'],
];

/** Words closer than this (in PDF units) belong to the same header cell. */
const HEADER_WORD_GAP = 15;

/** "1 x 8-12", "1x 10 -12", "2x 12-15", "1 x 6-10 each". */
const SET_GROUP_RE = /^(\d{1,2})\s*x\s*(\d{1,3}(?:\s*-\s*\d{1,3})?)\s*(each)?$/i;

function widthOf(p: PositionedText): number {
  // Without a reported width, a rough average glyph width is still enough to
  // put a centred cell's middle in the right column.
  return p.width ?? p.str.length * 4.5;
}

function centreOf(p: PositionedText): number {
  return p.x + widthOf(p) / 2;
}

interface HeaderCell {
  kind: OrderedColumn;
  centre: number;
}

/** Read a line as a numbered table's header, or null if it isn't one. */
function orderedHeader(line: Line): HeaderCell[] | null {
  const sorted = [...line.parts].sort((a, b) => a.x - b.x);
  const groups: PositionedText[][] = [];
  for (const p of sorted) {
    const last = groups[groups.length - 1];
    const prev = last?.[last.length - 1];
    if (prev && p.x - (prev.x + widthOf(prev)) <= HEADER_WORD_GAP) last.push(p);
    else groups.push([p]);
  }
  const cells: HeaderCell[] = [];
  for (const g of groups) {
    const text = g.map((p) => p.str.trim()).join(' ').replace(/\s+/g, ' ');
    const hit = ORDERED_HEADER_CELLS.find(([re]) => re.test(text));
    // Every cell has to be one we know, so a line of content can't pass.
    if (!hit) return null;
    const first = g[0];
    const last = g[g.length - 1];
    cells.push({ kind: hit[1], centre: (first.x + last.x + widthOf(last)) / 2 });
  }
  const kinds = cells.map((c) => c.kind);
  if (!kinds.includes('order') || !kinds.includes('name') || !kinds.includes('setsReps')) {
    return null;
  }
  return cells;
}

/** Text of one cell, top line first. */
function cellLines(parts: PositionedText[]): string[] {
  const rows: PositionedText[][] = [];
  for (const p of [...parts].sort((a, b) => b.y - a.y)) {
    const row = rows.find((r) => Math.abs(r[0].y - p.y) <= Y_TOLERANCE);
    if (row) row.push(p);
    else rows.push([p]);
  }
  return rows.map(joinParts).filter(Boolean);
}

/**
 * One exercise, as a line the parser reads under "EXERCISE SETS REPS NOTES".
 *
 * "1 x 12-15" over "1 x 20" is two sets with different targets. The first
 * group's range becomes the exercise's rep range, and any set that differs is
 * spelled out as "Set 2: 20 reps." in the notes, which is the form the per-set
 * reader already turns into its own target.
 */
function orderedRowLine(cells: Record<OrderedColumn, string[]>): string | null {
  const [name, ...subtitle] = cells.name;
  if (!name) return null;

  const groups = cells.setsReps.map((l) => l.match(SET_GROUP_RE));
  const notes: string[] = [];
  // Each note is closed with a full stop, so the next one starts its own
  // sentence rather than running on ("Mag grip set 2: …").
  const sentence = (s: string): string => (/[.!?]$/.test(s) ? s : `${s}.`);
  if (subtitle.length) notes.push(sentence(subtitle.join(' ')));
  const rest = cells.rest.join(' ');
  if (rest && !/^(as\s+needed|[-–—])$/i.test(rest)) notes.push(sentence(`Rest ${rest}`));

  let figures: string;
  if (groups.length > 0 && groups.every(Boolean)) {
    const parsed = groups.map((m) => ({
      sets: parseInt(m![1], 10),
      reps: m![2].replace(/\s+/g, ''),
      each: !!m![3],
    }));
    const head = parsed[0];
    const total = parsed.reduce((n, g) => n + g.sets, 0);
    figures = `${total} ${head.reps}${parsed.every((g) => g.each) ? ' each' : ''}`;
    const perSet: string[] = [];
    let setNo = 0;
    for (const g of parsed) {
      for (let i = 0; i < g.sets; i++) {
        setNo += 1;
        if (g.reps !== head.reps) perSet.push(`Set ${setNo}: ${g.reps} reps.`);
      }
    }
    if (perSet.length) notes.push(perSet.join(' '));
  } else {
    // Not the "N x reps" shape — hand the cell over as written and let the
    // freeform reader have a go at it.
    figures = cells.setsReps.join(' ');
  }

  const coach = cells.notes.join(' ');
  if (coach && !/^[-–—]$/.test(coach)) notes.push(coach);
  return `${name} ${figures} ${notes.join(' ')}`.replace(/\s+/g, ' ').trim();
}

function reconstructOrderedTables(lines: Line[]): string[] | null {
  const headers = lines
    .map((line) => ({ line, cells: orderedHeader(line) }))
    .filter((h): h is { line: Line; cells: HeaderCell[] } => h.cells != null);
  if (headers.length === 0) return null;

  const consumed = new Set<PositionedText>();
  const tables = new Map<Line, string[]>();

  headers.forEach((h, hi) => {
    const floorY = hi + 1 < headers.length ? headers[hi + 1].line.y : -Infinity;
    const region = lines.filter((l) => l.y < h.line.y - Y_TOLERANCE && l.y > floorY);
    const columnOf = (p: PositionedText): OrderedColumn => {
      let best = h.cells[0];
      for (const c of h.cells) {
        if (Math.abs(centreOf(p) - c.centre) < Math.abs(centreOf(p) - best.centre)) best = c;
      }
      return best.kind;
    };

    // Each number in the ORDER column is one exercise, and marks its row.
    const anchors = region
      .flatMap((l) => l.parts)
      .filter((p) => columnOf(p) === 'order' && /^\d{1,2}$/.test(p.str.trim()))
      .map((p) => p.y)
      .sort((a, b) => b - a);
    if (anchors.length === 0) return;

    const lastSpan =
      anchors.length > 1
        ? (anchors[anchors.length - 2] - anchors[anchors.length - 1]) / 2
        : h.line.y - anchors[0];
    const out = ['EXERCISE SETS REPS NOTES'];
    anchors.forEach((y, i) => {
      const top = i === 0 ? h.line.y - Y_TOLERANCE : (anchors[i - 1] + y) / 2;
      const bottom = i === anchors.length - 1 ? y - lastSpan : (y + anchors[i + 1]) / 2;
      const byColumn: Record<OrderedColumn, PositionedText[]> = {
        order: [],
        name: [],
        setsReps: [],
        rest: [],
        notes: [],
      };
      for (const l of region) {
        if (l.y >= top || l.y < bottom) continue;
        for (const p of l.parts) {
          byColumn[columnOf(p)].push(p);
          consumed.add(p);
        }
      }
      const row = orderedRowLine({
        order: cellLines(byColumn.order),
        name: cellLines(byColumn.name),
        setsReps: cellLines(byColumn.setsReps),
        rest: cellLines(byColumn.rest),
        notes: cellLines(byColumn.notes),
      });
      if (row) out.push(row);
    });
    for (const p of h.line.parts) consumed.add(p);
    tables.set(h.line, out);
  });
  if (tables.size === 0) return null;

  // Everything outside the tables stays where it was — except the title block
  // above the page's first day ("TRAINING PROGRAMME", "CLIENT NAME: James").
  // Every note in this layout lives inside a cell, so that block is page
  // furniture, and on page 2 it would otherwise read as a note on the last
  // exercise of page 1. The line directly above the first table is kept: it's
  // the day's name.
  const out: string[] = [];
  let beforeFirstTable: string[] = [];
  for (const l of lines) {
    const table = tables.get(l);
    if (table) {
      out.push(...beforeFirstTable.slice(-1), ...table);
      beforeFirstTable = [];
      continue;
    }
    const left = l.parts.filter((p) => !consumed.has(p));
    if (!left.length) continue;
    if (out.length === 0) beforeFirstTable.push(joinParts(left));
    else out.push(joinParts(left));
  }
  return out.filter((t) => t && !/^\d{1,3}$/.test(t));
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
  // No recognisable table on this page. It may still be a week-at-a-glance grid,
  // where the columns are days rather than fields — reading that by rows gives
  // you one line per week-row with five days' exercises jumbled together.
  if (dataLines.length === 0) {
    const ordered = reconstructOrderedTables(lines);
    if (ordered) return ordered;
    const grid = reconstructGrid(lines);
    if (grid) return grid;
    // Otherwise fall back to a plain Y-ordered join.
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
