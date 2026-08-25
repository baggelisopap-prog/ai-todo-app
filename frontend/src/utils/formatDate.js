/**
 * Returns a YYYY-MM-DD string based on the date's LOCAL time components,
 * not UTC. Use this whenever comparing against the API's date strings
 * (which are stored as YYYY-MM-DD and interpreted as local calendar dates).
 */
export function toLocalISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * The ISO weekday (1 = Monday .. 7 = Sunday) of a YYYY-MM-DD string, or null
 * if there isn't one. ISO because that is what the recurrence rules use, on
 * both sides of the wire.
 *
 * The components are parsed by hand rather than handed to `new Date(str)`,
 * which reads a bare YYYY-MM-DD as UTC midnight. That is the right date in
 * Athens (UTC+2/+3 puts it at 02:00 or 03:00 the same day) and the WRONG one
 * anywhere west of Greenwich, where it lands on the previous evening and this
 * function would name the day before.
 */
export function isoWeekday(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return null;
  const day = new Date(y, m - 1, d).getDay(); // 0 = Sunday
  return day === 0 ? 7 : day;
}

/**
 * The language the UI is currently showing, as a locale tag for Intl.
 *
 * Read off <html lang> rather than imported from i18n.js on purpose. This
 * module is also loaded by the plain-node check scripts (scripts/*.test.mjs),
 * and importing i18n.js would drag react-i18next and React in behind it for
 * the sake of one string. i18n.js already writes the chosen language onto
 * <html lang> on startup and on every switch, so this is the same value with
 * none of the dependency. Outside a browser there is no document; 'en' then,
 * matching i18n.js's own fallback.
 */
export function uiLocale() {
  if (typeof document === 'undefined') return 'en';
  return document.documentElement.lang || 'en';
}

/**
 * A weekday abbreviation in the UI's language, uppercased for a column header
 * or a day divider: MON / ΔΕΥ.
 *
 * The accent strip is not cosmetic. Greek does not accent capitals, but
 * toUpperCase() keeps the tonos, so the browser's own τρί / πέμ / σάβ come back as
 * ΤΡΊ / ΠΈΜ / ΣΆΒ -- wrong in a way a Greek reader sees immediately. Only the
 * combining acute is removed, so dialytika survive (ΑΫΛΟΣ stays ΑΫΛΟΣ).
 *
 * Apply this to uppercase output only: run over lowercase text it would strip
 * accents that belong there (Αύγουστος -> Αυγουστος).
 */
export function weekdayShortUpper(date) {
  return date
    .toLocaleDateString(uiLocale(), { weekday: 'short' })
    .toUpperCase()
    .normalize('NFD')
    .replace(/́/g, '')
    .normalize('NFC');
}

export function formatDate(dateStr, timeStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const options = { month: 'short', day: 'numeric' };
  if (date.getFullYear() !== now.getFullYear()) {
    options.year = 'numeric';
  }
  const dateFormatted = date.toLocaleDateString(uiLocale(), options);
  return timeStr ? `${dateFormatted}, ${timeStr}` : dateFormatted;
}

/**
 * Rounds an ISO timestamp to the nearest half-hour for display purposes
 * (e.g. 14:12 -> 14:00, 14:18 -> 14:30). Display-only — never use this to
 * derive a value that gets written back to the backend.
 */
export function roundToNearestHalfHour(isoString) {
  if (!isoString) return null;
  const date = new Date(isoString);
  const halfHourMs = 30 * 60 * 1000;
  const rounded = new Date(Math.round(date.getTime() / halfHourMs) * halfHourMs);
  return rounded.toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit', hour12: false });
}
