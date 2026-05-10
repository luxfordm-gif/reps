// Extract text from a PDF File using pdfjs-dist. We use the page text-content
// items' transform (x/y) coordinates to reconstruct the line ordering, since
// trainer plans are tabular and naive text extraction can scramble columns.

import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const Y_TOLERANCE = 3; // pixels — items within this Y distance count as one line

export async function extractPdfText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const allLines: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const items = content.items as Array<{ str: string; transform: number[] }>;

    const lines: { y: number; parts: { x: number; str: string }[] }[] = [];

    for (const item of items) {
      if (!item.str || !item.str.trim()) continue;
      const x = item.transform[4];
      const y = item.transform[5];
      let line = lines.find((l) => Math.abs(l.y - y) <= Y_TOLERANCE);
      if (!line) {
        line = { y, parts: [] };
        lines.push(line);
      }
      line.parts.push({ x, str: item.str });
    }

    lines.sort((a, b) => b.y - a.y);
    for (const line of lines) {
      line.parts.sort((a, b) => a.x - b.x);
      const text = line.parts
        .map((p) => p.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) allLines.push(text);
    }
  }

  return allLines.join('\n');
}
