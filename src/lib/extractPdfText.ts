// Extract text from a PDF File using pdfjs-dist. We use the page text-content
// items' transform (x/y) coordinates to reconstruct the table rows, since
// trainer plans are tabular and naive text extraction scrambles columns and
// splits wrapped cells (long exercise names / notes) away from their row.

import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { reconstructRows, type PositionedText } from './reconstructPdfRows';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export async function extractPdfText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const allLines: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const items = content.items as Array<{ str: string; transform: number[] }>;

    const positioned: PositionedText[] = [];
    for (const item of items) {
      if (!item.str || !item.str.trim()) continue;
      positioned.push({ x: item.transform[4], y: item.transform[5], str: item.str });
    }

    // Column geometry is per-page (headers repeat on each page), so reconstruct
    // each page independently.
    allLines.push(...reconstructRows(positioned));
  }

  return allLines.join('\n');
}
