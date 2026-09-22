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

**An entry earns its place** when a release contains a new capability, a change
in behaviour the user will notice and act on, or a bug that was costing them
something real.

**An entry never gets written** for spacing, alignment, a control made to fit a
narrow phone, an arrow taken off a button — or for changes to the "What's new"
mechanism itself. A release made only of those ships with **no new changelog
entry at all**. That is the normal case, not a failure, and most releases fall
into it.

A pull request description and a changelog entry are different documents with
different audiences. Do not transcribe one into the other. Write the PR up in
full — that's for the repo — then ask of each item separately: *would someone a
month into training on this app want to be stopped to read this?* If nothing
clears the bar, leave `changelog.ts` untouched.

Withdrawing an entry after it has shipped is safe: `decideWhatsNew` treats a
stored version the build doesn't recognise as "re-baseline silently", so nobody
gets replayed notes they have already read. See `src/lib/whatsNew.ts`.

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
