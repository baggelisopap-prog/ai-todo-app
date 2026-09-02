import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import EmptyState from './EmptyState';
import TaskList from './TaskList';
import FilterBar from './FilterBar';
import { filterTasksByCategory } from '../utils/workspaces';
import { toLocalISODate } from '../utils/formatDate';
import { getGoogleCalendarEvents, convertCalendarEventToTask, dismissCalendarEvent } from '../api';
import { openEventInGoogle } from '../utils/openEventInGoogle';
import { useAppSettings } from '../hooks/useAppSettings';
import { isVisibleTask } from '../utils/taskDisplay';

function TodayView({ tasks, expandedTaskId, onToggleExpand, onTaskUpdate, onTaskDeleted, onShowToast }) {
  const { t } = useTranslation();
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedPriority, setSelectedPriority] = useState('All');
  const [overdueExpanded, setOverdueExpanded] = useState(true);
  const [todayEvents, setTodayEvents] = useState([]);
  const { settings } = useAppSettings();

  // Undefined while the one settings fetch is in flight. Treated as "don't show
  // yet" rather than defaulting to true: guessing here is what produced a flash
  // of events for users who had turned them off.
  const showEventsEnabled = settings?.calendar_show_events;

  const today = toLocalISODate(new Date());

  useEffect(() => {
    if (!showEventsEnabled) {
      setTodayEvents([]);
      return;
    }
    getGoogleCalendarEvents(today).then(setTodayEvents).catch(console.error);
  }, [today, showEventsEnabled]);

  async function handleMakeTask(eventId) {
    try {
      await convertCalendarEventToTask(eventId);
      setTodayEvents((current) => current.filter((e) => e.id !== eventId));
    } catch (err) {
      console.error('Failed to convert calendar event:', err);
    }
  }

  async function handleDismissEvent(eventId) {
    try {
      await dismissCalendarEvent(eventId);
      setTodayEvents((current) => current.filter((e) => e.id !== eventId));
    } catch (err) {
      console.error('Failed to dismiss calendar event:', err);
    }
  }

  // Category is now the user's OWN category (tasks.category_id), not the old
  // four-word column. 'All' means no filter; UNFILED means the ones with none.
  const filteredTasks = filterTasksByCategory(
    tasks, selectedCategory === 'All' ? null : selectedCategory
  ).filter((task) => selectedPriority === 'All' || task.priority === selectedPriority);

  const todayTasks = filteredTasks.filter((task) =>
    task.approval_status &&
    !task.is_completed &&
    isVisibleTask(task) &&
    task.due_date === today
  );

  const overdueTasks = filteredTasks.filter((task) =>
    task.approval_status &&
    !task.is_completed &&
    isVisibleTask(task) &&
    task.due_date &&
    task.due_date < today
  );

  const pendingTodayTasks = filteredTasks.filter((task) =>
    task.due_date === today &&
    !task.approval_status &&
    isVisibleTask(task)
  );

  const isEmpty = todayTasks.length === 0 && overdueTasks.length === 0 && pendingTodayTasks.length === 0;

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6">
      {/* No heading here — AppBar carries it, so it stays put when you scroll
          instead of leaving with the first swipe. */}
      <FilterBar
        category={selectedCategory}
        onCategoryChange={setSelectedCategory}
        priority={selectedPriority}
        onPriorityChange={setSelectedPriority}
        t={t}
      />

      {todayEvents.length > 0 && (
        <div className="mb-4">
          <p className="text-sm font-semibold text-[var(--text-primary)] mb-2">
            {t('calendar.events_header', { count: todayEvents.length })}
          </p>
          <div className="space-y-1.5">
            {todayEvents.map(event => (
              <div
                key={event.id}
                onClick={() => openEventInGoogle(event)}
                // --calendar-event, not --brand-primary. index.css defines the
                // event colour as cyan and says in so many words that it is
                // "deliberately distinct" from task colours "so events never
                // get confused for tasks" — and the calendar grid honours that.
                // This strip was the one place using the brand red that task
                // actions use, so the same event was a different colour
                // depending on which screen you were looking at.
                className="flex items-center gap-2 px-3 py-2 rounded-md bg-[var(--bg-card)] border-l-4 border-[var(--calendar-event)] cursor-pointer hover:brightness-95"
              >
                {event.start_time && (
                  <span className="text-xs text-[var(--text-muted)] tabular-nums">{event.start_time}</span>
                )}
                <span className="text-sm text-[var(--text-primary)] truncate flex-1">{event.title}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleMakeTask(event.id); }}
                  className="text-xs px-2 py-1 rounded bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] text-white font-medium shrink-0"
                >
                  {t('calendar.make_task')}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDismissEvent(event.id); }}
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)] shrink-0 px-1"
                  aria-label={t('calendar.dismiss')}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {isEmpty ? (
        <EmptyState message={t('empty.today')} />
      ) : (
        <>
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">
              {t('sections.today_header')} <span className="ml-1 text-[var(--text-muted)]">({todayTasks.length})</span>
            </h2>
            {todayTasks.length === 0 ? (
              <EmptyState message={t('empty.today')} size="inline" />
            ) : (
              <TaskList
                tasks={todayTasks}
                sortBy="due_date"
                expandedTaskId={expandedTaskId}
                onToggleExpand={onToggleExpand}
                onUpdateTask={onTaskUpdate}
                onTaskDeleted={onTaskDeleted}
                onShowToast={onShowToast}
              />
            )}
          </div>

          {pendingTodayTasks.length > 0 && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-[var(--priority-p2-text)] uppercase tracking-wide mb-3">
                {t('today.pending_approval_header', { count: pendingTodayTasks.length })}
              </h2>
              <TaskList
                tasks={pendingTodayTasks}
                sortBy="due_date"
                variant="inbox"
                expandedTaskId={expandedTaskId}
                onToggleExpand={onToggleExpand}
                onUpdateTask={onTaskUpdate}
                onTaskDeleted={onTaskDeleted}
                onShowToast={onShowToast}
              />
            </div>
          )}

          {overdueTasks.length > 0 && (
            <div className="mb-6">
              <button
                onClick={() => setOverdueExpanded(!overdueExpanded)}
                className="w-full flex items-center justify-between text-left mb-3"
              >
                <h2 className="text-sm font-semibold text-[var(--priority-p1-text)] uppercase tracking-wide">
                  {t('sections.overdue_header')} <span className="ml-1">({overdueTasks.length})</span>
                </h2>
                <svg
                  className={`w-4 h-4 text-[var(--text-muted)] transition-transform flex-shrink-0 ${overdueExpanded ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {overdueExpanded && (
                <TaskList
                  tasks={overdueTasks}
                  sortBy="due_date"
                  expandedTaskId={expandedTaskId}
                  onToggleExpand={onToggleExpand}
                  onUpdateTask={onTaskUpdate}
                  onTaskDeleted={onTaskDeleted}
                  onShowToast={onShowToast}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default TodayView;
