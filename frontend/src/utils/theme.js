// Theme preference — 'system' | 'light' | 'dark'.
//
// Stored in localStorage, not in the backend's app_settings. The closest
// precedent in this app is the language picker (i18n.js), which is the same
// kind of setting: a display preference that belongs to the DEVICE you are
// reading on, not to the account. A phone in bed and a laptop at a desk want
// different answers, and a server-side value would force them to agree.
export const THEME_STORAGE_KEY = 'app_theme';
export const THEMES = ['system', 'light', 'dark'];

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function getStoredTheme() {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return THEMES.includes(stored) ? stored : 'system';
}

function resolveTheme(preference) {
  if (preference === 'light' || preference === 'dark') return preference;
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

// The whole mechanism: index.css keys its dark palette off <html data-theme>,
// and this is the only thing that ever writes it. Note it holds the RESOLVED
// theme (light/dark), never 'system' — CSS has no way to express "the OS
// setting, unless the user overrode it", so the resolving happens here and CSS
// is left with one plain attribute to match. That is also why the OS listener
// in initTheme() below is not optional.
export function applyTheme(preference) {
  const resolved = resolveTheme(preference);
  document.documentElement.dataset.theme = resolved;

  // theme-color can no longer be left to the media queries it ships with in
  // index.html: those follow the OS, and the point of this feature is that the
  // app is allowed to disagree with the OS. Without this the phone's chrome
  // stays dark around a deliberately light app.
  for (const meta of document.querySelectorAll('meta[name="theme-color"][data-scheme]')) {
    meta.media = meta.dataset.scheme === resolved ? 'all' : 'not all';
  }
  return resolved;
}

export function setTheme(preference) {
  localStorage.setItem(THEME_STORAGE_KEY, preference);
  applyTheme(preference);
}

export function initTheme() {
  applyTheme(getStoredTheme());

  // While the preference is 'system', data-theme is a snapshot of the OS taken
  // at load. Phones flip themselves at sunset with the app still open, so the
  // snapshot has to be refreshed — otherwise "System" means "the system, as of
  // whenever you last opened this".
  window.matchMedia(DARK_QUERY).addEventListener('change', () => {
    if (getStoredTheme() === 'system') applyTheme('system');
  });
}
