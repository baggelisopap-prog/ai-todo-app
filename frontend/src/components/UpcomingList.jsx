import { useTranslation } from 'react-i18next';
import EmptyState from './EmptyState';
import TaskList from './TaskList';
import { useTaskFilters } from '../hooks/useTaskFilters';
import { toLocalISODate, weekdayShortUpper } from '../utils/formatDate';
import { isVisibleTask, isClosedForMe } from '../utils/taskDisplay';
import { useMembers } from '../hooks/useMembers';

/**
 * The next seven days as day-headed sections, plus everything with no date.
 *
 * Was its own bottom-tab view ("Upcoming"). It is now the Calendar's List mode,
 * because Upcoming and Calendar answered the same question — "what is coming" —
 * with two tabs, and five tabs is where the Greek labels started clipping. What
 * changed is only where it is mounted: it no longer draws its own heading or
 * filter bar, since the Calendar above it already provides both.
 *
 * Takes tasks ALREADY filtered by the caller's FilterBar, for the same reason.
 * `unfilteredTasks` is the same list BEFORE those filters, and it is here for
 * one job: a week where every section is empty looks identical whether there
 * is genuinely nothing coming or a forgotten filter is hiding all of it. Eight
 * headings reading "(0)" is the app lying quietly, so when something IS
 * filtered the sections give way to one line that says how much is hidden and
 * a button that shows it again.
 */
function getSectionLabel(t, daysFromNow, date) {
  if (daysFromNow === 1) {
    return t('sections.tomorrow');
  }
  const weekday = weekdayShortUpper(date);
  const day = date.getDate();
  return `${weekday} ${day}`;
}

function computeSections(tasks, t, myId) {
  const baseFilter = (task) =>
    task.approval_status && !isClosedForMe(task, myId) && isVisibleTask(task);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const isDueOnDay = (task, daysFromNow) => {
    if (!task.due_date) return false;
    const target = new Date(today);
    target.setDate(target.getDate() + daysFromNow);
    const targetISO = toLocalISODate(target);
    return task.due_date === targetISO;
  };

  const daySections = [];
  for (let i = 1; i <= 7; i++) {
    const dayTasks = tasks.filter((task) => baseFilter(task) && isDueOnDay(task, i));
    const targetDate = new Date(today);
    targetDate.setDate(targetDate.getDate() + i);
    daySections.push({
      label: getSectionLabel(t, i, targetDate),
      tasks: dayTasks,
      key: `day-${i}`,
    });
  }

  const noDateTasks = tasks.filter((task) => baseFilter(task) && !task.due_date);
  const noDateSection = {
    label: t('sections.no_date'),
    tasks: noDateTasks,
    key: 'no-date',
  };

  return { daySections, noDateSection };
}

function UpcomingList({ tasks, unfilteredTasks, expandedTaskId, onToggleExpand, onTaskUpdate, onTaskDeleted, onShowToast, onTaskAcknowledged }) {
  const { t } = useTranslation();
  const { activeCount, clearAll } = useTaskFilters();
  // Who "I" am — a task a colleague closed stays on this list until I press OK.
  const { myId } = useMembers();

  const { daySections, noDateSection } = computeSections(tasks, t, myId);

  const shown = [...daySections, noDateSection].reduce((n, section) => n + section.tasks.length, 0);
  // Only counted in the one case that needs explaining: nothing on screen and
  // something switched on.
  const hiddenByFilters = shown === 0 && activeCount > 0 && unfilteredTasks
    ? (() => {
        const all = computeSections(unfilteredTasks, t, myId);
        return [...all.daySections, all.noDateSection].reduce((n, section) => n + section.tasks.length, 0);
      })()
    : 0;

  // Trailing empty days are dropped, but empty days BETWEEN populated ones are
  // kept — a gap in the week is information ("nothing on Thursday"), whereas
  // four empty days after the last task is just padding.
  let lastPopulatedIndex = -1;
  for (let i = daySections.length - 1; i >= 0; i--) {
    if (daySections[i].tasks.length > 0) {
      lastPopulatedIndex = i;
      break;
    }
  }
  const visibleDaySections = daySections.filter(
    (section, idx) => section.tasks.length > 0 || idx < lastPopulatedIndex
  );

  const sections = [...visibleDaySections, noDateSection];

  if (hiddenByFilters > 0) {
    return (
      <EmptyState
        message={t('filters.hidden', { count: hiddenByFilters })}
        action={{ label: t('filters.clear_all'), onClick: clearAll }}
      />
    );
  }

  return (
    <div>
      {sections.map((section) => (
        <div key={section.key} className="mb-6">
          <h2 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">
            {section.label} <span className="ml-1 text-[var(--text-muted)]">({section.tasks.length})</span>
          </h2>
          {section.tasks.length === 0 ? (
            <EmptyState message={t('empty.no_tasks')} size="inline" />
          ) : (
            <TaskList
              tasks={section.tasks}
              sortBy="due_date"
              expandedTaskId={expandedTaskId}
              onToggleExpand={onToggleExpand}
              onUpdateTask={onTaskUpdate}
              onTaskAcknowledged={onTaskAcknowledged}
              onTaskDeleted={onTaskDeleted}
              onShowToast={onShowToast}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export default UpcomingList;
