// Three things Vite does for the app that node's ESM loader does not, filled in
// here so a test script can import app modules directly.
//
//   1. Relative imports leave the extension off; node needs it.
//   2. `import.meta.env` is a Vite build-time value. Under node it is undefined,
//      so any module reaching it (anything importing lib/supabase) dies at
//      import. We rewrite it to read `globalThis.__VITE_ENV__`, which a test can
//      set before importing. This is test-only: the real build never sees it.
//   3. Importing an image gives you its URL under Vite. Node just sees bytes it
//      has no loader for and refuses the whole module, which put every module
//      importing a picture out of reach of a test.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TRY = ['.ts', '.tsx', '/index.ts'];
const ASSET = /\.(webp|png|jpe?g|avif|gif|svg)$/;

export async function resolve(specifier, context, next) {
  const relative = specifier.startsWith('./') || specifier.startsWith('../');
  if (relative && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL) {
    for (const ext of TRY) {
      const candidate = new URL(specifier + ext, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        return next(specifier + ext, context);
      }
    }
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.startsWith('file:') && ASSET.test(url)) {
    // Stand in for Vite's URL string. A test only cares that each asset is a
    // distinct, truthy value — which is exactly what the app gets — so the
    // file's own path does the job without reading a byte of it.
    return {
      format: 'module',
      shortCircuit: true,
      source: `export default ${JSON.stringify(fileURLToPath(url))};`,
    };
  }
  const result = await next(url, context);
  if (!url.startsWith('file:') || !/\.[cm]?tsx?$/.test(url)) return result;
  const source =
    result.source == null ? readFileSync(fileURLToPath(url), 'utf8') : String(result.source);
  if (!source.includes('import.meta.env')) return result;
  return {
    ...result,
    source: source.replaceAll('import.meta.env', '(globalThis.__VITE_ENV__ ?? {})'),
  };
}
