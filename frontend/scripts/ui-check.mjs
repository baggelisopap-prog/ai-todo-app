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
 *   5. A token is defined in one palette but not the other. The light value
 *      then bleeds through in dark mode — one unreadable element on an
 *      otherwise correct screen, which is exactly the kind of thing that only
 *      shows up on someone else's phone.
 *   6. A bottom-nav label grows past what its share of a narrow screen can
 *      show. `truncate` means it clips instead of overflowing, so it looks
 *      fine in English and wrong in Greek, with nothing to notice.
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

// --- 5. Light and dark palettes define the same tokens ----------------------
// Asserted rather than assumed since the polish pass, but it matters more now
// that the dark palette is the ONLY definition of its side: it hangs off
// [data-theme='dark'] with no prefers-color-scheme copy, so a token missing
// there does not fall back to some other dark value, it falls back to the light
// one. Checked in both directions — a dark-only token is just as broken, it
// leaves light mode with nothing.
function tokensIn(selector) {
  const at = css.indexOf(selector);
  if (at === -1) return null;
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open); // neither block nests
  return new Set([...css.slice(open, close).matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
}

const DARK_SELECTOR = ":root[data-theme='dark']";
const lightTokens = tokensIn(':root {');
const darkTokens = tokensIn(DARK_SELECTOR);
if (!lightTokens || !darkTokens) {
  fail('palette-missing', `could not find ${!lightTokens ? ':root' : DARK_SELECTOR} in index.css`);
} else {
  for (const token of lightTokens) {
    if (!darkTokens.has(token)) fail('palette-drift', `${token} is defined in :root but not in ${DARK_SELECTOR}`);
  }
  for (const token of darkTokens) {
    if (!lightTokens.has(token)) fail('palette-drift', `${token} is defined in ${DARK_SELECTOR} but not in :root`);
  }
}

// --- 6. The bottom nav's labels still fit --------------------------------
// The tabs split the viewport evenly and each label carries `truncate`, so an
// overflowing label does not break the layout — it silently clips, and only in
// the language whose words are longer. That is how "Εισερχόμενα" came to render
// as a stub at five tabs while English looked perfect.
//
// The arithmetic, at the narrowest width worth supporting (320px):
//   320 / TAB_LIMIT tabs = 80px per tab, minus px-0.5 padding either way ≈ 76px.
//   text-xs is 12px; Greek averages ~6.4px per character at that size.
//   76 / 6.4 ≈ 11.8 characters.
// Hence twelve. Adding a fifth tab drops the budget to ~9 characters, which no
// Greek label here meets — so the tab count is checked too, and deliberately
// fails rather than quietly re-introducing the clipping.
const TAB_LIMIT = 4;
const LABEL_CHAR_LIMIT = 12;

// navTabs.js, not BottomNav.jsx: the list moved there when SideNav needed the
// same four tabs. The budget below is still the BOTTOM nav's — the sidebar is
// 256px wide and has room to spare — but both navigations read this one list,
// so checking it here covers the narrow case that can actually clip.
const navSource = readFileSync(join(srcDir, 'components/navTabs.js'), 'utf8');
const tabsBlock = navSource.match(/const TABS = \[([\s\S]*?)\];/)?.[1];
if (!tabsBlock) {
  fail('nav-unreadable', 'could not find the TABS array in navTabs.js');
} else {
  const labelKeys = [...tabsBlock.matchAll(/labelKey: '([^']+)'/g)].map((m) => m[1]);
  if (labelKeys.length > TAB_LIMIT) {
    fail('nav-too-many-tabs', `${labelKeys.length} tabs, limit is ${TAB_LIMIT} — labels will clip`);
  }
  const localesByName = { 'en.json': en, 'el.json': el };
  for (const key of labelKeys) {
    for (const [name, keys] of Object.entries(localesByName)) {
      if (!keys.has(key)) {
        fail('nav-missing-label', `${key} is a tab label but is not in ${name}`);
      }
    }
  }
  // Length has to come from the parsed JSON, not the key set above.
  const enJson = JSON.parse(readFileSync(join(srcDir, 'locales/en.json'), 'utf8'));
  const elJson = JSON.parse(readFileSync(join(srcDir, 'locales/el.json'), 'utf8'));
  for (const key of labelKeys) {
    for (const [name, json] of [['en.json', enJson], ['el.json', elJson]]) {
      const label = key.split('.').reduce((acc, part) => acc?.[part], json);
      if (typeof label === 'string' && label.length > LABEL_CHAR_LIMIT) {
        fail(
          'nav-label-too-long',
          `${name} ${key} = "${label}" is ${label.length} chars, limit is ${LABEL_CHAR_LIMIT}`
        );
      }
    }
  }
}

// index.html's inline pre-paint script duplicates theme.js's storage key and
// resolution rule, which is the other thing this pass could get silently wrong.
// It is NOT checked here: theme.test.mjs runs both implementations over every
// (stored preference × OS) pair and compares them, which catches a drifted key
// and everything else a text match would miss.

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
