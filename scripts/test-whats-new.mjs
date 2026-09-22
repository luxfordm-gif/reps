// When the release-notes dialog is allowed to appear.
// Usage: npm test  —  or: node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/test-whats-new.mjs
import { decideWhatsNew } from '../src/lib/whatsNew.ts';

let failures = 0;
function check(label, actual, expected) {
  if (actual === expected) console.log(`  ✓ ${label}`);
  else {
    failures += 1;
    console.log(`  ✗ ${label}\n      expected ${expected}\n      got      ${actual}`);
  }
}

const LATEST = '2026-09-22.3';
const decide = (planPresence, seen) => decideWhatsNew({ planPresence, seen, latest: LATEST });

console.log('\n=== nothing is decided before Home knows ===');
check('no answer yet, nothing recorded', decide('unknown', null), 'wait');
check('no answer yet, something recorded', decide('unknown', '2026-09-18'), 'wait');

console.log('\n=== signing up is not a release you missed ===');
{
  // The bug: sign-in recorded a version, so the next deploy popped the dialog
  // on top of the upload screen for someone who had never used the app.
  check('brand new account, nothing recorded', decide('none', null), 'nothing');
  check('a version recorded before they had a plan is dropped', decide('none', '2026-09-22.2'), 'forget');
  check('and stays dropped', decide('none', null), 'nothing');
  check('so the plan they upload starts the clock quietly', decide('plan', null), 'baseline');
}

console.log('\n=== once there is a plan, a release is news ===');
check('an older version shows', decide('plan', '2026-09-18'), 'show');
check('the current version does not', decide('plan', LATEST), 'nothing');

console.log('\n=== an established user is left alone ===');
{
  // Home reports "unknown" while the plan is still loading and while an
  // offline phone can't reach it — neither may cost them their baseline.
  check('loading', decide('unknown', '2026-09-18'), 'wait');
  check('then the plan arrives', decide('plan', '2026-09-18'), 'show');
}

console.log(failures === 0 ? '\nAll good.\n' : `\n${failures} failing.\n`);
process.exit(failures === 0 ? 0 : 1);
