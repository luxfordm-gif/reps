// The app's source omits extensions on relative imports because Vite resolves
// them. Node's ESM loader does not, so a test script that reaches one of those
// modules dies at import. This hook fills the extension in.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TRY = ['.ts', '.tsx', '/index.ts'];

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
