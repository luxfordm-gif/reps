// Tests the home-screen install nudge: which browsers get told what, and when
// the banner keeps quiet.
// Usage: npm test  —  or: node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/test-install-prompt.mjs
import {
  chooseInstallAdvice,
  detectIos,
  SNOOZE_MS,
} from '../src/lib/installPrompt.ts';

let failures = 0;
function eq(label, got, want) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}\n      got ${g}\n      want ${w}`);
  }
}

// Real user-agent strings, because this is the one part of the app that can
// only be tested against what browsers actually say about themselves.
const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.6312.52 Mobile/15E148 Safari/604.1',
  iphoneFirefox:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/124.0 Mobile/15E148 Safari/605.1.15',
  instagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 322.0.0.0.0',
  ipadOs:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
};

console.log('\n=== which browser are we in ===');
eq('Safari on an iPhone can install', detectIos(UA.iphoneSafari, 'iPhone', 5), 'safari');
eq('Chrome on iOS cannot', detectIos(UA.iphoneChrome, 'iPhone', 5), 'other');
eq('Firefox on iOS cannot', detectIos(UA.iphoneFirefox, 'iPhone', 5), 'other');
eq("Instagram's in-app browser cannot", detectIos(UA.instagram, 'iPhone', 5), 'other');
// An iPad on iPadOS 13+ claims to be a Mac; touch points are the giveaway.
eq('an iPad pretending to be a Mac is still iOS', detectIos(UA.ipadOs, 'MacIntel', 5), 'safari');
eq('a real Mac is not iOS', detectIos(UA.macSafari, 'MacIntel', 0), null);
eq('Android is not iOS', detectIos(UA.androidChrome, 'Linux armv8l', 5), null);

console.log('\n=== what to say ===');
const base = { installed: false, hasDeferredPrompt: false, ios: null, dismissedAt: null, now: 1_000_000_000 };

eq(
  'a held prompt means a one-tap Install button',
  chooseInstallAdvice({ ...base, hasDeferredPrompt: true }),
  'prompt'
);
eq(
  'Safari on iOS gets the Share-sheet instructions',
  chooseInstallAdvice({ ...base, ios: 'safari' }),
  'ios-safari'
);
eq(
  'another iOS browser is sent to Safari',
  chooseInstallAdvice({ ...base, ios: 'other' }),
  'ios-browser'
);
eq(
  'a browser with no install path is left alone',
  chooseInstallAdvice(base),
  null
);
eq(
  'a real prompt beats the iOS advice',
  chooseInstallAdvice({ ...base, ios: 'safari', hasDeferredPrompt: true }),
  'prompt'
);

console.log('\n=== when to keep quiet ===');
eq(
  'already on the home screen — never ask',
  chooseInstallAdvice({ ...base, installed: true, hasDeferredPrompt: true, ios: 'safari' }),
  null
);
eq(
  'dismissed a moment ago',
  chooseInstallAdvice({ ...base, hasDeferredPrompt: true, dismissedAt: base.now - 1000 }),
  null
);
eq(
  'dismissed just under a month ago — still quiet',
  chooseInstallAdvice({ ...base, hasDeferredPrompt: true, dismissedAt: base.now - (SNOOZE_MS - 1) }),
  null
);
eq(
  'dismissed a month ago — ask again',
  chooseInstallAdvice({ ...base, hasDeferredPrompt: true, dismissedAt: base.now - SNOOZE_MS }),
  'prompt'
);
eq(
  'installed wins over everything, even a stale dismissal',
  chooseInstallAdvice({ ...base, installed: true, ios: 'safari', dismissedAt: 0 }),
  null
);

console.log(failures === 0 ? '\nAll install-prompt tests passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
