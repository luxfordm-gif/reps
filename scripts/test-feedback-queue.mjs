// Tests the shape of a queued feedback op: what the outbox stores when a report
// is written with no signal, and that discarding one takes its attachments with
// it. The replay itself needs Supabase and is exercised in the browser.
// Usage: npm test  —  or: node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/test-feedback-queue.mjs

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ✓ ${label}`);
  else {
    failures += 1;
    console.log(`  ✗ ${label}\n      expected ${e}\n      got      ${a}`);
  }
}

// The outbox reaches for localStorage, crypto and IndexedDB at module scope, so
// stand up just enough of a browser for it to load in node.
const store = new Map();
globalThis.window = {
  localStorage: {
    get length() { return store.size; },
    key: (i) => [...store.keys()][i] ?? null,
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  addEventListener() {},
  removeEventListener() {},
  setTimeout: () => 0,
  clearTimeout() {},
  navigator: { onLine: false },
};
globalThis.localStorage = globalThis.window.localStorage;
// node defines navigator as a getter-only global, so redefine rather than assign.
Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: false },
  configurable: true,
});
globalThis.addEventListener = () => {};
// Read by the test loader's import.meta.env shim (scripts/ts-extension-hooks.mjs).
globalThis.__VITE_ENV__ = { VITE_SUPABASE_URL: 'https://test.invalid', VITE_SUPABASE_KEY: 'test' };
// No IndexedDB: the blob store must degrade rather than throw on import.

const { enqueue, listOutbox, discardEntry, describeEntry } = await import(
  '../src/lib/offline/outbox.ts'
);

const USER = '11111111-1111-1111-1111-111111111111';

console.log('\n=== a report written with no signal ===');
enqueue(USER, {
  kind: 'feedback',
  row: {
    id: 'ffffffff-0000-0000-0000-000000000001',
    kind: 'bug',
    message: 'Rest timer kept resetting on the superset',
    context: { screen: 'exercise:2', queuedOffline: true },
  },
  attachments: [{ blobId: 'blob-1', name: 'clip.mp4', type: 'video/mp4' }],
});

let queued = listOutbox();
check('one entry queued', queued.length, 1);
check('it is a feedback op', queued[0].op.kind, 'feedback');
check('the words are kept verbatim', queued[0].op.row.message, 'Rest timer kept resetting on the superset');
check('the screen it happened on is kept', queued[0].op.row.context.screen, 'exercise:2');
check('marked as queued offline', queued[0].op.row.context.queuedOffline, true);
check('the attachment travels by id, not by value', queued[0].op.attachments, [
  { blobId: 'blob-1', name: 'clip.mp4', type: 'video/mp4' },
]);
check('nothing has been attempted yet', queued[0].attempts, 0);
check('described for the sync sheet', describeEntry(queued[0]), 'Feedback · 1 attachment');

console.log('\n=== it survives alongside workout writes ===');
enqueue(USER, {
  kind: 'create_session',
  row: { id: 'sess-1', training_day_id: 'day-1', started_at: '2026-09-05T10:00:00.000Z' },
});
enqueue(USER, { kind: 'delete_session', id: 'sess-1' });
queued = listOutbox();
check(
  'discarding a workout does not discard the report',
  queued.filter((e) => e.op.kind === 'feedback').length,
  1
);

console.log('\n=== discarding it ===');
const entry = listOutbox().find((e) => e.op.kind === 'feedback');
discardEntry(entry.id);
check('the report is gone', listOutbox().filter((e) => e.op.kind === 'feedback').length, 0);

console.log('\n=== plural attachments read correctly ===');
enqueue(USER, {
  kind: 'feedback',
  row: { id: 'ffffffff-0000-0000-0000-000000000002', kind: 'idea', message: 'x', context: {} },
  attachments: [
    { blobId: 'b1', name: 'a.png', type: 'image/png' },
    { blobId: 'b2', name: 'b.png', type: 'image/png' },
  ],
});
const two = listOutbox().find((e) => e.op.kind === 'feedback');
check('two attachments', describeEntry(two), 'Feedback · 2 attachments');
enqueue(USER, {
  kind: 'feedback',
  row: { id: 'ffffffff-0000-0000-0000-000000000003', kind: 'idea', message: 'y', context: {} },
  attachments: [],
});
const none = listOutbox().filter((e) => e.op.kind === 'feedback').at(-1);
check('no attachments', describeEntry(none), 'Feedback');

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
