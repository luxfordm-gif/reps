// Preloaded with `node --import ./scripts/register-ts.mjs` so the test scripts
// can import app modules that leave the extension off.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./ts-extension-hooks.mjs', pathToFileURL(import.meta.filename));
