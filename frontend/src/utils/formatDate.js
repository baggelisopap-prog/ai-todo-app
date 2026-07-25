/**
 * Returns a YYYY-MM-DD string based on the date's LOCAL time components,
 * not UTC. Use this whenever comparing against Airtable date strings
 * (which are stored as YYYY-MM-DD and interpreted as local calendar dates).
 */
export function toLocalISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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
