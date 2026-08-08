#!/usr/bin/env node
/**
 * src/utils/theme.js, and the copy of its rules that index.html carries.
 *
 * Unlike modal-lock.test.mjs, which simulates the hook, this imports the REAL
 * module: theme.js touches exactly four globals (localStorage, matchMedia,
 * document.documentElement.dataset, document.querySelectorAll), so stubbing
 * them is cheaper than keeping a second copy of the logic honest.
 *
 * The case worth the file is the one the whole feature exists for: a stored
 * preference must WIN over the OS. Anything that quietly falls back to
 * prefers-color-scheme still looks correct to a developer whose laptop happens
 * to agree with their choice, and is wrong for everyone else.
 *
 * The last block is the real reason this is not just a ui-check rule.
 * index.html duplicates the resolution rule inline (it has to — the bundle
 * loads too late to prevent a white flash), so the two implementations are
 * checked against each other across every input rather than merely sharing a
 * spelling of the storage key.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStoredTheme, setTheme, applyTheme, initTheme } from '../src/utils/theme.js';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

let failures = 0;
const check = (name, got, want) => {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
};

// Minimal stand-ins for the only four browser globals theme.js reaches for.
function env({ stored, osDark = false } = {}) {
  const store = new Map();
  if (stored !== undefined) store.set('app_theme', stored);

  const metas = [
    { dataset: { scheme: 'light' }, media: '(prefers-color-scheme: light)' },
    { dataset: { scheme: 'dark' }, media: '(prefers-color-scheme: dark)' },
  ];
  const osListeners = [];

  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  globalThis.document = {
    documentElement: { dataset: {} },
    querySelectorAll: (sel) => (sel.includes('theme-color') ? metas : []),
  };
  globalThis.matchMedia = (query) => ({
    matches: query.includes('dark') && osDark,
    addEventListener: (_event, fn) => osListeners.push(fn),
  });
  globalThis.window = globalThis;

  return {
    metas,
    theme: () => globalThis.document.documentElement.dataset.theme,
    saved: () => store.get('app_theme'),
    flipOs(nowDark) {
      osDark = nowDark;
      for (const fn of osListeners) fn();
    },
  };
}

// --- 1. "System" means the OS, in both directions ---------------------------
let e = env({ osDark: true });
applyTheme(getStoredTheme());
check('nothing stored, dark OS -> dark', e.theme(), 'dark');

e = env({ osDark: false });
applyTheme(getStoredTheme());
check('nothing stored, light OS -> light', e.theme(), 'light');

// --- 2. An explicit choice overrides the OS ---------------------------------
// The point of the feature. Both directions, because only testing the popular
// one (dark app on a light OS) would miss a fallback to prefers-color-scheme.
e = env({ stored: 'light', osDark: true });
applyTheme(getStoredTheme());
check('stored light on a DARK OS -> light', e.theme(), 'light');

e = env({ stored: 'dark', osDark: false });
applyTheme(getStoredTheme());
check('stored dark on a LIGHT OS -> dark', e.theme(), 'dark');

// --- 3. Choosing persists, and applies immediately --------------------------
e = env({ osDark: true });
setTheme('light');
check('setTheme applies at once', e.theme(), 'light');
check('setTheme persists', e.saved(), 'light');
check('and is what a reload reads back', getStoredTheme(), 'light');

// --- 4. A junk stored value degrades to System, not to a blank attribute -----
e = env({ stored: 'midnight', osDark: true });
check('unknown stored value -> system', getStoredTheme(), 'system');
applyTheme(getStoredTheme());
check('...and still resolves to a real theme', e.theme(), 'dark');

// --- 5. theme-color follows the app, not the OS -----------------------------
// Left on its media queries, the phone's chrome would stay dark around a
// deliberately light app.
e = env({ stored: 'light', osDark: true });
applyTheme(getStoredTheme());
check('light chrome active', e.metas[0].media, 'all');
check('dark chrome disabled', e.metas[1].media, 'not all');

// --- 6. "System" keeps following the system while the app is open -----------
// Phones flip themselves at sunset with the app still on screen.
e = env({ osDark: false });
initTheme();
check('starts light', e.theme(), 'light');
e.flipOs(true);
check('OS flips to dark -> app follows', e.theme(), 'dark');
check('and the chrome follows too', e.metas[1].media, 'all');

// An explicit choice must NOT be overwritten by the same event.
e = env({ stored: 'light', osDark: false });
initTheme();
e.flipOs(true);
check('OS flips, but user chose light -> stays light', e.theme(), 'light');

// --- 7. index.html's inline copy agrees with the module ---------------------
const html = readFileSync(join(root, 'index.html'), 'utf8');
const inline = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (!inline) {
  console.log('FAIL  index.html has no inline theme script');
  failures++;
} else {
  const runInline = new Function(inline);
  for (const stored of [undefined, 'light', 'dark', 'midnight']) {
    for (const osDark of [false, true]) {
      const inlineEnv = env({ stored, osDark });
      runInline();
      const fromInline = inlineEnv.theme();

      const moduleEnv = env({ stored, osDark });
      applyTheme(getStoredTheme());
      const fromModule = moduleEnv.theme();

      check(`inline script matches module (stored=${stored}, osDark=${osDark})`, fromInline, fromModule);
    }
  }
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
