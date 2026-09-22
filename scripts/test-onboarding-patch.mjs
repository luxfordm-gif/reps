// Tests what setup writes to the profile row: which answers make it into a
// patch, and — the bug this exists for — that the questions left blank stay
// out of it, so leaving setup can't null a detail given earlier.
// Usage: npm test  —  or: node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/test-onboarding-patch.mjs
import {
  ONBOARDING_QUESTIONS,
  answersToPatch,
  isAnswered,
  unansweredQuestions,
} from '../src/lib/onboardingPatch.ts';

let failures = 0;
function check(label, cond, detail) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`);
  }
}
function eq(label, got, want) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  check(label, a === b, `got ${a}\n      want ${b}`);
}

const BLANK = {
  displayName: null,
  gender: null,
  dateOfBirth: '',
  startingWeightKg: null,
  heightCm: null,
  topGoals: [],
  experience: null,
};

const FULL = {
  displayName: 'Test',
  gender: 'male',
  dateOfBirth: '1986-03-26',
  startingWeightKg: 82.5,
  heightCm: 180,
  topGoals: ['build_muscle'],
  experience: 'intermediate',
};

console.log('\n=== nothing answered writes nothing ===');
// The one that mattered: opening setup, answering nothing and closing used to
// send seven nulls, emptying a profile that was already filled in.
eq('a blank run is an empty patch', answersToPatch(BLANK), {});
eq('every question is outstanding', unansweredQuestions(BLANK), ONBOARDING_QUESTIONS);

console.log('\n=== a full run writes all of it ===');
eq('all seven columns', answersToPatch(FULL), {
  display_name: 'Test',
  gender: 'male',
  date_of_birth: '1986-03-26',
  starting_weight_kg: 82.5,
  height_cm: 180,
  top_goals: ['build_muscle'],
  experience_level: 'intermediate',
});
eq('nothing outstanding', unansweredQuestions(FULL), []);

console.log('\n=== a part-finished run writes only what it was told ===');
const PART = { ...BLANK, displayName: 'Test', gender: 'female', dateOfBirth: '1990-01-02' };
eq('the three given', answersToPatch(PART), {
  display_name: 'Test',
  gender: 'female',
  date_of_birth: '1990-01-02',
});
eq('the four skipped', unansweredQuestions(PART), [
  'weight',
  'height',
  'goal',
  'experience',
]);
check(
  'no key is present holding null',
  Object.values(answersToPatch(PART)).every((v) => v != null)
);

console.log('\n=== one step at a time ===');
// What Continue sends: the step just answered, and only that step.
eq('the step answered', answersToPatch(FULL, ['weight']), { starting_weight_kg: 82.5 });
eq('a step left blank sends nothing', answersToPatch(BLANK, ['weight']), {});

console.log('\n=== what counts as answered ===');
check('an empty date is not a birthday', !isAnswered('birthday', BLANK));
check('no goals picked is not an answer', !isAnswered('goal', { ...BLANK, topGoals: [] }));
check('one goal is', isAnswered('goal', { ...BLANK, topGoals: ['fat_loss'] }));
// Zero is a real answer to both of these, and must not read as blank.
check('a zero weight still counts', isAnswered('weight', { ...BLANK, startingWeightKg: 0 }));
check('a zero height too', isAnswered('height', { ...BLANK, heightCm: 0 }));
eq('and zero is written, not dropped', answersToPatch({ ...BLANK, heightCm: 0 }, ['height']), {
  height_cm: 0,
});

console.log(failures === 0 ? '\nAll passed.\n' : `\n${failures} failed.\n`);
process.exit(failures === 0 ? 0 : 1);
