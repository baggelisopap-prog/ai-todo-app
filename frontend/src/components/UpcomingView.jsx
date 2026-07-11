import { useTranslation } from 'react-i18next';
import TaskList from './TaskList';
import { toLocalISODate } from '../utils/formatDate';

function getSectionLabel(t, daysFromNow, date) {
  if (daysFromNow === 1) {
    return t('sections.tomorrow');
  }
  const weekday = date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
  const day = date.getDate();
  return `${weekday} ${day}`;
}

function computeSections(tasks, t) {
  const baseFilter = (task) =>
    task.approval_status && !task.is_completed && !task.is_rejected;

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

  const totalCount =
    daySections.reduce((sum, s) => sum + s.tasks.length, 0) + noDateSection.tasks.length;

  return { daySections, noDateSection, totalCount };
}

function UpcomingView({ tasks, expandedTaskId, onToggleExpand, onTaskUpdate, onTaskDeleted, onShowToast }) {
  const { t } = useTranslation();

  const { daySections, noDateSection, totalCount } = computeSections(tasks, t);

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

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
          {t('nav.upcoming')}
          <span className="ml-2 text-sm font-normal text-[var(--text-muted)]">({totalCount})</span>
        </h1>
      </div>

      {sections.map((section) => (
        <div key={section.key} className="mb-6">
          <h2 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">
            {section.label} <span className="ml-1 text-[var(--text-muted)]">({section.tasks.length})</span>
          </h2>
          {section.tasks.length === 0 ? (
            <div className="py-4 text-center text-[var(--text-muted)] text-sm italic">{t('empty.no_tasks')}</div>
          ) : (
            <TaskList
              tasks={section.tasks}
              sortBy="due_date"
              expandedTaskId={expandedTaskId}
              onToggleExpand={onToggleExpand}
              onUpdateTask={onTaskUpdate}
              onTaskDeleted={onTaskDeleted}
              onShowToast={onShowToast}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export default UpcomingView;
