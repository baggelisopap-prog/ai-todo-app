#!/usr/bin/env node
/**
 * The shared filter state, as pure functions, against the REAL locale files.
 *
 * Same shape and the same reason as workspaces.test.mjs: the failure mode of a
 * chip that names an active filter is not a clumsy sentence, it is a MISSING
 * KEY — i18next renders the key itself, so the chip reads "filters.clear_all",
 * nothing throws and the build stays green. A translator that refuses an
 * unknown key turns that into a red test.
 *
 * What is actually being pinned down here: a filter must never apply while the
 * control that set it is off screen. That is the whole reason the resolve
 * functions exist — a category id belongs to ONE workspace, and "Δικά μου"
 * only means something in a room with more than one person in it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  ALL,
  DEFAULT_FILTERS,
  resolveFilters,
  applyFilters,
  describeFilters,
  activeFilterCount,
  clearFilter,
  countByCategory,
  categoryOptions,
  switcherShape,
  needsFind,
} from '../src/utils/taskFilters.js';
import { UNFILED } from '../src/utils/workspaces.js';
import {
  ASSIGNMENT_ALL,
  ASSIGNMENT_MINE,
  ASSIGNMENT_UNASSIGNED,
} from '../src/utils/assignment.js';

const here = dirname(fileURLToPath(import.meta.url));
const locales = Object.fromEntries(
  ['en', 'el'].map((lang) => [
    lang,
    JSON.parse(readFileSync(join(here, '..', 'src', 'locales', `${lang}.json`), 'utf8')),
  ])
);

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
};

/** i18next's t(), minus the tolerance: an unknown key is a failure, not a string. */
function translator(dict) {
  return (key, opts) => {
    const value = key.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), dict);
    if (value === undefined) throw new Error(`missing translation key: ${key}`);
    return String(value).replace(/\{\{(\w+)\}\}/g, (_, name) => String(opts?.[name] ?? ''));
  };
}

const CATS = [
  { record_id: 'c-garden', workspace_id: 'ws-p', name: 'κήπος', position: 0 },
  { record_id: 'c-office', workspace_id: 'ws-b', name: 'γραφείο', position: 1 },
];
const task = (o) => ({ record_id: 't', priority: null, category_id: null, assigned_to: null, created_by: 'me', ...o });

// ------------------------------------------------------------ resolveFilters
// The stored shape keeps the category PER WORKSPACE, which is what makes the
// stale-id bug impossible rather than merely fixed.
const stored = {
  categoryByWorkspace: { 'ws-b': 'c-office' },
  priority: 'P1',
  assignment: ASSIGNMENT_MINE,
};

check('a category set in this workspace survives',
  resolveFilters(stored, { workspaceId: 'ws-b', categoryIds: ['c-office'], assignmentApplies: true }).category,
  'c-office');

check('SWITCHING WORKSPACE drops the category instead of emptying the list',
  resolveFilters(stored, { workspaceId: 'ws-p', categoryIds: ['c-garden'], assignmentApplies: true }).category,
  ALL);

check('coming back to the first workspace finds the filter where it was left',
  resolveFilters(stored, { workspaceId: 'ws-b', categoryIds: ['c-office'], assignmentApplies: true }).category,
  'c-office');

check('a category DELETED elsewhere resolves to All, not to a name nobody has',
  resolveFilters(stored, { workspaceId: 'ws-b', categoryIds: [], assignmentApplies: true }).category,
  ALL);

check('"no category" is always a legal answer — it needs no id to exist',
  resolveFilters(
    { ...stored, categoryByWorkspace: { 'ws-b': UNFILED } },
    { workspaceId: 'ws-b', categoryIds: [], assignmentApplies: true }
  ).category,
  UNFILED);

check('on "Όλα" there is no category control, so there is no category filter',
  resolveFilters(stored, { workspaceId: null, categoryIds: [], assignmentApplies: true }).category,
  ALL);

