/**
 * The three filters every task screen shares — category, priority, whose —
 * as pure functions.
 *
 * WHY THIS FILE EXISTS AT ALL. Until now each screen kept its own copy of
 * these three answers in its own useState, which produced two complaints from
 * the owner that are really one:
 *
 *   1. "They don't remember." Choosing κήπος in Today and walking to the
 *      Calendar started over, while the WORKSPACE came along — two different
 *      rules for two controls sitting 30px apart, and no way to tell which was
 *      which without trying.
 *   2. "I can't see what's on." The only record of an active filter was inside
 *      the menu that set it. A forgotten P1 made the day look empty, and the
 *      app said "Τίποτα για σήμερα 🎉" while the work was right there.
 *
 * The second one is why the resolve step below is the important part of this
 * file rather than plumbing: A FILTER MUST NEVER APPLY WHILE THE CONTROL THAT
 * SET IT IS OFF SCREEN. Two ways that used to happen, both of them producing
 * an empty list with nothing on screen to explain it:
 *
 *   - A category id belongs to ONE workspace. Filtering by κήπος and then
 *     switching to Γραφείο left the id in place, so the list filtered on a
 *     category that room does not have: zero tasks, and a category control
 *     rendering an empty label because nothing in its options matched.
 *   - "Δικά μου" only exists in a room with more than one person in it. The
 *     control hides itself on a solo workspace — but the value it had set
 *     stayed behind and kept filtering.
 *
 * So the stored value and the value in force are deliberately NOT the same
 * thing. `resolveFilters` derives the second from the first plus the situation,
 * which is also why none of this needs an effect to clean up after a switch:
 * there is nothing to clean, the stored value was never wrong, it simply does
 * not apply here.
 *
 * Pure and here rather than inside the components for this project's usual
 * reason: `frontend/scripts/*.test.mjs` can import a plain module and cannot
 * render a component, so logic left in a component is logic nothing checks.
 */
import { filterTasksByCategory, UNFILED } from './workspaces.js';
import { filterTasksByAssignment, ASSIGNMENT_ALL, ASSIGNMENT_MINE, ASSIGNMENT_UNASSIGNED } from './assignment.js';
import { foldForSearch } from './searchTasks.js';

/**
 * "No filter on this axis".
 *
 * The string 'All' rather than null, because the existing controls already use
 * it as a CustomSelect value and null is not selectable there. It is also the
 * opposite of UNFILED, which asks for the ones with nothing — see workspaces.js.
 */
export const ALL = 'All';

export const DEFAULT_FILTERS = {
  category: ALL,
  priority: ALL,
  assignment: ASSIGNMENT_ALL,
};

/** What the provider keeps. Only `categoryByWorkspace` needs explaining — see below. */
export const EMPTY_STORED = {
  // Keyed by workspace id, because a category id is only meaningful inside its
  // own workspace. Storing one flat `category` is what produced the stale-id
  // bug; storing it per room makes that bug unrepresentable rather than fixed,
  // and has the pleasant side effect that coming back to a room finds the
  // filter where you left it.
  categoryByWorkspace: {},
  priority: ALL,
  assignment: ASSIGNMENT_ALL,
};

/**
 * The filters actually in force, from what is stored plus where the user is.
 *
 * `context.workspaceId`  — null on "Όλα", UNFILED on the unfiled bucket.
 * `context.categoryIds`  — the ids that exist in THAT workspace right now.
 * `context.assignmentApplies` — is there anybody else who could hold a task.
 */
export function resolveFilters(stored, context) {
  const { workspaceId = null, categoryIds = [], assignmentApplies = false } = context || {};
  const source = stored || EMPTY_STORED;

  return {
    category: resolveCategory(source, workspaceId, categoryIds),
    // Priority is the one axis with no precondition: every task has one (or
    // counts as P3), in every workspace, shared or not.
    priority: source.priority || ALL,
    assignment: assignmentApplies ? (source.assignment || ASSIGNMENT_ALL) : ASSIGNMENT_ALL,
  };
}

function resolveCategory(stored, workspaceId, categoryIds) {
  // "Όλα" and the unfiled bucket have no category control — there is no single
  // coherent list of categories across two workspaces — so there is nothing to
  // apply. Reading the map with a null key would also collide with itself.
  if (!workspaceId || workspaceId === UNFILED) return ALL;

  const value = (stored.categoryByWorkspace || {})[workspaceId];
  if (!value || value === ALL) return ALL;
  // "Has no category" needs no id to exist, so it is always legal.
  if (value === UNFILED) return UNFILED;
  // Deleted here or on the other device: fall back rather than filter on an id
  // nothing matches, which is an empty screen with no visible cause.
  return (categoryIds || []).includes(value) ? value : ALL;
}

/** The stored shape with one axis set. */
export function setStoredFilter(stored, key, value, workspaceId) {
  const source = stored || EMPTY_STORED;
  if (key === 'category') {
    return {
      ...source,
      categoryByWorkspace: { ...(source.categoryByWorkspace || {}), [workspaceId]: value },
    };
  }
  return { ...source, [key]: value };
}

