/**
 * The colour of one person's avatar circle.
 *
 * DERIVED FROM THE USER ID, not stored and not chosen. Two reasons, and the
 * second is the one that matters: a stored colour is another column, another
 * migration and another settings screen for something nobody wants to decide;
 * and a derived one is stable everywhere at once — the same person is the same
 * colour on a task row, in the members panel and in the activity log, with
 * nothing to keep in step. This is what Slack and Trello both do.
 *
 * Deliberately NOT a CSS variable. `scripts/ui-check.mjs` fails the build for a
 * variable that is not defined in index.css, and a palette of eight avatar
 * colours would be eight tokens defined twice (light and dark) to express one
 * number that a hash already gives us.
 *
 * Saturation and lightness are fixed rather than hashed: the hue alone
 * separates people, and letting lightness vary would eventually produce a
 * circle too pale for the white letters on top of it.
 */
export function personColor(userId) {
  if (!userId) return 'hsl(0, 0%, 45%)';
  // djb2. Small, no dependency, and spreads short similar strings — which is
  // what uuids are: they differ early and share their shape.
  let hash = 5381;
  for (let i = 0; i < userId.length; i += 1) {
    hash = ((hash << 5) + hash + userId.charCodeAt(i)) | 0;
  }
  return `hsl(${Math.abs(hash) % 360}, 52%, 42%)`;
}

/**
 * What to call somebody, in the order the app can actually answer it.
 *
 * A member row carries display_name only if that person has set one, and email
 * only because the server joined `profiles`. The id is the last resort and is
 * never nice to read — but a raw id on screen is still better than an empty
 * space where a name should be, because it tells you somebody is there.
 */
export function personName(member) {
  if (!member) return null;
  return member.display_name || member.email || member.user_id;
}
