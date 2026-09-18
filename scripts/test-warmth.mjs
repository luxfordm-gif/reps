// Tests what the day screen counts as "ready to log offline": an exercise you
// have never trained has no weights to fetch, so it must not be reported as a
// download that hasn't happened. Nothing here touches the network — the warm
// itself is exercised in the browser.
// Usage: npm test  —  or: node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/test-warmth.mjs

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

const USER = '11111111-1111-1111-1111-111111111111';

// sessionsApi reaches for localStorage at module scope, and reads the signed-in
// id from it, so seed the store before the import.
const store = new Map();
store.set('reps.userId', USER);
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
Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: false },
  configurable: true,
});
globalThis.addEventListener = () => {};
globalThis.__VITE_ENV__ = { VITE_SUPABASE_URL: 'https://test.invalid', VITE_SUPABASE_KEY: 'test' };

function cache(name, value) {
  store.set(`reps.cache.${USER}.${name}`, JSON.stringify(value));
}

/** A warmed entry holding one real set. */
function withSets(completedAt, baselineResetAt = null) {
  return {
    sets: [
      {
        id: 's1',
        session_id: 'sess1',
        set_index: 0,
        weight_kg: 40,
        reps: 8,
        completed_at: completedAt,
        exercise_normalized_name: 'x',
      },
    ],
    sessionId: 'sess1',
    cachedAt: '2026-09-18T06:00:00.000Z',
    baselineResetAt,
  };
}

/** The marker a warm leaves when the server had no history for a machine. */
function empty(baselineResetAt = null) {
  return { sets: [], sessionId: null, cachedAt: '2026-09-18T06:00:00.000Z', baselineResetAt };
}

const { lastSetsWarmth } = await import('../src/lib/sessionsApi.ts');

console.log('warmth counts an answered exercise as covered');
{
  cache('lastSets.trained', withSets('2026-09-10T10:00:00.000Z'));
  cache('lastSets.never-trained', empty());
  const warmth = lastSetsWarmth([
    { normalized_name: 'trained' },
    { normalized_name: 'never-trained' },
    { normalized_name: 'not-fetched' },
  ]);
  check('weights on the phone count', warmth.covered >= 1, true);
  check('a machine with no history counts too', warmth, { covered: 2, total: 3 });
}

console.log('\na re-baselined exercise reopens the question');
{
  store.clear();
  store.set('reps.userId', USER);
  cache('lastSets.moved', empty('2026-01-01T00:00:00.000Z'));
  check(
    'the marker still speaks for its own baseline',
    lastSetsWarmth([{ normalized_name: 'moved', baseline_reset_at: '2026-01-01T00:00:00.000Z' }]),
    { covered: 1, total: 1 }
  );
  check(
    'but not for a newer one',
    lastSetsWarmth([{ normalized_name: 'moved', baseline_reset_at: '2026-06-01T00:00:00.000Z' }]),
    { covered: 0, total: 1 }
  );
  check(
    'nor for no baseline at all',
    lastSetsWarmth([{ normalized_name: 'moved' }]),
    { covered: 0, total: 1 }
  );
}

console.log('\nsets cached before a baseline are not "last time"');
{
  store.clear();
  store.set('reps.userId', USER);
  cache('lastSets.stale', withSets('2026-01-05T10:00:00.000Z', null));
  check(
    'weights from before the reset stop counting',
    lastSetsWarmth([{ normalized_name: 'stale', baseline_reset_at: '2026-06-01T00:00:00.000Z' }]),
    { covered: 0, total: 1 }
  );
}

console.log('\nthe legacy cache shape still counts');
{
  store.clear();
  store.set('reps.userId', USER);
  // Phones upgrading from an older build hold a bare array here.
  cache('lastSets.old', withSets('2026-09-10T10:00:00.000Z').sets);
  check('a bare array of sets is an answer', lastSetsWarmth([{ normalized_name: 'old' }]), {
    covered: 1,
    total: 1,
  });
}

console.log('\nduplicates are counted once');
{
  store.clear();
  store.set('reps.userId', USER);
  cache('lastSets.dup', empty());
  check(
    'the same machine twice in a day is one exercise',
    lastSetsWarmth([{ normalized_name: 'dup' }, { normalized_name: 'dup' }]),
    { covered: 1, total: 1 }
  );
}

if (failures > 0) {
  console.log(`\n${failures} failing`);
  process.exit(1);
}
console.log('\nall good');
