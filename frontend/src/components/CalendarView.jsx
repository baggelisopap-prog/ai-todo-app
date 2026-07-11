import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  DragOverlay,
  useSensor,
  useSensors,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import TaskCard from './TaskCard';
import { toLocalISODate } from '../utils/formatDate';
import { priorityColor } from '../utils/priorityColor';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = Array.from({ length: 16 }, (_, i) => i + 7); // 07:00-22:00
const GRID_TEMPLATE = 'grid grid-cols-[auto_repeat(7,minmax(0,1fr))] gap-1';

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

function getWeekDays(weekStart) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
}

function formatMonthYear(date) {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function formatSelectedDayLabel(date) {
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatWeekRange(weekStart) {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const startMonth = weekStart.toLocaleDateString('en-US', { month: 'short' });
  const endMonth = weekEnd.toLocaleDateString('en-US', { month: 'short' });
  if (startMonth === endMonth) {
    return `${startMonth} ${weekStart.getDate()} - ${weekEnd.getDate()}`;
  }
  return `${startMonth} ${weekStart.getDate()} - ${endMonth} ${weekEnd.getDate()}`;
}

function weekdayShort(date) {
  return date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
}

function formatHour(hour) {
  return `${String(hour).padStart(2, '0')}:00`;
}

function computeNowIndicator(currentWeekStart) {
  const now = new Date();
  const weekEnd = new Date(currentWeekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  if (now < currentWeekStart || now > weekEnd) {
    return { show: false };
  }

  const hour = now.getHours();
  const minute = now.getMinutes();

  if (hour < 7 || hour > 22) {
    return { show: false };
  }

  const hoursFromStart = hour - 7 + minute / 60;
  const topPercent = (hoursFromStart / 16) * 100;

  return { show: true, topPercent };
}

const STATUS_RANK = { pending: 0, approved: 1, completed: 2 };

function statusRank(task) {
  if (task.is_completed) return STATUS_RANK.completed;
  if (!task.approval_status) return STATUS_RANK.pending;
  return STATUS_RANK.approved;
}

function isTaskDraggable(task) {
  return !task.is_completed && !task.is_rejected;
}

export function CalendarView({ tasks, expandedTaskId, onToggleExpand, onTaskUpdate, onTaskDeleted, onShowToast }) {
  const { t } = useTranslation();

  const [viewMode, setViewMode] = useState('monthly'); // 'monthly' | 'weekly'

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

  const [currentWeekStart, setCurrentWeekStart] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    d.setDate(d.getDate() - day);
    return d;
  });
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [activeDragTask, setActiveDragTask] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    })
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = toLocalISODate(today);

  function handlePrevMonth() {
    setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  }

  function handleNextMonth() {
    setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  }

  function handlePrevWeek() {
    setCurrentWeekStart((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() - 7);
      return d;
    });
  }

  function handleNextWeek() {
    setCurrentWeekStart((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() + 7);
      return d;
    });
  }

  function handleTaskClick(task) {
    setSelectedTaskId((prev) => (prev === task.record_id ? null : task.record_id));
  }

  function handleWeeklyTaskDeleted(recordId) {
    if (selectedTaskId === recordId) setSelectedTaskId(null);
    onTaskDeleted(recordId);
  }

  function handleReschedule(task, dropTargetId) {
    const [kind, ...rest] = dropTargetId.split(':');

    let newDate;
    let newTime;

    if (kind === 'day') {
      newDate = rest[0];
      newTime = task.due_time || null;
    } else if (kind === 'cell') {
      newDate = rest[0];
      newTime = `${rest[1].padStart(2, '0')}:00`;
    } else if (kind === 'allday') {
      newDate = rest[0];
      newTime = null;
    } else {
      return;
    }

    if (newDate === task.due_date && newTime === (task.due_time || null)) return;

    const previousDate = task.due_date;
    const previousTime = task.due_time || null;

    onTaskUpdate(task.record_id, { due_date: newDate, due_time: newTime }).catch(() => {});

    onShowToast({
      message: t('calendar.rescheduled'),
      variant: 'success',
      duration: 5000,
      action: {
        label: t('calendar.undo'),
        onClick: () => {
          onTaskUpdate(task.record_id, { due_date: previousDate, due_time: previousTime }).catch(() => {});
        },
      },
    });
  }

  function handleDragStart(event) {
    const taskId = event.active.id;
    const task = tasks.find((tk) => tk.record_id === taskId);
    setActiveDragTask(task || null);
  }

  function handleDragEnd(event) {
    setActiveDragTask(null);
    const { active, over } = event;
    if (!over) return;

    const task = tasks.find((tk) => tk.record_id === active.id);
    if (!task) return;

    handleReschedule(task, over.id);
  }

  const tasksByDate = tasks.reduce((acc, task) => {
    if (!task.due_date) return acc;
    if (task.is_rejected) return acc;
    const key = task.due_date;
    if (!acc[key]) acc[key] = [];
    acc[key].push(task);
    return acc;
  }, {});

  const selectedISO = toLocalISODate(selectedDate);
  const selectedDayTasks = (tasksByDate[selectedISO] || [])
    .slice()
    .sort((a, b) => statusRank(a) - statusRank(b));

  const selectedTask = selectedTaskId ? tasks.find((tk) => tk.record_id === selectedTaskId) : null;

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="max-w-3xl mx-auto p-4 md:p-6 pb-24">
        <div className="flex justify-center mb-4">
          <div className="inline-flex rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-0.5">
            <button
              onClick={() => setViewMode('monthly')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                viewMode === 'monthly'
                  ? 'bg-[var(--brand-primary)] text-white'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              {t('calendar.monthly')}
            </button>
            <button
              onClick={() => setViewMode('weekly')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                viewMode === 'weekly'
                  ? 'bg-[var(--brand-primary)] text-white'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              {t('calendar.weekly')}
            </button>
          </div>
        </div>

        {viewMode === 'monthly' ? (
          <>
            <MonthlyGrid
              currentMonth={currentMonth}
              onPrevMonth={handlePrevMonth}
              onNextMonth={handleNextMonth}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
              tasksByDate={tasksByDate}
              todayISO={todayISO}
              t={t}
            />

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
                    <div key={task.record_id} className="flex items-start gap-1">
                      <DragHandle task={task} t={t} />
                      <div className="flex-1 min-w-0">
                        <TaskCard
                          task={task}
                          isExpanded={expandedTaskId === task.record_id}
                          onToggleExpand={onToggleExpand}
                          onUpdate={onTaskUpdate}
                          onTaskDeleted={onTaskDeleted}
                          onShowToast={onShowToast}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[var(--text-muted)] italic ml-1">
                  {t('empty.no_tasks')}
                </p>
              )}
            </div>
          </>
        ) : (
          <>
            <WeeklyGrid
              currentWeekStart={currentWeekStart}
              onPrevWeek={handlePrevWeek}
              onNextWeek={handleNextWeek}
              tasks={tasks}
              todayISO={todayISO}
              onTaskClick={handleTaskClick}
              t={t}
            />

            {selectedTask && (
              <div className="mt-6">
                <TaskCard
                  task={selectedTask}
                  isExpanded={expandedTaskId === selectedTask.record_id}
                  onToggleExpand={onToggleExpand}
                  onUpdate={onTaskUpdate}
                  onTaskDeleted={handleWeeklyTaskDeleted}
                  onShowToast={onShowToast}
                />
              </div>
            )}
          </>
        )}
      </div>

      <DragOverlay>
        {activeDragTask && <TaskChip task={activeDragTask} isOverlay />}
      </DragOverlay>
    </DndContext>
  );
}

