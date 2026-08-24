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

export function formatDate(dateStr, timeStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const options = { month: 'short', day: 'numeric' };
  if (date.getFullYear() !== now.getFullYear()) {
    options.year = 'numeric';
  }
  const dateFormatted = date.toLocaleDateString('en-US', options);
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
