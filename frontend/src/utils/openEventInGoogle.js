// Google Calendar events are read-only in-app (like Todoist) — tapping one
// opens the real event in Google Calendar instead of editing it here.
export function openEventInGoogle(event) {
  if (event.html_link) {
    window.open(event.html_link, '_blank', 'noopener,noreferrer');
  }
}
