import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import TaskCard from './TaskCard';
import { toLocalISODate } from '../utils/formatDate';
import { priorityColor } from '../utils/priorityColor';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function getCalendarCells(currentMonth) {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const firstDayWeekday = firstDay.getDay(); // 0 = Sun

  const cells = [];

  // Previous month tail
  for (let i = firstDayWeekday - 1; i >= 0; i--) {
    const d = new Date(year, month, -i);
    cells.push({ date: d, inCurrentMonth: false });
  }

  // Current month
  const lastDay = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= lastDay; day++) {
    const d = new Date(year, month, day);
    cells.push({ date: d, inCurrentMonth: true });
  }

  // Next month lead (to fill final row)
  while (cells.length % 7 !== 0) {
    const lastCell = cells[cells.length - 1];
    const next = new Date(lastCell.date);
    next.setDate(next.getDate() + 1);
    cells.push({ date: next, inCurrentMonth: false });
  }

  return cells;
}

function formatMonthYear(date) {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function formatSelectedDayLabel(date) {
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

const STATUS_RANK = { pending: 0, approved: 1, completed: 2 };

function statusRank(task) {
  if (task.is_completed) return STATUS_RANK.completed;
  if (!task.approval_status) return STATUS_RANK.pending;
  return STATUS_RANK.approved;
}

export function CalendarView({ tasks, expandedTaskId, onToggleExpand, onTaskUpdate, onTaskDeleted, onShowToast }) {
  const { t } = useTranslation();
  const [currentMonth, setCurrentMonth] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = toLocalISODate(today);
  const selectedISO = toLocalISODate(selectedDate);

  function isToday(date) {
    return toLocalISODate(date) === todayISO;
  }

  function isSelectedDate(date) {
    return toLocalISODate(date) === selectedISO;
  }

  function handlePrevMonth() {
    setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  }

  function handleNextMonth() {
    setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  }

  const tasksByDate = tasks.reduce((acc, task) => {
    if (!task.due_date) return acc;
    if (task.is_rejected) return acc;
    const key = task.due_date;
    if (!acc[key]) acc[key] = [];
    acc[key].push(task);
    return acc;
  }, {});

  const cells = getCalendarCells(currentMonth);

  const selectedDayTasks = (tasksByDate[selectedISO] || [])
    .slice()
    .sort((a, b) => statusRank(a) - statusRank(b));

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6 pb-24">
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={handlePrevMonth}
          className="p-2 rounded hover:bg-[var(--bg-hover)]"
          aria-label={t('calendar.prev_month')}
        >
          <ChevronLeftIcon />
        </button>
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">
          {formatMonthYear(currentMonth)}
        </h1>
        <button
          onClick={handleNextMonth}
          className="p-2 rounded hover:bg-[var(--bg-hover)]"
          aria-label={t('calendar.next_month')}
        >
          <ChevronRightIcon />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-2">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="text-center text-xs font-medium text-[var(--text-secondary)] uppercase">
            {label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell) => {
          const cellISO = toLocalISODate(cell.date);
          const dayTasks = tasksByDate[cellISO] || [];
          const selected = isSelectedDate(cell.date);
          const todayCell = isToday(cell.date);

          return (
            <button
              key={cellISO}
              onClick={() => setSelectedDate(cell.date)}
              className={`
                aspect-square p-1 rounded flex flex-col items-center justify-start gap-1
                ${cell.inCurrentMonth ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}
                ${selected ? 'bg-[var(--brand-primary)] text-white' : 'hover:bg-[var(--bg-hover)]'}
                ${todayCell && !selected ? 'font-bold ring-2 ring-[var(--brand-primary)]/40' : ''}
                transition-colors
              `}
            >
              <span className="text-sm">{cell.date.getDate()}</span>
              <div className="flex gap-0.5 flex-wrap justify-center">
                {dayTasks.slice(0, 3).map((task, idx) => (
                  <span
                    key={idx}
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: priorityColor(task.priority) }}
                  />
                ))}
                {dayTasks.length > 3 && (
                  <span className="text-[10px] text-[var(--text-secondary)]">+</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-6">
        <h2 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">
          {formatSelectedDayLabel(selectedDate)}
          <span className="ml-1 text-[var(--text-muted)]">
            ({selectedDayTasks.length})
          </span>
        </h2>
        {selectedDayTasks.length > 0 ? (
          <div className="space-y-2">
            {selectedDayTasks.map((task) => (
              <TaskCard
                key={task.record_id}
                task={task}
                isExpanded={expandedTaskId === task.record_id}
                onToggleExpand={onToggleExpand}
                onUpdate={onTaskUpdate}
                onTaskDeleted={onTaskDeleted}
                onShowToast={onShowToast}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--text-muted)] italic ml-1">
            {t('empty.no_tasks')}
          </p>
        )}
      </div>
    </div>
  );
}

function ChevronLeftIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

export default CalendarView;
