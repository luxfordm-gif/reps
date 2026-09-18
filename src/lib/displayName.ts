/**
 * The name the app greets someone by.
 *
 * Only ever what they told us. An email address is not a name — "luxfordm" or
 * "gym.rat.92" on the home screen reads worse than no name at all, and getting
 * someone's name wrong is the kind of small wrongness a personal app can't
 * afford. With nothing usable the greeting drops the name and stands alone.
 */

/** Longest name we'll render. Matches the check constraint on the column. */
export const MAX_DISPLAY_NAME = 40;

/**
 * What to put after "Good morning," — or null to say just "Good morning."
 *
 * Takes the first word, so someone who typed their full name is greeted the
 * way a person would greet them.
 */
export function greetingName(displayName: string | null | undefined): string | null {
  const trimmed = (displayName ?? '').trim();
  if (!trimmed) return null;
  const first = trimmed.split(/\s+/)[0];
  return first.length > 0 ? first : null;
}

/** Tidy a typed name for storage: collapse whitespace, cap the length, and
 *  treat blank as "no name" rather than an empty string. */
export function cleanDisplayName(input: string): string | null {
  const collapsed = input.trim().replace(/\s+/g, ' ');
  if (!collapsed) return null;
  return collapsed.slice(0, MAX_DISPLAY_NAME);
}
