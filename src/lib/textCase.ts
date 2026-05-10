// Convert SHOUTY trainer-PDF text into clean sentence case while preserving
// fitness abbreviations (EZ, DB, BB, KB, JM, T-bar, ROM, etc.)
//
// Rules:
//  • lowercase by default
//  • first letter of each sentence is capitalised
//  • known abbreviations stay uppercase
//  • "/" is treated like a word boundary so "GLUTES/HAMS" → "Glutes/Hams"

const KEEP_UPPER = new Set([
  'EZ',
  'DB',
  'BB',
  'KB',
  'JM',
  'ROM',
  'AMRAP',
  'EMOM',
  'HIIT',
  'RPE',
  'PR',
  'BW',
  'DL',
  'OHP',
  'RDL',
  'SLDL',
  'BO',
  'BB',
  'KG',
  'LB',
  'LBS',
  'X',
]);

// Words of length 1 — assume single-letter abbreviations should stay uppercase
// (e.g. "T-BAR ROW", "V SQUAT"). But preserve common one-letter words like "a".
const KEEP_SINGLE_UPPER = new Set(['T', 'V', 'X', 'Y', 'Z']);

function castWord(word: string, isFirstInSentence: boolean): string {
  if (!word) return word;
  // Pure number — leave as is
  if (/^\d+(?:[.,]\d+)?$/.test(word)) return word;
  // "1RM", "5kg", "8-10" etc. — leave numerics alone
  if (/^\d/.test(word)) return word;
  const upper = word.toUpperCase();
  if (KEEP_UPPER.has(upper)) return upper;
  if (word.length === 1 && KEEP_SINGLE_UPPER.has(upper)) return upper;
  const lower = word.toLowerCase();
  if (isFirstInSentence) return lower.charAt(0).toUpperCase() + lower.slice(1);
  return lower;
}

export function toSentenceCase(input: string): string {
  if (!input) return input;
  // Split into sentences (very loose: by . ! ? followed by whitespace)
  // We process each sentence separately so first-letter capitalisation works.
  const sentencePattern = /([^.!?]+[.!?]?)/g;
  const sentences = input.match(sentencePattern) ?? [input];
  return sentences
    .map((sentence) => {
      // Split into tokens preserving whitespace and word boundaries
      const tokens = sentence.split(/(\s+|[/(),])/g);
      let firstWordSeen = false;
      return tokens
        .map((tok) => {
          if (!tok) return tok;
          if (/^\s+$/.test(tok) || /^[/(),]$/.test(tok)) return tok;
          const isFirst = !firstWordSeen;
          firstWordSeen = true;
          return castWord(tok, isFirst);
        })
        .join('');
    })
    .join('');
}
