import { useTranslation } from 'react-i18next';
import TaskList from './TaskList';

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
    const targetISO = target.toISOString().split('T')[0];
    return task.due_date === targetISO;
  };

  const sections = [];
  for (let i = 1; i <= 7; i++) {
    const dayTasks = tasks.filter((task) => baseFilter(task) && isDueOnDay(task, i));
    const targetDate = new Date(today);
    targetDate.setDate(targetDate.getDate() + i);
    sections.push({
      label: getSectionLabel(t, i, targetDate),
      tasks: dayTasks,
      key: `day-${i}`,
    });
  }

  const noDateTasks = tasks.filter((task) => baseFilter(task) && !task.due_date);
  sections.push({
    label: t('sections.no_date'),
    tasks: noDateTasks,
    key: 'no-date',
  });

  return sections;
}

function UpcomingView({ tasks, expandedTaskId, onToggleExpand, onTaskUpdate, onTaskDeleted }) {
  const { t } = useTranslation();

  const sections = computeSections(tasks, t);
  const totalCount = sections.reduce((sum, s) => sum + s.tasks.length, 0);

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
            />
          )}
        </div>
      ))}
    </div>
  );
}

export default UpcomingView;
