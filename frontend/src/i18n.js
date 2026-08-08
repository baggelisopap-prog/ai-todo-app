import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import el from './locales/el.json';

// Persists across sessions once the user picks a language in Settings (see
// SettingsModal.jsx's Language section) — falls back to English on first
// ever visit, matching this app's original default.
const storedLanguage = typeof window !== 'undefined' ? localStorage.getItem('app_language') : null;

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      el: { translation: el },
    },
    lng: storedLanguage || 'en',
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  });

// Keep <html lang> honest. index.html ships lang="en" as a placeholder, but the
// app is fully translated and the user switches in Settings — a stale lang tells
// screen readers and hyphenation the wrong thing about every word on the page.
function syncDocumentLanguage(lng) {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lng;
  }
}

syncDocumentLanguage(i18n.language);
i18n.on('languageChanged', syncDocumentLanguage);

export default i18n;
