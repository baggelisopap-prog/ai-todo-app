#!/usr/bin/env node
/**
 * A failure must not be painted as a success.
 *
 * handleShowToast(message, variant = 'success') defaults to green, and
 * Toast.jsx puts a ✓ in front of anything green. So a toast raised from a
 * catch block WITHOUT an explicit 'error' arrives looking like confirmation,
 * whatever its words say.
 *
 * This is not hypothetical. The Hostaway connect screen did exactly that:
 * «Η Hostaway δεν δέχτηκε τα στοιχεία» was shown on a green background with a
 * tick, and the owner reported it three times across two sessions as "it says
 * it did not accept it but it is green with a tick" — while the integration
 * was in fact disconnected and receiving nothing. The same slip was then made
 * a second time, in the fix for a neighbouring bug, an hour later. Two people
 * making one mistake twice is what a check is for.
 *
 * The rule: inside a catch block, a toast call must pass a variant. Which one
 * is the caller's judgement — a refused clipboard write is legitimately not an
 * error — but the choice has to be made rather than inherited from a default
 * that happens to be green.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const srcDir = join(root, 'src');

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = walk(srcDir).filter((f) => /\.(jsx?|mjs)$/.test(f));

// How far after a `catch (…) {` a toast call still counts as "inside" it.
// Generous on purpose: the handlers in this app log first and toast second,
// and a false positive here costs one explicit variant, while a miss costs a
// green failure message on somebody's phone.
const CATCH_WINDOW = 12;

const TOAST_CALL = /(?:onShowToast\?\.|showToast|onShowToast)\s*\(/;
const HAS_VARIANT = /['"](?:error|success|neutral)['"]|variant\s*:/;

const violations = [];

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  let catchAt = null;

  lines.forEach((line, index) => {
    if (/\bcatch\s*(\([^)]*\))?\s*\{/.test(line)) catchAt = index;

    // A closing brace at the start of its own indentation level ends the
    // window early — cheap, and keeps a later unrelated toast out of it.
    if (catchAt !== null && index > catchAt && /^\s{0,4}\}/.test(line)) catchAt = null;

    if (catchAt === null || index - catchAt > CATCH_WINDOW) return;
    if (!TOAST_CALL.test(line)) return;

    // The call may wrap over a couple of lines; look at the whole statement.
    const statement = lines.slice(index, index + 3).join(' ');
    if (!HAS_VARIANT.test(statement)) {
      violations.push({
        file: relative(root, file),
        line: index + 1,
        text: line.trim(),
      });
    }
  });
}

if (violations.length > 0) {
  console.error('\nFAIL  toast raised from a catch block with no explicit variant');
  console.error('      (defaults to "success" — green, with a ✓ — whatever the message says)\n');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    ${v.text}\n`);
  }
  console.error(`  ${violations.length} violation(s). Pass 'error' — or 'neutral' if it truly is not a failure.\n`);
  process.exit(1);
}

console.log(`PASS  every toast raised from a catch block states its variant  (${files.length} files scanned)`);
console.log('\nall passed');
