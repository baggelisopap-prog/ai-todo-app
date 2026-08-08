#!/usr/bin/env node
/**
 * UI invariants for this app. Run with `npm run check`.
 *
 * This project has no test framework, and asserting CSS classes through one
 * would cost more than it returns. What IS worth automating is the small set
 * of rules the first polish pass established (docs/FRONTEND_1ST_POLISH.md) —
 * each of them a mistake that had already been made at least once here:
 *
 *   1. A component uses var(--something) that index.css never defines.
 *      Fails silently in the browser: the property is dropped and the element
 *      renders transparent or unstyled, with nothing in the console.
 *   2. en.json and el.json drift apart. A missing key renders as the raw key
 *      string ("task.agent_title") to whichever half of the users is on that
 *      language.
 *   3. A hardcoded Tailwind colour (bg-red-50, text-green-600) creeps back in.
 *      These are exactly what dark mode cannot follow, so every one of them is
 *      a light-mode-only patch of screen.
 *   4. One of this app's own safe-area helper classes is used but not defined.
 *      Same silent failure as (1), and it is what keeps content off the
 *      iPhone home indicator.
 *
 * Exits non-zero on any violation so it can gate a build.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const srcDir = join(root, 'src');
const cssPath = join(srcDir, 'index.css');

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = walk(srcDir).filter((f) => ['.js', '.jsx', '.css'].includes(extname(f)));
const css = readFileSync(cssPath, 'utf8');
const failures = [];

function fail(rule, detail) {
  failures.push({ rule, detail });
}

// --- 1. Every var(--x) used is defined -------------------------------------
const definedVars = new Set([...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)].map((m) => m[1]));
for (const file of files) {
  const body = readFileSync(file, 'utf8');
  for (const match of body.matchAll(/var\((--[a-z0-9-]+)/gi)) {
    if (!definedVars.has(match[1])) {
      fail('undefined-css-var', `${relative(root, file)} uses ${match[1]}, not defined in index.css`);
    }
  }
}

// --- 2. Locale key parity ---------------------------------------------------
const flatten = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? flatten(v, `${prefix}${k}.`)
      : [`${prefix}${k}`]
  );

const en = new Set(flatten(JSON.parse(readFileSync(join(srcDir, 'locales/en.json'), 'utf8'))));
const el = new Set(flatten(JSON.parse(readFileSync(join(srcDir, 'locales/el.json'), 'utf8'))));
for (const key of en) if (!el.has(key)) fail('locale-drift', `"${key}" is in en.json but not el.json`);
for (const key of el) if (!en.has(key)) fail('locale-drift', `"${key}" is in el.json but not en.json`);

// --- 3. No hardcoded Tailwind colours --------------------------------------
// Colour must come from the token layer so a theme can change it in one place.
// index.css itself is exempt: that IS the token layer.
//
// This began as a ratchet — 36 existed when the script was written, and a check
// that fails from the day it is added guards nothing, it just gets ignored. So
// the count was capped at a baseline that only ever came down. Phase 5 of the
// polish pass tokenised all 36, so the baseline is now 0 and this is the plain
// rule it was always meant to be: a hardcoded colour is a patch of screen that
// dark mode cannot follow.
const HARDCODED_COLOUR_BASELINE = 0;
const PALETTE = 'red|green|blue|amber|yellow|gray|slate|zinc|neutral|stone|emerald|cyan|purple|teal|orange|rose|indigo|sky|violet|fuchsia|pink|lime';
const hardcoded = new RegExp(`\\b(?:bg|text|border|ring|from|to|via)-(?:${PALETTE})-\\d{2,3}\\b`, 'g');
const colourHits = [];
for (const file of files) {
  if (file === cssPath) continue;
  const body = readFileSync(file, 'utf8');
  body.split('\n').forEach((line, i) => {
    for (const match of line.matchAll(hardcoded)) {
      colourHits.push(`${relative(root, file)}:${i + 1} ${match[0]}`);
    }
  });
}
if (colourHits.length > HARDCODED_COLOUR_BASELINE) {
  fail(
    'hardcoded-colour',
    `${colourHits.length} found, baseline is ${HARDCODED_COLOUR_BASELINE}. ` +
      `New ones must use a --token:\n    ${colourHits.join('\n    ')}`
  );
} else if (colourHits.length < HARDCODED_COLOUR_BASELINE) {
  console.log(
    `ui-check: hardcoded colours down to ${colourHits.length} (baseline ${HARDCODED_COLOUR_BASELINE}) — ` +
      `lower HARDCODED_COLOUR_BASELINE in this file to lock the win in.`
  );
}

// --- 4. This app's own utility classes are defined --------------------------
// Only checks classes we invented — safe-area helpers, tap targets and the two
// entrance animations. Tailwind's own classes are generated at build time and
// are none of this script's business.
//
// The animate-* pair is here for the same reason as the rest: they are plain
// class names, so renaming a keyframe in index.css leaves the component looking
// correct in source while it silently stops animating. Note that Tailwind also
// ships an `animate-` prefix, which is exactly why these are named for what
// they do rather than something that could collide with a generated utility.
const OWN_CLASSES = /\b(pb-safe|bottom-safe-\d+|tap-\d+|animate-toast-in|animate-fade-in)\b/g;

// A plain css.includes('.' + name) is not good enough, and this was caught by
// injecting a fault and watching the check pass: renaming .animate-fade-in to
// .animate-fade-inX in index.css left includes('.animate-fade-in') true, since
// the old name is a prefix of the new one. Same trap for .tap-4 vs .tap-44.
// So the selector has to end at a real CSS class boundary.
function cssDefinesClass(name) {
  return new RegExp(`\\.${name}(?![\\w-])`).test(css);
}

for (const file of files) {
  if (file === cssPath) continue;
  const body = readFileSync(file, 'utf8');
  for (const match of body.matchAll(OWN_CLASSES)) {
    if (!cssDefinesClass(match[1])) {
      fail('undefined-utility', `${relative(root, file)} uses .${match[1]}, not defined in index.css`);
    }
  }
}

// --- Report -----------------------------------------------------------------
if (failures.length === 0) {
  console.log(`ui-check: OK — ${files.length} files, ${definedVars.size} tokens, ${en.size} translation keys`);
  process.exit(0);
}

const byRule = failures.reduce((acc, f) => {
  (acc[f.rule] ??= []).push(f.detail);
  return acc;
}, {});
for (const [rule, details] of Object.entries(byRule)) {
  console.error(`\n${rule} (${details.length}):`);
  for (const d of details) console.error(`  ${d}`);
}
console.error(`\nui-check: ${failures.length} problem(s)`);
process.exit(1);
