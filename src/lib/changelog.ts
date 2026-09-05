// Add a new entry at the TOP of CHANGELOG for every deploy you want
// users to see a "What's new" popup for. That's the only step — the
// app reads CHANGELOG[0] as the current version automatically.

export interface ChangelogEntry {
  version: string;
  emoji: string;
  title: string;
  bullets: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '2026-09-05',
    emoji: '\u{1F3C6}',
    title: "What's new",
    bullets: [
      'The Performance tab is now your records: body weight up top, then your best ever on every machine: heaviest set, estimated 1RM, and the date you hit it. Pull-ups and planks count too (most reps, longest hold), and anything set in the last month is flagged as new',
      'A new plan now starts every machine at zero by default, so you work up to the new rep ranges instead of chasing last block\u2019s numbers \u2014 tap "Carry all over", or pick machine by machine, if you\u2019d rather keep them rolling',
      'Your records are never affected by that: nothing is ever deleted, and the all-time bests are read from every set you have ever logged',
      'Tap any record for that lift\u2019s history \u2014 the weight and reps chart, and every session',
      'The bottom bar is icons only, evenly spaced, so nothing is squashed to one side',
      'A feedback button in the bottom bar \u2014 say what happened and attach a photo or a screen recording. It\u2019s in the workout menu too, since mid-set is when you spot things',
      'Feedback works with no signal: it\u2019s saved on your phone, survives closing the app, and sends itself the moment you\u2019re back online \u2014 the same way your sets do',
    ],
  },
  {
    version: '2026-09-02',
    emoji: '🔄',
    title: "What's new",
    bullets: [
      'The upload review is quieter: your bulk keep-or-reset choice stands on its own, with an "Adjust machine by machine" link when you want exceptions — and the per-machine control is now a clear Carry over | Start fresh switch instead of a checkbox',
      'Two-week rotating plans are supported — Home shows one card per day, and each opens whichever week\'s version you\'re due, swapping automatically once you\'ve done the other (just like the weekly machine alternatives)',
      'A Week 1 | Week 2 switch on the day screen if you want the other version, and the finish screen tells you which week that day runs next time',
      'Start a workout in one tap — the "Today\'s workout" card now has a Start button that drops you straight into the first exercise',
      'Days titled "LEGS 1" or "PUSH 2" are now recognised — plans written that way used to import as nothing at all',
      'Home ab workouts import as a reference card — the movements listed to read, available every week, with no session to start and no sets to log',
      '"Failure", "Max Time" and "Max Hold" rep ranges are understood, and giant sets written down the sets column come in as one group',
      'Anything logged on time or bodyweight — a plank, a max hold — now asks for seconds instead of a weight, and is not capped at 100 like reps',
      'A rest written inside a set — "cluster set 5 sets 5 reps 1 min rest" — no longer gets mistaken for the rest between sets',
    ],
  },
  {
    version: '2026-09-01',
    emoji: '🔁',
    title: "What's new",
    bullets: [
      'Uploading a new plan now keeps your weights on machines you have trained before, instead of resetting them to zero — untick "Keep history" on the review screen for anything you would rather restart',
      'Machines are matched against everything you have ever logged, not just your current plan, so a machine from an older plan is recognised too',
      'The review screen spells out that nothing is deleted either way — a reset only clears the weights the logger pre-fills',
    ],
  },
  {
    version: '2026-08-31',
    emoji: '⏱️',
    title: "What's new",
    bullets: [
      'New plans now set their own rest periods: drop sets run straight through with no timer, deadlifts, squats and leg presses get 2 minutes, and everything else starts at 1 minute',
      'A rest your coach writes into the notes wins — "45 seconds max rest", "minimal rest" and "full recovery" are all read off the PDF',
      'Supersets, tri-sets and giant sets are now paired up properly: log a set and Reps takes you straight to the next movement, then rests once the round is done',
      'The day overview and the upload review both show what each exercise alternates with, and what rest it will start with',
      'The rest pills now include None, so an exercise can be set to run straight through',
    ],
  },
  {
    version: '2026-08-17',
    emoji: '📶',
    title: "What's new",
    bullets: [
      'Reps now works without signal — the app itself is stored on your phone, so it opens instantly in the gym basement',
      'Your plan, your last-time weights and the workout you\'re in the middle of are all kept on the device, so you can train through a dead spot',
      'Sets, weigh-ins and water logged offline are saved on the phone and sync themselves the moment a bar of signal comes back',
      'A small line tells you what\'s still waiting to sync, so you never have to wonder whether a set made it',
      'Saving your body weight now confirms with "Recorded for today" instead of leaving the Save button looking untapped',
      'Add Reps to your home screen for a proper app icon and a full-screen, offline-ready app',
      "Finishing a workout now sticks — no more opening the app to find yesterday's session still running",
      "Opening a workout saves last time's weights and reps to your phone, so the LAST TIME numbers are there even when the signal isn't",
      'Sets you log are kept on the phone whenever a write fails — not just when you are obviously offline',
    ],
  },
  {
    version: '2026-05-16',
    emoji: '✨',
    title: "What's new",
    bullets: [
      "Black splash screen on launch and a tighter, logo-less top across Home, Performance and Profile",
      'New "Copy weekly summary for coach" on Profile — body parts, top lifts and a week-on-week breakdown',
      'Completion screen now opens with a short summary of your session and shows gold/silver/bronze medals next to your top lifts',
      'Tap the LAST TIME pill on an exercise to see every set you logged last session, including drop sets',
      'Weekly chart on Home keeps the popover open by default so you can see what your last workout was at a glance',
      'Done-this-week tick appears on workout cards; "Up next" hides when you\'ve jumped around the plan and comes back when you\'re back in order',
      'Kudos on the exercise screen now reward weight PRs and rep PRs together, with fresher wording',
      'Renaming an exercise to something close to one you already have prompts "Did you mean…?" and merges history if you confirm',
    ],
  },
  {
    version: '2026-05-13',
    emoji: '✨',
    title: "What's new",
    bullets: [
      'Stronger vibration and a bell-style "ding" when the rest timer hits zero',
      'Edit an exercise\'s name from the kebab — choose "same machine" to keep your history or "different machine" to start fresh',
      'New plan uploads now flag coach-note rep overrides (like "Set 3: 50 reps") on a review screen so you can check and edit them before saving',
      'If a new plan has an exercise that looks similar to one from your last plan, the upload review asks whether it\'s the same machine so history carries over',
      "Today's workout now suggests the day you skipped — not the next in plan order — until every plan day is done for the week",
    ],
  },
  {
    version: '2026-05-11',
    emoji: '🏋️',
    title: "What's new",
    bullets: [
      'Tap the green check on a logged set to edit it',
      'Full-screen rest timer with sharp vibration when it ends',
      'Phone stays on while resting',
      'Drop notes for next time and for your coach on the completion screen',
      'New "Copy this week\'s notes for coach" action in Profile',
      'Dumbbell intensifier sets are now editable instead of read-only',
      'Open any past workout from history to tweak a logged set',
    ],
  },
];

export const LATEST_CHANGELOG_ENTRY: ChangelogEntry = CHANGELOG[0];

export function getEntryForVersion(version: string): ChangelogEntry | null {
  return CHANGELOG.find((c) => c.version === version) ?? null;
}
