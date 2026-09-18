// Tests for the date-of-birth boxes: which three-box combinations make a real
// date, which get turned away, and when someone's birthday is close enough to
// say something about.
// Usage: npm test  —  or: node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/test-dob.mjs
import { ageOn, birthdayNote, dobProblem, splitISODate, toISODate } from '../src/lib/dob.ts';

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}\n      expected ${e}\n      got      ${a}`);
  }
}

console.log('\n=== three boxes into one date ===');
check('a plain date', toISODate('5', '3', '1990'), '1990-03-05');
check('already padded', toISODate('05', '03', '1990'), '1990-03-05');
check('the last day of a long month', toISODate('31', '12', '1999'), '1999-12-31');
check('a leap day in a leap year', toISODate('29', '2', '1988'), '1988-02-29');
check('a leap day in a year without one', toISODate('29', '2', '1990'), null);
check('31 April never happened', toISODate('31', '4', '1990'), null);
check('month 13', toISODate('1', '13', '1990'), null);
check('day zero', toISODate('0', '5', '1990'), null);
check('a half-typed year', toISODate('5', '3', '19'), null);
check('nothing typed', toISODate('', '', ''), null);

console.log('\n=== back out into boxes ===');
check('a stored date seeds the boxes', splitISODate('1990-03-05'), { d: '05', m: '03', y: '1990' });
check('nothing stored, nothing seeded', splitISODate(null), { d: '', m: '', y: '' });

console.log('\n=== age ===');
const today = new Date(2026, 8, 18); // 18 September 2026
check('birthday already passed this year', ageOn('1990-03-05', today), 36);
check('birthday still to come', ageOn('1990-12-05', today), 35);
check('birthday is today', ageOn('1990-09-18', today), 36);
check('the day before their birthday', ageOn('1990-09-19', today), 35);

console.log('\n=== what we refuse ===');
check('quiet until all three are filled', dobProblem('5', '3', '19', today), null);
check('quiet with no month yet', dobProblem('5', '', '1990', today), null);
check('a good date passes', dobProblem('5', '3', '1990', today), null);
check('a date that never existed', dobProblem('29', '2', '1990', today), 'That date doesn’t exist.');
check('a birthday in the future', dobProblem('5', '3', '2030', today), 'That’s in the future.');
check('too young', dobProblem('5', '3', '2020', today), 'You need to be at least 13.');
check('exactly 13 today', dobProblem('18', '9', '2013', today), null);
check('13 tomorrow is still too young', dobProblem('19', '9', '2013', today), 'You need to be at least 13.');
check('a year that must be a typo', dobProblem('5', '3', '1900', today), 'Check the year.');

console.log('\n=== birthday, in the right tense ===');
const WEEK = 'Have a great birthday week.';
const PASSED = 'Hope you had a great one.';
const UPCOMING = 'Birthday coming up — hope it’s a good one.';

check('the day itself', birthdayNote('1990-09-18', today), WEEK);
check('tomorrow', birthdayNote('1990-09-19', today), WEEK);
check('six days off, still the week', birthdayNote('1990-09-24', today), WEEK);
check('seven days off has become upcoming', birthdayNote('1990-09-25', today), UPCOMING);
check('a fortnight off', birthdayNote('1990-10-02', today), UPCOMING);
check('a month off, to the day', birthdayNote('1990-10-19', today), UPCOMING);
check('just past a month, nothing', birthdayNote('1990-10-20', today), null);

check('yesterday', birthdayNote('1990-09-17', today), PASSED);
check('a week ago, still looking back', birthdayNote('1990-09-11', today), PASSED);
check('eight days ago, let it go', birthdayNote('1990-09-10', today), null);
check('the far side of the year', birthdayNote('1990-03-05', today), null);

const newYear = new Date(2027, 0, 5); // 5 January 2027
check('December birthday, seen in January', birthdayNote('1990-12-30', newYear), PASSED);
check('January birthday, seen in January', birthdayNote('1990-01-09', newYear), WEEK);
check('a birthday later in January', birthdayNote('1990-01-28', newYear), UPCOMING);
check('a July birthday is nowhere near', birthdayNote('1990-07-01', newYear), null);

// A leap-day birthday has no date to land on in a common year; the nearest
// real day is what we measure from.
const leapish = new Date(2027, 1, 27); // 27 February 2027
check('29 February, two days out in a common year', birthdayNote('1988-02-29', leapish), WEEK);

console.log(failures === 0 ? '\nAll passed.\n' : `\n${failures} failed.\n`);
process.exit(failures === 0 ? 0 : 1);
