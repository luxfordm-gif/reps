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
