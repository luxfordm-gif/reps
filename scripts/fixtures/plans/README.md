# Plan-upload fixtures

Trainer plans in the layouts the importer has had to learn. Run them with:

```sh
npm run stress:pdfs     # what the parser found, and what it timed
npm test                # the scoreboard, as part of the suite
```

`scripts/test-plan-corpus.mjs` scores every fixture on three things — did it find
the days, did it find the exercises, and does a sample of rows read back exactly
(name, sets, reps). Each fixture has a `floor` it must stay at or above, so
widening the parser for a new trainer's PDF can't quietly break one it already
handled. Neither script writes anything, so both can be run against any checkout
without touching an account's data.

`trainer-formats.mjs` holds the two original formats as extracted text rather
than PDFs. That's the same thing the app stores in `plans.raw_text`, so any real
upload can be turned into a fixture by pasting its `raw_text` in beside them —
which is how a plan that went in wrong becomes a test that keeps it right.

| Fixture | Layout | What it probes |
| --- | --- | --- |
| `trainer-formats.mjs` (A) | `BODY PART \| EXERCISE \| TOTAL SETS \| REP RANGE \| TEMPO \| NOTES` | The original format. Split-keyword day headers |
| `trainer-formats.mjs` (B) | Same table, days titled by body part | Day headers recognised by sitting above a column header |
| `plan-1-beginner-full-body` | Prose under `Day 1` / `Day 2` | `"Goblet Squat - 3 sets of 10 reps"`; a plank in seconds |
| `plan-2-bro-split` | `Exercise / Sets / Reps / Rest` | Weekday headers; no body-part column; `To failure` reps |
| `plan-3-advanced-ppl` | Adds `Tempo / RPE / Coaching Notes` | Lettered supersets (`A1`/`A2`); hyphenated tempo; blank cells as `-` |
| `plan-4-weekly-grid` | One column per weekday | Read down the columns, not across the rows |
| `plan-5-messy-upper-lower` | A coach's notes app | `4x6`, `3 x AMRAP`, inline weights, `UPPER 1 (mon)` headers |
| `plan-6-drop-set-intensifier` | `Work Sets / Reps / Rest / Drop Set Protocol` | Column names we didn't know; long per-set drop protocols |
| `plan-7-station-supersets` | `Order / Exercise / Station / Sets / Reps / Load` | A free-text column mid-row. **Known gap — see below** |
| `plan-8-giant-sets` | Bulleted groups closed by `Rounds: 4` | Sets come from the rounds; the group is one giant set |
| `plan-9-two-week-rotation` | `WEEK A - PUSH` … `WEEK B - LEGS` | Six days across a two-week rotation |
| `plan-10-basic-with-typos` | Prose, typed badly | `3 sets x 10 reps`; `secconds`; names left exactly as written |
| `plan-11-banded-body-part` | One shared header, body-part sections | Muscle groups *are* the days here |
| `plan-12-vertical-labels` | Body-part labels down the left edge | The same captions are bands *inside* a session here |
| `plan-13-per-set-log-grid` | `Exercise / Set 1 … Set 5 / Notes` | A filled-in log: each cell is `load x reps`, not a prescription |
| `plan-14-sheet-rotation` | `Order / Exercise / Rest Period / Reps / Sets / Notes` | A spreadsheet export: tall rows with several lines per cell, `1 x 8-12` over `1 x 12-15`, a title block on every page |

## Known gap: plan 7

Its table puts a free-text station column ("Power rack 2, free weight area")
between the movement's name and its figures. Both stretch, so no token matching
can say where the name ends — the station text ends up in the name, and two rows
read their sets off the wrong column.

Fixing it properly means slicing rows at the header cells' x positions during
extraction instead of re-splitting the joined-up line, which would make every
headed table exact and handle wrapped cells at the same time. Until then the
fixture's floor records where it actually stands rather than claiming a pass.