function DragHandle({ task, t }) {
  const draggable = isTaskDraggable(task);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.record_id,
    disabled: !draggable,
  });

  if (!draggable) {
    return <div className="w-7 flex-shrink-0" />;
  }

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.3 : 1,
  };

  return (
    <button
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      type="button"
      onClick={(e) => e.stopPropagation()}
      className="w-7 h-10 mt-1 flex-shrink-0 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-grab active:cursor-grabbing touch-none transition-colors"
      aria-label={t('calendar.drag_hint')}
    >
      <GripIcon />
    </button>
  );
}

function MonthlyGrid({ currentMonth, onPrevMonth, onNextMonth, selectedDate, onSelectDate, tasksByDate, todayISO, t }) {
  const cells = getCalendarCells(currentMonth);
  const selectedISO = toLocalISODate(selectedDate);

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={onPrevMonth}
          className="p-2 rounded hover:bg-[var(--bg-hover)]"
          aria-label={t('calendar.prev_month')}
        >
          <ChevronLeftIcon />
        </button>
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">
          {formatMonthYear(currentMonth)}
        </h1>
        <button
          onClick={onNextMonth}
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
          return (
            <MonthlyDayCell
              key={cellISO}
              cell={cell}
              isSelected={cellISO === selectedISO}
              isTodayCell={cellISO === todayISO}
              tasksForDay={tasksByDate[cellISO] || []}
              onSelect={onSelectDate}
            />
          );
        })}
      </div>
    </>
  );
}

