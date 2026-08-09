#!/usr/bin/env node
/**
 * src/utils/dictationLang.js — the real module against stubbed localStorage
 * and navigator.
 *
 * Worth its own file because of HOW this fails. A recogniser given the wrong
 * language does not error, refuse, or return nothing: it returns fluent
 * nonsense. "να πάει αύριο αυτό" came back as "napa gabriel stone" — confident,
 * well-formed, and completely wrong. Neither the build nor a glance at the UI
 * catches that; only speaking Greek at it does.
 *
 * The first case below is the exact bug: an app defaulting to English on a
 * Greek phone.
 */
import { resolveDictationLang } from '../src/utils/dictationLang.js';

let failures = 0;
const check = (name, got, want) => {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
};

function env({ stored = null, deviceLangs = [] } = {}) {
  globalThis.localStorage = {
    getItem: (k) => (k === 'dictation_lang' ? stored : null),
    setItem: () => {},
  };
  globalThis.navigator = { languages: deviceLangs, language: deviceLangs[0] };
}

// --- The reported bug -------------------------------------------------------
// The app starts in English until someone picks Greek in Settings. A Greek
// speaker on a Greek phone was getting an English recogniser.
env({ deviceLangs: ['el-GR', 'en-US'] });
check('Greek phone, English app -> Greek', resolveDictationLang('en'), 'el');

// --- An explicit choice always wins ----------------------------------------
env({ stored: 'en', deviceLangs: ['el-GR'] });
check('stored English beats a Greek device', resolveDictationLang('el'), 'en');
env({ stored: 'el', deviceLangs: ['en-US'] });
check('stored Greek beats an English device', resolveDictationLang('en'), 'el');

// --- Device, then app -------------------------------------------------------
env({ deviceLangs: ['en-GB'] });
check('English device -> English', resolveDictationLang('el'), 'en');
env({ deviceLangs: ['de-DE', 'fr-FR'] });
check('unsupported device falls through to the app language', resolveDictationLang('el'), 'el');
env({ deviceLangs: [] });
check('no device languages at all falls through to the app', resolveDictationLang('el'), 'el');

// --- Nothing usable anywhere ------------------------------------------------
env({ deviceLangs: ['de-DE'] });
check('no supported language anywhere -> English', resolveDictationLang('de'), 'en');
env({ deviceLangs: [] });
check('undefined app language -> English', resolveDictationLang(undefined), 'en');

// --- Junk in storage is ignored, not trusted --------------------------------
env({ stored: 'klingon', deviceLangs: ['el-GR'] });
check('unsupported stored value is ignored', resolveDictationLang('en'), 'el');

// --- Tags are matched on the language, not the region -----------------------
env({ deviceLangs: ['el-CY'] });
check('Greek as spoken in Cyprus is still Greek', resolveDictationLang('en'), 'el');
env({ deviceLangs: ['EL-GR'] });
check('case in the device tag does not matter', resolveDictationLang('en'), 'el');

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
