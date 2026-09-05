/**
 * The two letters shown in the avatar circle.
 *
 * Lives here rather than inside AppBar because the desktop sidebar draws the
 * same circle at its foot, and a module exporting a component may export
 * nothing else without tripping react-refresh.
 */
export function getInitials(displayName, email) {
  const name = displayName?.trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return parts[0].slice(0, 2).toUpperCase();
  }
  if (email) return email[0].toUpperCase();
  return '?';
}