function MonthlyDayCell({ cell, isSelected, isTodayCell, tasksForDay, onSelect }) {
  const dropId = `day:${toLocalISODate(cell.date)}`;
  const { isOver, setNodeRef } = useDroppable({ id: dropId });

  return (
    <button
      ref={setNodeRef}
      onClick={() => onSelect(cell.date)}
      className={`
        aspect-square p-1 rounded flex flex-col items-center justify-start gap-1
        transition-colors
        ${cell.inCurrentMonth ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}
        ${isSelected ? 'bg-[var(--brand-primary)] text-white' : ''}
        ${!isSelected && isTodayCell ? 'font-bold ring-2 ring-[var(--brand-primary)]/40' : ''}
        ${isOver ? 'bg-[var(--brand-primary)]/20' : ''}
        ${!isSelected && !isOver ? 'hover:bg-[var(--bg-hover)]' : ''}
      `}
    >
      <span className="text-sm">{cell.date.getDate()}</span>
      <div className="flex gap-0.5 flex-wrap justify-center">
        {tasksForDay.slice(0, 3).map((task, idx) => (
          <span
            key={idx}
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: priorityColor(task.priority) }}
          />
        ))}
        {tasksForDay.length > 3 && (
          <span className="text-[10px] text-[var(--text-secondary)]">+</span>
        )}
      </div>
    </button>
  );
}