check('priority applies everywhere — it is the one axis every screen shares',
  resolveFilters(stored, { workspaceId: null, categoryIds: [], assignmentApplies: true }).priority,
  'P1');

check('"Δικά μου" does NOT apply where the control is hidden (solo room)',
  resolveFilters(stored, { workspaceId: 'ws-b', categoryIds: ['c-office'], assignmentApplies: false }).assignment,
  ASSIGNMENT_ALL);

check('nothing stored resolves to the plain defaults',
  resolveFilters(undefined, { workspaceId: 'ws-b', categoryIds: [], assignmentApplies: true }),
  DEFAULT_FILTERS);

// -------------------------------------------------------------- applyFilters
const LIST = [
  task({ record_id: 'a', category_id: 'c-office', priority: 'P1' }),
  task({ record_id: 'b', category_id: 'c-office', priority: null }),
  task({ record_id: 'c', category_id: null, priority: 'P1', assigned_to: 'someone-else' }),
];

check('no filters means the list comes back untouched',
  applyFilters(LIST, DEFAULT_FILTERS, 'me').map((x) => x.record_id),
  ['a', 'b', 'c']);

check('category and priority stack rather than replace each other',
  applyFilters(LIST, { ...DEFAULT_FILTERS, category: 'c-office', priority: 'P1' }, 'me').map((x) => x.record_id),
  ['a']);

check('a task with NO priority counts as P3, exactly as its row prints it',
  applyFilters(LIST, { ...DEFAULT_FILTERS, priority: 'P3' }, 'me').map((x) => x.record_id),
  ['b']);

check('"Δικά μου" excludes what somebody else has taken',
  applyFilters(LIST, { ...DEFAULT_FILTERS, assignment: ASSIGNMENT_MINE }, 'me').map((x) => x.record_id),
  ['a', 'b']);

check('"Αδιάθετα" is anybody\'s untaken work',
  applyFilters(LIST, { ...DEFAULT_FILTERS, assignment: ASSIGNMENT_UNASSIGNED }, 'me').map((x) => x.record_id),
  ['a', 'b']);

check('an unfiled category is findable through the filter too',
  applyFilters(LIST, { ...DEFAULT_FILTERS, category: UNFILED }, 'me').map((x) => x.record_id),
  ['c']);

check('a missing list does not throw', applyFilters(undefined, DEFAULT_FILTERS, 'me'), []);

// ------------------------------------------------------------------- counting
check('nothing active is nothing to show', activeFilterCount(DEFAULT_FILTERS), 0);
check('three filters count as three',
  activeFilterCount({ category: 'c-office', priority: 'P2', assignment: ASSIGNMENT_MINE }), 3);
check('a missing filter object counts as clean', activeFilterCount(undefined), 0);

check('clearing one leaves the others alone',
  clearFilter({ category: 'c-office', priority: 'P2', assignment: ASSIGNMENT_MINE }, 'priority'),
  { category: 'c-office', priority: ALL, assignment: ASSIGNMENT_MINE });