/** The stored shape with every axis back to its default. */
export function clearStoredFilters(stored) {
  const source = stored || EMPTY_STORED;
  return {
    ...source,
    categoryByWorkspace: {},
    priority: ALL,
    assignment: ASSIGNMENT_ALL,
  };
}

/** One filter object with one axis cleared. Used by the × on each chip. */
export function clearFilter(filters, key) {
  const source = filters || DEFAULT_FILTERS;
  return { ...source, [key]: key === 'assignment' ? ASSIGNMENT_ALL : ALL };
}

/**
 * The list narrowed by all three, in one place.
 *
 * Every screen used to spell this chain out itself, and they had already
 * drifted: Today compared `task.priority === 'P3'` while Browse compared
 * `(task.priority || 'P3')`. A task saved with no priority RENDERS as P3 —
 * priorityLabel() says so — so Today's version hid rows that were showing the
 * very badge being filtered for. One chain, the forgiving comparison.
 */
export function applyFilters(tasks, filters, myId) {
  const list = tasks || [];
  const { category, priority, assignment } = filters || DEFAULT_FILTERS;

  let result = category && category !== ALL ? filterTasksByCategory(list, category) : list;
  if (priority && priority !== ALL) {
    result = result.filter((task) => (task.priority || 'P3') === priority);
  }
  return filterTasksByAssignment(result, assignment, myId);
}

/** How many axes are narrowing the list. 0 means the screen is showing everything. */
export function activeFilterCount(filters) {
  const { category, priority, assignment } = filters || DEFAULT_FILTERS;
  let n = 0;
  if (category && category !== ALL) n++;
  if (priority && priority !== ALL) n++;
  if (assignment && assignment !== ASSIGNMENT_ALL) n++;
  return n;
}

const ASSIGNMENT_LABEL_KEYS = {
  [ASSIGNMENT_MINE]: 'assignment.mine',
  [ASSIGNMENT_UNASSIGNED]: 'assignment.unassigned',
};

/**
 * Every active filter as one removable chip: { key, label }.
 *
 * This is the answer to "I can't see what's on". The label is what the control
 * that set it says, word for word — a chip reading anything else would be a
 * second name for one thing, and the user would have to work out that they
 * match.
 *
 * A category id with no category behind it yields NO chip rather than a chip
 * saying "undefined". That state is already impossible after resolveFilters,
 * so this is the second belt: the chip is the only visible record of a filter,
 * and a broken one is worse than none.
 */
export function describeFilters(filters, categories, t) {
  const { category, priority, assignment } = filters || DEFAULT_FILTERS;
  const chips = [];

  if (category && category !== ALL) {
    if (category === UNFILED) {
      chips.push({ key: 'category', label: t('workspace.unfiled') });
    } else {
      // The user's own word, not translated: these names are their data.
      const found = (categories || []).find((c) => c.record_id === category);
      if (found) chips.push({ key: 'category', label: found.name });
    }
  }

  // P1, not "Προτεραιότητα P1": the rows carry the same two characters, so the
  // chip and the badge it explains read as the same thing.
  if (priority && priority !== ALL) chips.push({ key: 'priority', label: priority });

  if (assignment && assignment !== ASSIGNMENT_ALL && ASSIGNMENT_LABEL_KEYS[assignment]) {
    chips.push({ key: 'assignment', label: t(ASSIGNMENT_LABEL_KEYS[assignment]) });
  }

  return chips;
}

/**
 * How much live work sits in each category, plus the two synthetic buckets.
 *
 * Counted over the list handed in — which callers scope to live, visible tasks
 * — rather than over what the current filters already narrowed to, so the
 * number beside a category answers "how much is in there" and not "how much of
 * what I have already narrowed to". Browse has worked this way since it got
 * counts; this is that code, moved here so Today and the Calendar can show the
 * same number rather than a different one.
 */
export function countByCategory(tasks, categories) {
  const list = tasks || [];
  const counts = {
    All: list.length,
    [UNFILED]: list.filter((task) => !task.category_id).length,
  };
  for (const category of categories || []) {
    counts[category.record_id] = list.filter((task) => task.category_id === category.record_id).length;
  }
  return counts;
}

// categoryOptions() and priorityOptions() lived here until 2026-09-12. They
// built the labels for two DROPDOWNS — "Κήπος (7)" as one string, an axis name
// as the resting row — and both dropdowns are gone: the filters moved into a
// sheet where every option is a visible pill and the count is a separate
// column beside the name, not text glued onto it. countByCategory below still
// feeds those numbers.

/** Whether a menu is long enough to need a find box rather than a scroll. */
export function needsFind(optionCount) {
  return (optionCount || 0) >= 8;
}

/** Accent- and case-insensitive match for the find box, reusing the search folding. */
export function matchesOption(label, query) {
  const needle = foldForSearch(query).trim();
  if (!needle) return true;
  return foldForSearch(label).includes(needle);
}
