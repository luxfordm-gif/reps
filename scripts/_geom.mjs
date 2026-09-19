import { readFile } from 'node:fs/promises';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
const data = new Uint8Array(await readFile('scripts/fixtures/plans/plan-4-weekly-grid.pdf'));
const pdf = await pdfjsLib.getDocument({ data }).promise;
const page = await pdf.getPage(1);
const c = await page.getTextContent();
const items = c.items.filter(i=>i.str && i.str.trim()).map(i=>({x:Math.round(i.transform[4]),y:Math.round(i.transform[5]),s:i.str}));
items.sort((a,b)=> b.y-a.y || a.x-b.x);
let lastY=null;
for (const it of items) {
  if (lastY===null || Math.abs(it.y-lastY)>3) { console.log(`\ny=${it.y}`); lastY=it.y; }
  process.stdout.write(`  [x=${it.x}] ${JSON.stringify(it.s)}`);
}
console.log();