// ------------------------------------------------------------------ the chips
for (const [lang, dict] of Object.entries(locales)) {
  const t = translator(dict);

  check(`${lang}: a clean screen shows no chips at all`,
    describeFilters(DEFAULT_FILTERS, CATS, t), []);

  check(`${lang}: the category chip carries the user's own word, untranslated`,
    describeFilters({ ...DEFAULT_FILTERS, category: 'c-office' }, CATS, t).map((c) => c.label),
    ['γραφείο']);

  check(`${lang}: "no category" says so instead of showing a blank chip`,
    describeFilters({ ...DEFAULT_FILTERS, category: UNFILED }, CATS, t).map((c) => c.label),
    [t('workspace.unfiled')]);

  check(`${lang}: a category id nothing matches produces NO chip rather than "undefined"`,
    describeFilters({ ...DEFAULT_FILTERS, category: 'c-gone' }, CATS, t), []);

  check(`${lang}: priority is shown as the same P1 the rows use`,
    describeFilters({ ...DEFAULT_FILTERS, priority: 'P1' }, CATS, t).map((c) => c.label),
    ['P1']);

  check(`${lang}: the assignment chip is the same word as the control that set it`,
    describeFilters({ ...DEFAULT_FILTERS, assignment: ASSIGNMENT_MINE }, CATS, t).map((c) => c.label),
    [t('assignment.mine')]);

  check(`${lang}: each chip knows which filter it clears`,
    describeFilters({ category: 'c-office', priority: 'P1', assignment: ASSIGNMENT_UNASSIGNED }, CATS, t)
      .map((c) => c.key),
    ['category', 'priority', 'assignment']);

  // The keys the new UI needs. Asserted by USE, not by name: reading them
  // through the strict translator is what makes a missing one a red test.
  check(`${lang}: the clear-everything label exists`, typeof t('filters.clear_all'), 'string');
  check(`${lang}: the "filters are hiding work" line exists`,
    t('filters.hidden', { count: 3 }).includes('3'), true);
  check(`${lang}: the remove-one label exists`,
    t('filters.remove_one', { name: 'κήπος' }).includes('κήπος'), true);
  check(`${lang}: the active-filters group has an accessible name`,
    typeof t('filters.active_label'), 'string');
  check(`${lang}: the find box has a placeholder`, typeof t('filters.find'), 'string');
  check(`${lang}: a search with no matches says so`, typeof t('filters.no_matches'), 'string');
}

// ----------------------------------------------------------------- the counts
const LIVE = [
  task({ record_id: '1', category_id: 'c-office' }),
  task({ record_id: '2', category_id: 'c-office' }),
  task({ record_id: '3', category_id: null }),
];

check('every bucket is counted, including the one with nothing in it',
  countByCategory(LIVE, [
    { record_id: 'c-office', name: 'γραφείο' },
    { record_id: 'c-empty', name: 'άδεια' },
  ]),
  { All: 3, [UNFILED]: 1, 'c-office': 2, 'c-empty': 0 });

for (const [lang, dict] of Object.entries(locales)) {
  const t = translator(dict);
  const counts = countByCategory(LIVE, [
    { record_id: 'c-office', name: 'γραφείο' },
    { record_id: 'c-empty', name: 'άδεια' },
  ]);
  const options = categoryOptions([
    { record_id: 'c-office', name: 'γραφείο' },
    { record_id: 'c-empty', name: 'άδεια' },
  ], counts, t, { withCounts: true });

  check(`${lang}: the resting option names the AXIS, so a closed control still says what it is`,
    options[0].label, t('task.category_label'));

  check(`${lang}: a category carries how much is in it`,
    options.find((o) => o.value === 'c-office').label, 'γραφείο (2)');

  check(`${lang}: an empty category is dimmed rather than hidden — it is still where you file things`,
    options.find((o) => o.value === 'c-empty').muted, true);

  check(`${lang}: the user's own order is NOT rearranged by how full each one is`,
    options.map((o) => o.value), [ALL, 'c-office', 'c-empty', UNFILED]);

  check(`${lang}: on a screen about the past the counts are left off — they describe live work`,
    categoryOptions([{ record_id: 'c-office', name: 'γραφείο' }], counts, t, { withCounts: false })
      .find((o) => o.value === 'c-office').label,
    'γραφείο');
}

// ------------------------------------------------------ adapting to the count
check('one workspace is not a switcher, it is a label', switcherShape(1), 'none');
check('zero workspaces draws nothing', switcherShape(0), 'none');
check('two fit in a row of chips', switcherShape(2), 'chips');
check('five still fit', switcherShape(5), 'chips');
check('six do not — a row you must scroll hides the answer it exists to show',
  switcherShape(6), 'menu');
check('twenty is a menu', switcherShape(20), 'menu');

check('a short list needs no find box', needsFind(7), false);
check('a long one does', needsFind(8), true);

console.log(failures === 0 ? '\nAll filter checks passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
