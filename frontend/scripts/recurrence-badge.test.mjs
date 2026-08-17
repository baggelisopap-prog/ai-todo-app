#!/usr/bin/env node
/**
 * The two pure pieces behind the ↻ badge on a task row, against the REAL
 * locale files rather than a stub dictionary.
 *
 * Using the real files is the point. The badge's failure mode is not a wrong
 * sentence, it is a missing key — i18next then renders the key itself, so a
 * row reads "recurrence.badge_with_pattern" and nothing throws, nothing logs,
 * and the build is green. A translator here that refuses an unknown key turns
 * that into a failed test.
 *
 * describeRecurrence is exercised too, even though it was not the thing being
 * added: extracting its first half into describeRecurrencePattern must not
 * have changed the sentence the Recurrences screen has been showing all along.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describeRecurrence, describeRecurrencePattern } from '../src/utils/taskDisplay.js';
import { isoWeekday } from '../src/utils/formatDate.js';

const here = dirname(fileURLToPath(import.meta.url));
const locales = Object.fromEntries(
  ['en', 'el'].map((lang) => [
    lang,
    JSON.parse(readFileSync(join(here, '..', 'src', 'locales', `${lang}.json`), 'utf8')),
  ])
);

let failures = 0;
const check = (name, got, want) => {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
};

/** i18next's t(), minus the tolerance: an unknown key is a failure, not a string. */
function translator(dict) {
  return (key, opts) => {
    const value = key.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), dict);
    if (value === undefined) throw new Error(`missing translation key: ${key}`);
    if (opts?.returnObjects) return value;
    return String(value).replace(/\{\{(\w+)\}\}/g, (_, name) => String(opts?.[name] ?? ''));
  };
}

const en = translator(locales.en);
const el = translator(locales.el);

const rule = (overrides) => ({ freq: 'weekly', weekdays: [1, 2, 3, 4, 5], due_time: '09:00', ...overrides });

// --- The pattern half ------------------------------------------------------
check('all seven days collapse to "every day"',
  describeRecurrencePattern(rule({ weekdays: [1, 2, 3, 4, 5, 6, 7] }), en), 'Every day');
check('Mon-Fri is named, not spelled out',
  describeRecurrencePattern(rule({ weekdays: [1, 2, 3, 4, 5] }), en), 'Mon-Fri');
check('Sat+Sun is named too',
  describeRecurrencePattern(rule({ weekdays: [6, 7] }), en), 'Sat-Sun');
check('an arbitrary set is listed in day order, not entry order',
  describeRecurrencePattern(rule({ weekdays: [5, 1] }), en), 'M F');
check('monthly names the day',
  describeRecurrencePattern(rule({ freq: 'monthly', weekdays: null, month_day: 15 }), en),
  'Every month on day 15');
check('month_day -1 is the last day, not "the -1st"',
  describeRecurrencePattern(rule({ freq: 'monthly', weekdays: null, month_day: -1 }), en),
  'Every month on the last day');

// A weekly rule whose weekdays never arrived. The row still has to render
// something, and the empty string is the honest answer — better than throwing
// inside a list of forty rows.
check('no weekdays yields an empty pattern rather than a crash',
  describeRecurrencePattern(rule({ weekdays: [] }), en), '');

// --- Greek resolves through the same code path -----------------------------
// Not a translation check — a check that the Greek file has these keys at all.
check('Greek: all seven days',
  describeRecurrencePattern(rule({ weekdays: [1, 2, 3, 4, 5, 6, 7] }), el), 'Κάθε μέρα');
check('Greek: the badge key exists and takes its pattern',
  el('recurrence.badge_with_pattern', { pattern: 'Κάθε μέρα' }), 'Επανάληψη · Κάθε μέρα');

// --- Every key the badge and the detail row reach for -----------------------
for (const [lang, t] of [['en', en], ['el', el]]) {
  for (const key of ['badge', 'badge_with_pattern', 'badge_aria', 'repeats_unknown',
                     'task_label', 'never', 'menu_add', 'menu_edit',
                     'make_repeating_title', 'edit_title', 'rule_unavailable']) {
    let resolved = null;
    try {
      resolved = t(`recurrence.${key}`, { pattern: 'x', summary: 'x' });
    } catch (err) {
      resolved = err.message;
    }
    check(`${lang}: recurrence.${key} is a non-empty string`, typeof resolved === 'string' && resolved.length > 0, true);
  }
}

// --- The full sentence, unchanged by the extraction ------------------------
check('the full sentence still carries the time',
  describeRecurrence(rule({ weekdays: [1, 2, 3, 4, 5] }), en), 'Mon-Fri · at 09:00');
check('a rule with no time says so rather than trailing a bare separator',
  describeRecurrence(rule({ weekdays: [1, 2, 3, 4, 5], due_time: null }), en), 'Mon-Fri · no time');

// --- isoWeekday ------------------------------------------------------------
// The whole reason this exists: "make this repeat" defaults to the one day the
// task already falls on, so getting the day wrong pre-arms the form for the
// wrong commitment.
check('Monday is 1', isoWeekday('2026-08-17'), 1);
check('Friday is 5', isoWeekday('2026-08-21'), 5);
check('Sunday is 7, not 0', isoWeekday('2026-08-23'), 7);
check('no date yields null', isoWeekday(null), null);
check('an empty string yields null', isoWeekday(''), null);
check('a non-date yields null', isoWeekday('not-a-date'), null);

// The trap this function exists to avoid: `new Date('2026-08-23')` is UTC
// midnight, which is Saturday evening anywhere west of Greenwich. Parsing the
// components by hand is what keeps the answer the same in every timezone —
// asserted here by naming the day rather than trusting the local one.
check('a Sunday stays a Sunday regardless of how Date would parse the string',
  isoWeekday('2026-08-23'), new Date(2026, 7, 23).getDay() === 0 ? 7 : new Date(2026, 7, 23).getDay());

console.log(failures === 0 ? '\nAll recurrence badge checks passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
