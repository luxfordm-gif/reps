# Plan-upload stress fixtures

Five trainer-style plan PDFs in formats the importer was *not* built for, used to
find out where the upload pipeline gives up. Run them with:

```sh
npm run stress:pdfs
```

They exist to be hard, not to pass. `scripts/stress-pdfs.mjs` reports what the
parser found and what it lost; it never writes anything, so these can be run
against any checkout without touching an account's data.

| Fixture | Layout | What it probes |
| --- | --- | --- |
| `plan-1-beginner-full-body` | Prose list under `Day 1` / `Day 2` / `Day 3` | Numbered day headers; `"Goblet Squat - 3 sets of 10 reps"` sentence rows |
| `plan-2-bro-split` | Clean table, `Exercise / Sets / Reps / Rest` | Weekday+body-part headers (`MONDAY - CHEST`); no body-part column, no tempo |
| `plan-3-advanced-ppl` | Clean table, `Exercise / Sets / Reps / Tempo / RPE / Rest / Coaching Notes` | Lettered supersets (`A1`/`A2`); hyphenated tempo (`3-1-1-0`); extra RPE column |
| `plan-4-weekly-grid` | Week-at-a-glance grid, one column per weekday | Day-per-column geometry rather than a row-per-exercise table |
| `plan-5-messy-upper-lower` | Handwritten-style notes, no table at all | `4x6` shorthand, inline weights, lowercase headers (`UPPER 1 (mon)`) |
