// Bump VERSION whenever you ship a release you want users to see a
// "What's new" popup for. Add an entry at the top of CHANGELOG.
export const APP_VERSION = '2026-05-11';

export interface ChangelogEntry {
  version: string;
  emoji: string;
  title: string;
  bullets: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
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

export function getEntryForVersion(version: string): ChangelogEntry | null {
  return CHANGELOG.find((c) => c.version === version) ?? null;
}
