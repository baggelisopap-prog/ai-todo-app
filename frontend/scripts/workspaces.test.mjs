#!/usr/bin/env node
/**
 * Every decision the workspace UI makes, as pure functions, against the REAL
 * locale files rather than a stub dictionary.
 *
 * Using the real files is the point, and it is the same reason
 * recurrence-badge.test.mjs does it: the failure mode here is not a wrong
 * sentence, it is a MISSING KEY. i18next renders the key itself, so a chip
 * reads "workspace.unfiled", nothing throws, nothing logs, and the build is
 * green. A translator that refuses an unknown key turns that into a red test.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  filterTasksByWorkspace,
  filterTasksByCategory,
  categoriesForWorkspace,
  describePlacement,
  nextPosition,
  UNFILED,
} from '../src/utils/workspaces.js';

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

const WS = [
  { record_id: 'ws-b', name: 'Business', color: '#2563eb', position: 0 },
  { record_id: 'ws-p', name: 'Personal', color: '#16a34a', position: 1 },
];
const CATS = [
  { record_id: 'c-office', workspace_id: 'ws-b', name: 'γραφείο', position: 1, system_key: null },
  { record_id: 'c-host', workspace_id: 'ws-b', name: 'Hostaway', position: 0, system_key: 'hostaway' },
  { record_id: 'c-garden', workspace_id: 'ws-p', name: 'κήπος', position: 0, system_key: null },
];
const task = (o) => ({ record_id: 't', workspace_id: null, category_id: null, ...o });

// ---------------------------------------------------------------- filtering
check('no active workspace returns every task',
  filterTasksByWorkspace([task({ record_id: 'a', workspace_id: 'ws-b' }), task({ record_id: 'b' })], null)
    .map((t) => t.record_id),
  ['a', 'b']);

check("an unfiled task survives 'All' — it is still the user's work",
  filterTasksByWorkspace([task({ record_id: 'unfiled' })], null).map((t) => t.record_id),
  ['unfiled']);

check('an active workspace keeps only its own',
  filterTasksByWorkspace(
    [task({ record_id: 'in', workspace_id: 'ws-b' }),
     task({ record_id: 'out', workspace_id: 'ws-p' }),
     task({ record_id: 'unfiled' })], 'ws-b').map((t) => t.record_id),
  ['in']);

check('an empty list stays an empty list', filterTasksByWorkspace([], 'ws-b'), []);
check('a missing list does not throw', filterTasksByWorkspace(undefined, 'ws-b'), []);

// --------------------------------------------------------------- grouping
check('categories are scoped to one workspace, in position order',
  categoriesForWorkspace(CATS, 'ws-b').map((c) => c.record_id),
  ['c-host', 'c-office']);

check('a workspace with none returns empty, not undefined',
  categoriesForWorkspace(CATS, 'ws-nothing'), []);

check('no workspace means no categories to offer',
  categoriesForWorkspace(CATS, null), []);

// -------------------------------------------------------------- the chip
for (const [lang, dict] of Object.entries(locales)) {
  const t = translator(dict);

  check(`${lang}: an unfiled task says so rather than showing nothing`,
    describePlacement(task({}), WS, CATS, t),
    t('workspace.unfiled'));

  check(`${lang}: a workspace with no category shows just the workspace`,
    describePlacement(task({ workspace_id: 'ws-b' }), WS, CATS, t),
    'Business');

  check(`${lang}: both shows workspace and category`,
    describePlacement(task({ workspace_id: 'ws-b', category_id: 'c-office' }), WS, CATS, t),
    'Business · γραφείο');

  check(`${lang}: a DELETED workspace does not print "undefined"`,
    describePlacement(task({ workspace_id: 'ws-gone' }), WS, CATS, t),
    t('workspace.unfiled'));

  check(`${lang}: a deleted category falls back to the workspace alone`,
    describePlacement(task({ workspace_id: 'ws-b', category_id: 'c-gone' }), WS, CATS, t),
    'Business');
}

// ------------------------------------------------------------- ordering
check('the first item takes position 0', nextPosition([]), 0);
check('a new item goes after the highest, not after the count',
  nextPosition([{ position: 0 }, { position: 7 }]), 8);
check('a missing position counts as 0 rather than NaN',
  nextPosition([{}, { position: 2 }]), 3);

// ------------------------------------------------------ the unfiled bucket
check('the unfiled chip shows exactly the tasks with no workspace',
  filterTasksByWorkspace(
    [task({ record_id: 'filed', workspace_id: 'ws-b' }),
     task({ record_id: 'bare' })], UNFILED).map((t) => t.record_id),
  ['bare']);

check('UNFILED cannot collide with a real id', UNFILED.startsWith('__'), true);

// ------------------------------------------------------ category filtering
check('no category filter returns everything',
  filterTasksByCategory(
    [task({ record_id: 'a', category_id: 'c1' }), task({ record_id: 'b' })], null)
    .map((t) => t.record_id),
  ['a', 'b']);

check('a category keeps only its own',
  filterTasksByCategory(
    [task({ record_id: 'in', category_id: 'c1' }),
     task({ record_id: 'out', category_id: 'c2' })], 'c1').map((t) => t.record_id),
  ['in']);

check('an uncategorised task is findable, not lost',
  filterTasksByCategory(
    [task({ record_id: 'filed', category_id: 'c1' }),
     task({ record_id: 'bare' })], UNFILED).map((t) => t.record_id),
  ['bare']);

console.log(failures === 0 ? '\nAll workspace checks passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
