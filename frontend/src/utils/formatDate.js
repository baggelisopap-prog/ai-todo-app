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
