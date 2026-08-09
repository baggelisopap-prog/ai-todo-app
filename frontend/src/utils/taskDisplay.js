import { toLocalISODate } from './formatDate';

// The card used to print the raw enum — "Business" — while the filter pills in
// Browse showed "Επαγγελματικά" for the same thing. Same concept, two names, in
// the same language. Reuses the keys those pills already use rather than
// inventing a second set.
export const CATEGORY_LABEL_KEYS = {
  Business: 'browse.filter_business',
  Personal: 'browse.filter_personal',
  Unknown: 'browse.filter_unknown',
  Hostaway: 'browse.filter_hostaway',
};

export function categoryColor(category) {
  switch (category) {
    case 'Business':
      return 'var(--category-business)';
    case 'Personal':
      return 'var(--category-personal)';
    case 'Hostaway':
      return 'var(--category-hostaway)';
    default:
      return 'var(--category-unknown)';
  }
}

export function categoryLabel(category, t) {
  return CATEGORY_LABEL_KEYS[category] ? t(CATEGORY_LABEL_KEYS[category]) : category;
}

/**
 * How urgent a due date is, as one of 'overdue' | 'today' | 'later' | 'none'.
 *
 * Exists because the row used to render every date in the same grey. Whether a
 * task was late was carried ENTIRELY by which section it happened to be sitting
 * in, which works in Today and says nothing at all in Browse or in a search
 * result — the two places you are most likely to meet a task out of context.
 *
 * The other half of the rule matters as much: 'later' gets no colour. A list
 * where every date is coloured is a list where colour has stopped meaning
 * anything, so only overdue and today are allowed to spend it.
 */
export function dueTone(task, now = new Date()) {
  if (!task.due_date) return 'none';
  const todayISO = toLocalISODate(now);
  if (task.due_date < todayISO) return 'overdue';
  if (task.due_date === todayISO) return 'today';
  return 'later';
}

export const DUE_TONE_CLASSES = {
  overdue: 'text-[var(--priority-p1)] font-medium',
  today: 'text-[var(--priority-p2)] font-medium',
  later: 'text-[var(--text-secondary)]',
  none: 'text-[var(--text-secondary)]',
};

/**
 * Priority as TEXT, so it is not carried by colour alone.
 *
 * The row showed priority as an 8px coloured dot and nothing else, which tells
 * someone with limited colour perception exactly nothing — and the three
 * priority hues here are red/amber/blue, the classic confusion set. The colour
 * stays (it is faster to scan for those who can use it); this is the second
 * channel beside it, not a replacement.
 */
export function priorityLabel(priority) {
  return priority || 'P3';
}

export function checklistProgress(checklist) {
  if (!checklist || checklist.length === 0) return null;
  return { done: checklist.filter((item) => item.done).length, total: checklist.length };
}
