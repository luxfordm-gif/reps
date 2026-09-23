# Reps

A training app: you upload your coach's plan as a PDF, and Reps turns it into
days you can work through and log sets against. It runs on a phone, in a gym,
often on bad signal.

## Who is on the other side of the screen

Someone mid-session, holding a phone in one hand. Every interruption is paid for
out of their attention while they are trying to train. That framing decides most
of the calls below.

## "What's new"

`src/lib/changelog.ts` drives a dialog that stops a user to read it. An entry
there has to be worth being stopped for.

**It is about improvements, never bugs.** An entry earns its place when a
release makes the app better: a new capability, a change in how something works
that the user will notice, or a layout that's noticeably better on their phone
(e.g. "Screens hold still when the keyboard opens on iPhone"). Bug fixes never go
in — not even framed as "no longer…". Fixes belong in the PR description.

**It is short.** At most three bullets, each one plain sentence of about ten
words — what's better, not how or why. No second clauses, no lists of screens,
no explanations. `scripts/test-whats-new.mjs` fails the build if the top entry
has more than three bullets or any bullet over 80 characters.

**An entry never gets written** for spacing, alignment, an arrow taken off a
button, a debugging aid like a build number — or for changes to the "What's new"
mechanism itself. A release made only of those, or only of bug fixes, ships with
**no new changelog entry at all**. That is the normal case, not a failure, and
most releases fall into it.

A pull request description and a changelog entry are different documents with
different audiences. Do not transcribe one into the other. Write the PR up in
full — that's for the repo — then ask of each item separately: *is this an
improvement someone a month into training on this app would want to be stopped
for?* If nothing clears the bar, leave `changelog.ts` untouched.

Withdrawing an entry after it has shipped is safe if it's mapped in
`WITHDRAWN_VERSIONS` to the entry below it, so nobody gets replayed notes they
have already read. Rewriting the top entry in place, keeping its version, is also
safe: people who dismissed it aren't shown it again. See `src/lib/whatsNew.ts`.

## Copy

All user-facing strings are **sentence case**. Headings, buttons, labels, empty
states, toasts — "Upload plan", not "Upload Plan"; "Start workout", not "Start
Workout". Proper nouns keep their capitals.

Write the way the app already talks: plain, specific, no marketing register, no
exclamation marks. Say what happened and what it means for the user.

## Tests

`npm test` runs every `scripts/test-*.mjs` against the real modules — no test
framework, no mocks, `node --experimental-strip-types`. Add cases to the
existing file for the area you touched rather than starting a new harness.

`npm run build` is `tsc -b && vite build` and must pass. `npm run lint` is
eslint and currently reports 20 pre-existing `react-hooks` errors across twelve
files — don't try to fix those in an unrelated PR, but don't add to the count
either: compare against a clean checkout before blaming your own change.
