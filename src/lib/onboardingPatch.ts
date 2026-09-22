import type { Experience, Gender, ProfilePatch, TopGoal } from './profileApi';

/** The seven questions setup asks, in the order it asks them. */
export type OnboardingQuestion =
  | 'name'
  | 'gender'
  | 'birthday'
  | 'weight'
  | 'height'
  | 'goal'
  | 'experience';

// Name first: it's the one answer the app shows straight back to you.
export const ONBOARDING_QUESTIONS: OnboardingQuestion[] = [
  'name',
  'gender',
  'birthday',
  'weight',
  'height',
  'goal',
  'experience',
];

/** What setup has been told so far, in the shape the screens hold it. */
export interface OnboardingAnswers {
  /** Already cleaned — see lib/displayName. */
  displayName: string | null;
  gender: Gender | null;
  /** YYYY-MM-DD, or '' for not given. */
  dateOfBirth: string;
  startingWeightKg: number | null;
  heightCm: number | null;
  topGoals: TopGoal[];
  experience: Experience | null;
}

export function isAnswered(q: OnboardingQuestion, a: OnboardingAnswers): boolean {
  switch (q) {
    case 'name':
      return a.displayName != null;
    case 'gender':
      return a.gender != null;
    case 'birthday':
      return a.dateOfBirth !== '';
    case 'weight':
      return a.startingWeightKg != null;
    case 'height':
      return a.heightCm != null;
    case 'goal':
      return a.topGoals.length > 0;
    case 'experience':
      return a.experience != null;
  }
}

/** The questions skipped past, in the order they were asked. */
export function unansweredQuestions(a: OnboardingAnswers): OnboardingQuestion[] {
  return ONBOARDING_QUESTIONS.filter((q) => !isAnswered(q, a));
}

/**
 * The answers as a patch for the profile row.
 *
 * Only what was actually answered goes in. A blank is left out rather than
 * written as null, because a skipped question means "not now" and not "delete
 * what's there" — and every exit from setup saves whatever has been filled in
 * so far. Writing the blanks meant opening setup a second time and closing it
 * put a null over every detail already given: a profile that had a name, a
 * gender and a date of birth came back reading "Not set" all the way down.
 *
 * Clearing a detail on purpose is Profile → Personal details' job; it writes
 * the one field being edited.
 */
export function answersToPatch(
  a: OnboardingAnswers,
  questions: OnboardingQuestion[] = ONBOARDING_QUESTIONS
): ProfilePatch {
  const patch: ProfilePatch = {};
  for (const q of questions) {
    if (!isAnswered(q, a)) continue;
    switch (q) {
      case 'name':
        patch.display_name = a.displayName;
        break;
      case 'gender':
        patch.gender = a.gender;
        break;
      case 'birthday':
        patch.date_of_birth = a.dateOfBirth;
        break;
      case 'weight':
        patch.starting_weight_kg = a.startingWeightKg;
        break;
      case 'height':
        patch.height_cm = a.heightCm;
        break;
      case 'goal':
        patch.top_goals = a.topGoals;
        break;
      case 'experience':
        patch.experience_level = a.experience;
        break;
    }
  }
  return patch;
}
