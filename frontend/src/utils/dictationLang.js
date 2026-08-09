export const DICTATION_STORAGE_KEY = 'dictation_lang';

/**
 * The languages dictation can be asked for. `tag` is what the recogniser wants
 * (BCP-47); `code` is what the rest of the app calls the same language.
 */
export const DICTATION_LANGS = [
  { code: 'el', tag: 'el-GR', label: 'Ελληνικά' },
  { code: 'en', tag: 'en-US', label: 'English' },
];

const isSupported = (code) => DICTATION_LANGS.some((l) => l.code === code);

/**
 * Which language the user is about to SPEAK.
 *
 * The first version of this used the app's UI language and was wrong in the
 * most ordinary case there is: the app defaults to English until someone
 * deliberately picks Greek in Settings, so a Greek speaker reading an English
 * interface got an English recogniser and "να πάει αύριο αυτό" came back as
 * "napa gabriel stone". The language you READ is not the language you SPEAK.
 *
 * So the order is: an explicit choice, then the DEVICE's languages, then the
 * app's. The device is the better guess because a phone's locale follows its
 * keyboard and its owner, whereas the app's language is a default nobody
 * necessarily chose.
 */
export function resolveDictationLang(appLanguage) {
  const stored = localStorage.getItem(DICTATION_STORAGE_KEY);
  if (isSupported(stored)) return stored;

  const fromDevice = (navigator.languages || [navigator.language || ''])
    .map((tag) => tag.slice(0, 2).toLowerCase())
    .find(isSupported);
  if (fromDevice) return fromDevice;

  const fromApp = appLanguage?.slice(0, 2).toLowerCase();
  return isSupported(fromApp) ? fromApp : 'en';
}

export function setDictationLang(code) {
  localStorage.setItem(DICTATION_STORAGE_KEY, code);
}

export function dictationTagFor(code) {
  return DICTATION_LANGS.find((l) => l.code === code)?.tag || 'en-US';
}

export function dictationLabelFor(code) {
  return DICTATION_LANGS.find((l) => l.code === code)?.label || code;
}
