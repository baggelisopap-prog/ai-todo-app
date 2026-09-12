import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TaskFilterContext } from '../hooks/useTaskFilters';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { useMembers } from '../hooks/useMembers';
import { UNFILED } from '../utils/workspaces';
import { isVisibleTask } from '../utils/taskDisplay';
import {
  EMPTY_STORED,
  resolveFilters,
  setStoredFilter,
  clearStoredFilters,
  applyFilters,
  activeFilterCount,
  describeFilters,
  countByCategory,
  categoryOptions as buildCategoryOptions,
  priorityOptions as buildPriorityOptions,
} from '../utils/taskFilters';

/**
 * One copy of the three filters, read by Today, the Calendar and Browse.
 *
 * WHY IT IS ONE COPY. Each screen used to keep its own, so choosing κήπος in
 * Today and walking to the Calendar started over — while the workspace chip
 * came along, because that one is stored. Two rules for two controls sitting
 * 30px apart. Now the workspace remains the only thing that survives a
 * RESTART (it is in app_settings, so the phone and the laptop agree) and the
 * three filters survive a SCREEN CHANGE, which is what was actually missing.
 *
 * Deliberately NOT persisted to storage. A P1 filter left on from Tuesday is
 * work hidden on Thursday, and a screen that lies about being empty is the
 * complaint this whole change exists to answer. So: they live as long as the
 * app is open, and while they are on, the chip row says so out loud.
 *
 * Rendered INSIDE WorkspaceProvider and MembersProvider, and given the
 * already-workspace-scoped task list, because all three are needed to work out
 * what is in force: a category id is only meaningful in its own workspace, and
 * "Δικά μου" is only a question where somebody else could be holding a task.
 */
export function TaskFilterProvider({ tasks, children }) {
  const { t } = useTranslation();
  const { activeId, categoriesFor } = useWorkspaces();
  const { myId, isShared, hasAnyShared } = useMembers();

  const [stored, setStored] = useState(EMPTY_STORED);

  // UNFILED is a view, not a workspace: it has no categories of its own.
  const categories = useMemo(
    () => (activeId && activeId !== UNFILED ? categoriesFor(activeId) : []),
    [activeId, categoriesFor]
  );

  const showCategory = categories.length > 0;

  // Only where more than one person can hold a task. On a solo account the
  // control would be three buttons producing the same list; on "Όλα" the list
  // genuinely mixes workspaces, so the question survives as long as ANY room
  // is shared — hence two different checks rather than one. This is the rule
  // FilterBar used to carry, moved here so the FILTER and the CONTROL cannot
  // disagree about whether it applies.
  const showAssignment = activeId ? isShared(activeId) : hasAnyShared;

  // What is in force, derived — never copied into state by an effect. Copying
  // it would be the cascading-render pattern this project's lint rule already
  // flags a dozen times elsewhere, plus a ref to remember whether the copy had
  // happened. Deriving needs neither, and it means switching workspace drops a
  // category filter that cannot apply without anything having to clean up.
  const filters = useMemo(
    () => resolveFilters(stored, {
      workspaceId: activeId,
      categoryIds: categories.map((c) => c.record_id),
      assignmentApplies: showAssignment,
    }),
    [stored, activeId, categories, showAssignment]
  );

  const setFilter = useCallback(
    (key, value) => setStored((current) => setStoredFilter(current, key, value, activeId)),
    [activeId]
  );

  const clearOne = useCallback(
    (key) => setStored((current) => setStoredFilter(
      current,
      key,
      key === 'assignment' ? EMPTY_STORED.assignment : EMPTY_STORED.priority,
      activeId
    )),
    [activeId]
  );

  const clearAll = useCallback(() => setStored((current) => clearStoredFilters(current)), []);

  // Counted over live work only, and over the whole workspace rather than over
  // what the filters already narrowed to — so "Κήπος (7)" answers "how much is
  // in there", not "how much of what I am already looking at". Completed and
  // deleted tasks are excluded because a number promising seven things to do
  // and delivering two finished ones is worse than no number.
  const counts = useMemo(() => {
    const live = (tasks || []).filter((task) => isVisibleTask(task) && !task.is_completed);
    return countByCategory(live, categories);
  }, [tasks, categories]);

  const value = useMemo(() => ({
    filters,
    stored,
    setFilter,
    clearOne,
    clearAll,
    activeCount: activeFilterCount(filters),
    chips: describeFilters(filters, categories, t),
    categories,
    counts,
    showCategory,
    showAssignment,
    categoryOptions: (options) => buildCategoryOptions(categories, counts, t, options),
    priorityOptions: () => buildPriorityOptions(t),
    apply: (list) => applyFilters(list, filters, myId),
  }), [
    filters, stored, setFilter, clearOne, clearAll, categories, counts,
    showCategory, showAssignment, myId, t,
  ]);

  return <TaskFilterContext.Provider value={value}>{children}</TaskFilterContext.Provider>;
}

export default TaskFilterProvider;
