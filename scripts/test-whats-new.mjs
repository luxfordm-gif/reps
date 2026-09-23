// When the release-notes dialog is allowed to appear.
// Usage: npm test  —  or: node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/test-whats-new.mjs
import { decideWhatsNew } from '../src/lib/whatsNew.ts';
import {
  CHANGELOG_VERSIONS,
  LATEST_CHANGELOG_ENTRY,
  WITHDRAWN_VERSIONS,
} from '../src/lib/changelog.ts';

let failures = 0;
function check(label, actual, expected) {
  if (actual === expected) console.log(`  ✓ ${label}`);
  else {
    failures += 1;
    console.log(`  ✗ ${label}\n      expected ${expected}\n      got      ${actual}`);
  }
}

const LATEST = LATEST_CHANGELOG_ENTRY.version;
const decide = (planPresence, seen, withdrawn = WITHDRAWN_VERSIONS) =>
  decideWhatsNew({ planPresence, seen, latest: LATEST, withdrawn });

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

console.log('\n=== a withdrawn entry is worth the one below it ===');
{
  // 2026-09-22.3 went out, then came back off the changelog: six cosmetic fixes
  // that were never worth stopping anyone for. Devices that dismissed it are
  // still carrying its version, and there are two ways to get them wrong.
  const WITHDRAWN = '2026-09-22.3';
  const BELOW = WITHDRAWN_VERSIONS[WITHDRAWN];

  check('it really is off the changelog', CHANGELOG_VERSIONS.includes(WITHDRAWN), false);
  check('and it maps to a version that exists', CHANGELOG_VERSIONS.includes(BELOW), true);

  // Wrong answer #1: replaying the entry underneath, which they have read.
  check(
    'with nothing shipped since, they are left alone',
    decideWhatsNew({ planPresence: 'plan', seen: WITHDRAWN, latest: BELOW, withdrawn: WITHDRAWN_VERSIONS }),
    'nothing',
  );

  // Wrong answer #2: treating it as unrecognised and quietly re-baselining,
  // which swallows a real release that shipped after it \u2014 2026-09-22.4 carries
  // the fix for menu items that could not be reached at all.
  check('but a real release since is still shown', decide('plan', WITHDRAWN), 'show');
  check('  (and that release is the current one)', LATEST, '2026-09-22.4');

  // Once dismissed, the mark is a version that exists and the rules are ordinary again.
  check('after dismissing it they are up to date', decide('plan', LATEST), 'nothing');
}

console.log('\n=== a withdrawn map cannot hang the app ===');
{
  // Written by hand, so it can be made to point at itself or round in a circle.
  const selfish = { a: 'a' };
  check('self-reference terminates', decideWhatsNew({ planPresence: 'plan', seen: 'a', latest: 'a', withdrawn: selfish }), 'nothing');
  const circle = { a: 'b', b: 'a' };
  check('a cycle terminates', decideWhatsNew({ planPresence: 'plan', seen: 'a', latest: 'z', withdrawn: circle }), 'show');
  const chain = { a: 'b', b: 'c' };
  check('a chain is followed to the end', decideWhatsNew({ planPresence: 'plan', seen: 'a', latest: 'c', withdrawn: chain }), 'nothing');
}

console.log('\n=== an established user is left alone ===');
{
  // Home reports "unknown" while the plan is still loading and while an
  // offline phone can't reach it — neither may cost them their baseline.
  check('loading', decide('unknown', '2026-09-18'), 'wait');
  check('then the plan arrives', decide('plan', '2026-09-18'), 'show');
}

console.log('\n=== the current entry is short ===');
{
  // It stops someone mid-session, so it says what's better and nothing else.
  // Three bullets at most, one plain sentence each. See CLAUDE.md.
  const MAX_BULLETS = 3;
  const MAX_CHARS = 80;
  const { bullets } = LATEST_CHANGELOG_ENTRY;
  check(`no more than ${MAX_BULLETS} bullets`, bullets.length <= MAX_BULLETS, true);
  for (const b of bullets) {
    check(`under ${MAX_CHARS} characters: "${b}"`, b.length <= MAX_CHARS, true);
  }
}

console.log(failures === 0 ? '\nAll good.\n' : `\n${failures} failing.\n`);
process.exit(failures === 0 ? 0 : 1);
