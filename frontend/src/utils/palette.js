/**
 * The eight colours a workspace or a category may be.
 *
 * LITERAL HEX, not CSS variables, and deliberately so: this is DATA. It is
 * written into `workspaces.color` and `categories.color` and sent to the
 * server, and a `var(--brand-primary)` string sitting in a database column is a
 * colour nothing outside a browser can read. `utils/people.js` makes the same
 * call for avatar colours, with the same reasoning.
 *
 * The eight are the app's own hues rather than a new set: purple, green, grey
 * and teal are the four category colours already defined in index.css (teal is
 * the Hostaway category's, purple is what Business has carried since workspaces
 * shipped), and blue, amber, red and pink are the priority and highlight hues.
 * Nothing here is a colour the app was not already using.
 *
 * Each carries a `key` rather than a name, because the name has to be readable
 * in both languages — `color.purple` in the locale files.
 */
export const PALETTE = [
  { value: '#8b5cf6', key: 'purple' },
  { value: '#3b82f6', key: 'blue' },
  { value: '#0d9488', key: 'teal' },
  { value: '#10b981', key: 'green' },
  { value: '#f59e0b', key: 'amber' },
  { value: '#dc2626', key: 'red' },
  { value: '#ec4899', key: 'pink' },
  { value: '#6b7280', key: 'grey' },
];
