#!/usr/bin/env node
/**
 * src/utils/searchTasks.js — the real module, no simulation needed: it touches
 * no browser API and no React.
 *
 * Worth its own file because the whole thing lives or dies on Greek folding,
 * and that fails in a way nobody notices from an English keyboard. Every case
 * below is one a Greek user produces by typing normally.
 */
import { searchTasks, matchesQuery } from '../src/utils/searchTasks.js';

let failures = 0;
const check = (name, got, want) => {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
};

const task = (task_name, description = '') => ({ task_name, description });

const dentist = task('Ραντεβού οδοντίατρος', 'Να πάρω τηλέφωνο πρώτα');
const invoice = task('Send invoice', 'For the Athens flat');
const mixed = task('Πληρωμή ΔΕΗ', '');

// --- Accents ---------------------------------------------------------------
// Typing without accents is the norm on a phone; without folding this finds
// nothing and the feature looks broken.
check('accented query finds accented task', matchesQuery(dentist, 'Ραντεβού'), true);
check('UNACCENTED query finds accented task', matchesQuery(dentist, 'ραντεβου'), true);
check('accented query finds it regardless of case', matchesQuery(dentist, 'ΡΑΝΤΕΒΟΥ'), true);

// --- Final sigma -----------------------------------------------------------
// "ΟΔΟΝΤΙΑΤΡΟΣ".toLowerCase() ends in ς, and a word typed mid-sentence ends in
// σ. Unicode case folding does not reconcile the two; this does.
check('uppercase query with final sigma', matchesQuery(dentist, 'ΟΔΟΝΤΙΑΤΡΟΣ'), true);
check('lowercase final sigma', matchesQuery(dentist, 'οδοντίατρος'), true);

// --- Description is searched too -------------------------------------------
check('matches on description', matchesQuery(dentist, 'τηλέφωνο'), true);
check('matches on description, unaccented', matchesQuery(dentist, 'τηλεφωνο'), true);

// --- Multiple terms, any order ---------------------------------------------
check('both terms present, reversed order', matchesQuery(dentist, 'οδοντιατρος ραντεβου'), true);
check('one term missing fails the whole query', matchesQuery(dentist, 'ραντεβου κομμωτηριο'), false);

// --- Latin still behaves ----------------------------------------------------
check('latin case-insensitive', matchesQuery(invoice, 'INVOICE'), true);
check('latin across name and description', matchesQuery(invoice, 'invoice athens'), true);
check('non-matching latin', matchesQuery(invoice, 'zurich'), false);

// --- Empty query is not a filter -------------------------------------------
const all = [dentist, invoice, mixed];
check('empty query returns everything', searchTasks(all, '').length, 3);
check('whitespace query returns everything', searchTasks(all, '   ').length, 3);
check('undefined query returns everything', searchTasks(all, undefined).length, 3);

// --- Missing fields must not throw -----------------------------------------
// Tasks arrive from the API with description null, and from optimistic local
// creation with barely anything set.
check('null description is survivable', matchesQuery({ task_name: 'x', description: null }, 'x'), true);
check('missing task_name is survivable', matchesQuery({ description: 'hello' }, 'hello'), true);

check('filters the list', searchTasks(all, 'δεη').length, 1);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