function WeeklyGrid({ currentWeekStart, onPrevWeek, onNextWeek, tasks, todayISO, onTaskClick, t }) {
  const weekDays = getWeekDays(currentWeekStart);

  const tasksByCell = {};
  const allDayTasksByDate = {};
  for (const task of tasks) {
    if (!task.due_date) continue;
    if (task.is_rejected) continue;

    const dateKey = task.due_date;

    if (!task.due_time) {
      if (!allDayTasksByDate[dateKey]) allDayTasksByDate[dateKey] = [];
      allDayTasksByDate[dateKey].push(task);
    } else {
      const hour = parseInt(task.due_time.split(':')[0], 10);
      const clampedHour = Math.max(7, Math.min(22, hour));
      const cellKey = `${dateKey}-${clampedHour}`;
      if (!tasksByCell[cellKey]) tasksByCell[cellKey] = [];
      tasksByCell[cellKey].push(task);
    }
  }

  const nowIndicator = computeNowIndicator(currentWeekStart);

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={onPrevWeek}
          className="p-2 rounded hover:bg-[var(--bg-hover)]"
          aria-label={t('calendar.prev_week')}
        >
          <ChevronLeftIcon />
        </button>
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">
          {formatWeekRange(currentWeekStart)}
        </h1>
        <button
          onClick={onNextWeek}
          className="p-2 rounded hover:bg-[var(--bg-hover)]"
          aria-label={t('calendar.next_week')}
        >
          <ChevronRightIcon />
        </button>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[600px]">
          <div className={`${GRID_TEMPLATE} mb-1`}>
            <div className="w-14" />
            {weekDays.map((day) => {
              const dayISO = toLocalISODate(day);
              const todayCol = dayISO === todayISO;
              return (
                <div
                  key={dayISO}
                  className={`min-w-0 text-center text-xs font-medium ${
                    todayCol ? 'text-[var(--brand-primary)] font-bold' : 'text-[var(--text-secondary)]'
                  }`}
                >
                  <div className="uppercase">{weekdayShort(day)}</div>
                  <div className="text-sm mt-0.5">{day.getDate()}</div>
                </div>
              );
            })}
          </div>

          <div className={`${GRID_TEMPLATE} mb-1 border-b border-[var(--border-subtle)] pb-2`}>
            <div className="text-xs text-[var(--text-muted)] pt-2 pr-2 text-right w-14">
              {t('calendar.all_day')}
            </div>
            {weekDays.map((day) => {
              const dayKey = toLocalISODate(day);
              return (
                <WeeklyAllDayCell
                  key={dayKey}
                  day={day}
                  tasks={allDayTasksByDate[dayKey] || []}
                  onTaskClick={onTaskClick}
                />
              );
            })}
          </div>

          <div className="relative">
            {HOURS.map((hour) => (
              <div key={hour} className={`${GRID_TEMPLATE} border-t border-[var(--border-subtle)]`}>
                <div className="text-xs text-[var(--text-muted)] pt-1 pr-2 text-right w-14">
                  {formatHour(hour)}
                </div>
                {weekDays.map((day) => {
                  const dayISO = toLocalISODate(day);
                  const cellKey = `${dayISO}-${hour}`;
                  return (
                    <WeeklyHourCell
                      key={cellKey}
                      day={day}
                      hour={hour}
                      tasks={tasksByCell[cellKey] || []}
                      isTodayCol={dayISO === todayISO}
                      onTaskClick={onTaskClick}
                    />
                  );
                })}
              </div>
            ))}

            {nowIndicator.show && (
              <div
                className="absolute left-14 right-0 h-0.5 bg-[var(--brand-primary)]"
                style={{ top: `${nowIndicator.topPercent}%` }}
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function WeeklyHourCell({ day, hour, tasks, isTodayCol, onTaskClick }) {
  const dropId = `cell:${toLocalISODate(day)}:${hour}`;
  const { isOver, setNodeRef } = useDroppable({ id: dropId });

  return (
    <div
      ref={setNodeRef}
      className={`
        min-w-0 min-h-[48px] p-0.5 flex flex-col gap-0.5 transition-colors
        ${isTodayCol ? 'bg-[var(--brand-primary)]/5' : ''}
        ${isOver ? 'bg-[var(--brand-primary)]/15' : ''}
      `}
    >
      {tasks.map((task) => (
        <TaskChip key={task.record_id} task={task} onClick={onTaskClick} />
      ))}
    </div>
  );
}

function WeeklyAllDayCell({ day, tasks, onTaskClick }) {
  const dropId = `allday:${toLocalISODate(day)}`;
  const { isOver, setNodeRef } = useDroppable({ id: dropId });

  return (
    <div
      ref={setNodeRef}
      className={`min-w-0 min-h-[40px] p-1 flex flex-col gap-1 transition-colors ${
        isOver ? 'bg-[var(--brand-primary)]/15' : ''
      }`}
    >
      {tasks.map((task) => (
        <TaskChip key={task.record_id} task={task} onClick={onTaskClick} />
      ))}
    </div>
  );
}

function TaskChip({ task, onClick, isOverlay = false }) {
  const draggable = isTaskDraggable(task);

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.record_id,
    disabled: !draggable || isOverlay,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0 : 1,
  };

  return (
    <button
      ref={isOverlay ? undefined : setNodeRef}
      style={{ ...style, borderLeftColor: priorityColor(task.priority) }}
      {...(isOverlay ? {} : attributes)}
      {...(isOverlay ? {} : listeners)}
      onClick={(e) => {
        e.stopPropagation();
        if (!isDragging) onClick?.(task);
      }}
      className={`w-full max-w-full text-left px-1.5 py-1 rounded text-xs bg-[var(--bg-card)] border-l-2 transition-all overflow-hidden ${
        draggable && !isOverlay ? 'cursor-grab active:cursor-grabbing touch-none' : 'cursor-default'
      } ${isOverlay ? 'shadow-lg scale-105' : 'hover:brightness-95'}`}
    >
      <div className={`truncate ${task.is_completed ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}>
        {task.task_name}
      </div>
    </button>
  );
}

function GripIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="9" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" />
      <circle cx="15" cy="6" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="15" cy="18" r="1.5" />
    </svg>
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
