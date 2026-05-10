// Parse coach-note text into per-set modifiers (drops, etc.).
//
// Handles the common patterns we see in The Condition Coaches plans:
//   • "Last set double drop set"  → last set + 2 drops
//   • "Last set drop set"         → last set + 1 drop
//   • "Set 3: 50 reps, drop, 30 reps, drop, 20 reps."
//   • "Dropset superset with reverse grip" → 1 drop on every set
//
// More exotic schemes (muscle round, rest-pause, etc.) are NOT expanded into
// individual rows — those still live as the existing scheme tag and the user
// types out the work manually.

export interface DropTarget {
  repTarget?: number;
}

export interface SetMod {
  drops: DropTarget[];
}

export interface SetModsResult {
  bySetIndex: Map<number, SetMod>;
}

export function parseSetMods(notes: string, totalSets: number): SetModsResult {
  const out = new Map<number, SetMod>();
  const text = (notes ?? '').trim();
  if (!text || totalSets < 1) return { bySetIndex: out };
  const upper = text.toUpperCase();

  // Pattern: explicit "Set N: X reps, drop, Y reps, drop, Z reps"
  // Captures rep numbers per drop target where present.
  const setHeaderRe = /SET\s+(\d+)\s*:\s*([^.]*)/gi;
  for (const match of upper.matchAll(setHeaderRe)) {
    const setIdx = parseInt(match[1], 10);
    if (Number.isNaN(setIdx) || setIdx < 1 || setIdx > totalSets) continue;
    const body = match[2];
    if (!/DROP/.test(body)) continue;
    const chunks = body.split(/\bDROP\b/);
    // chunks[0] is the main set's text; chunks[1..] are drop chunks
    const dropChunks = chunks.slice(1);
    if (dropChunks.length === 0) continue;
    const drops: DropTarget[] = dropChunks.map((chunk) => {
      const repMatch = chunk.match(/(\d+)\s*REPS?/);
      return repMatch ? { repTarget: parseInt(repMatch[1], 10) } : {};
    });
    out.set(setIdx, { drops });
  }

  // Pattern: "last set double drop set" / "last set triple drop set" / "last set drop set"
  if (!out.has(totalSets)) {
    if (/LAST\s+SET\s+TRIPLE\s+DROP/.test(upper) || /TRIPLE\s+DROP\s+ON\s+LAST/.test(upper)) {
      out.set(totalSets, { drops: [{}, {}, {}] });
    } else if (/LAST\s+SET\s+DOUBLE\s+DROP/.test(upper) || /DOUBLE\s+DROP\s+ON\s+LAST/.test(upper)) {
      out.set(totalSets, { drops: [{}, {}] });
    } else if (/LAST\s+SET\s+DROP\s+SET/.test(upper) || /DROP\s+SET\s+ON\s+LAST/.test(upper)) {
      out.set(totalSets, { drops: [{}] });
    }
  }

  // Pattern: blanket "dropset" / "drop set" applied across all sets (no specific set#).
  // Only apply if we haven't already set anything per-set above.
  if (out.size === 0) {
    const blanketDouble = /DOUBLE\s+DROP\s*SET/.test(upper);
    const blanketSingle = !blanketDouble && /\bDROP\s*SET\b/.test(upper);
    if (blanketDouble || blanketSingle) {
      const drops = blanketDouble ? [{}, {}] : [{}];
      for (let i = 1; i <= totalSets; i++) {
        out.set(i, { drops });
      }
    }
  }

  return { bySetIndex: out };
}
