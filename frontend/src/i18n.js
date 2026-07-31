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

export default i18n;
