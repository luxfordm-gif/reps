/// <reference types="vite/client" />

/**
 * When this bundle was built, stamped in by vite.config.ts.
 *
 * Read through a `typeof` guard, never directly: it doesn't exist under the
 * test runner, which imports these modules straight from source with no build
 * step to replace it.
 */
declare const __BUILD_STAMP__: string;
