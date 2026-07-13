import { useState, useRef, useEffect } from 'react';
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
import CustomSelect from './CustomSelect';
import { createTaskManual } from '../api';
import { toLocalISODate } from '../utils/formatDate';
import { priorityColor } from '../utils/priorityColor';
import { getEventLabel } from '../utils/eventType';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = Array.from({ length: 16 }, (_, i) => i + 7); // 07:00-22:00
const GRID_TEMPLATE = 'grid grid-cols-[36px_repeat(7,minmax(0,1fr))] gap-1';

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
  return String(hour).padStart(2, '0');
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

export function CalendarView({ tasks, expandedTaskId, onToggleExpand, onTaskUpdate, onTaskDeleted, onShowToast, onTaskCreated }) {
  const { t } = useTranslation();

  const [viewMode, setViewMode] = useState('monthly'); // 'monthly' | 'weekly'

  const [currentMonth, setCurrentMonth] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [selectedDate, setSelectedDate] = useState(null);

  const [currentWeekStart, setCurrentWeekStart] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    d.setDate(d.getDate() - day);
    return d;
  });
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [activeDragTask, setActiveDragTask] = useState(null);
  const [manualCreateSlot, setManualCreateSlot] = useState(null); // { date, time }
  const taskDetailRef = useRef(null);

  useEffect(() => {
    if (selectedTaskId && taskDetailRef.current) {
      // Slight delay to let the render commit before scrolling
      const timer = setTimeout(() => {
        taskDetailRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [selectedTaskId]);

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

  function handleSelectDate(date) {
    if (date === null) {
      setSelectedDate(null);
      return;
    }
    setSelectedDate((prev) => (prev && toLocalISODate(prev) === toLocalISODate(date) ? null : date));
  }

  function handleTaskClick(task) {
    setSelectedTaskId((prev) => (prev === task.record_id ? null : task.record_id));
  }

  function handleEmptyCellClick(date, time) {
    setManualCreateSlot({ date, time });
  }

  async function handleManualCreate(payload) {
    const created = await createTaskManual(payload);
    onTaskCreated(created);
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
    if (task.is_completed) return acc;
    const key = task.due_date;
    if (!acc[key]) acc[key] = [];
    acc[key].push(task);
    return acc;
  }, {});

  const selectedISO = selectedDate ? toLocalISODate(selectedDate) : null;
  const selectedDayTasks = selectedISO
    ? (tasksByDate[selectedISO] || []).slice().sort((a, b) => statusRank(a) - statusRank(b))
    : [];

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
          <MonthlyGrid
            currentMonth={currentMonth}
            onPrevMonth={handlePrevMonth}
            onNextMonth={handleNextMonth}
            selectedDate={selectedDate}
            onSelectDate={handleSelectDate}
            tasksByDate={tasksByDate}
            todayISO={todayISO}
            t={t}
          />
        ) : (
          <>
            <WeeklyGrid
              currentWeekStart={currentWeekStart}
              onPrevWeek={handlePrevWeek}
              onNextWeek={handleNextWeek}
              tasks={tasks}
              todayISO={todayISO}
              onTaskClick={handleTaskClick}
              onSelectDate={handleSelectDate}
              onEmptyClick={handleEmptyCellClick}
              t={t}
            />

            {selectedTask && (
              <div ref={taskDetailRef} className="mt-6 scroll-mt-4">
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

        {selectedDate && (
          <DayDetailModal
            date={selectedDate}
            tasks={selectedDayTasks}
            expandedTaskId={expandedTaskId}
            onToggleExpand={onToggleExpand}
            onTaskUpdate={onTaskUpdate}
            onTaskDeleted={onTaskDeleted}
            onShowToast={onShowToast}
            onClose={() => handleSelectDate(null)}
            t={t}
          />
        )}

        {manualCreateSlot && (
          <ManualCreateModal
            date={manualCreateSlot.date}
            time={manualCreateSlot.time}
            onClose={() => setManualCreateSlot(null)}
            onCreate={handleManualCreate}
            t={t}
          />
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

function MonthlyGrid({
  currentMonth,
  onPrevMonth,
  onNextMonth,
  selectedDate,
  onSelectDate,
  tasksByDate,
  todayISO,
  t,
}) {
  const cells = getCalendarCells(currentMonth);
  const selectedISO = selectedDate ? toLocalISODate(selectedDate) : null;

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

function DayDetailModal({ date, tasks, expandedTaskId, onToggleExpand, onTaskUpdate, onTaskDeleted, onShowToast, onClose, t }) {
  const dayLabel = formatSelectedDayLabel(date);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full md:max-w-2xl bg-[var(--bg-card)] md:rounded-lg rounded-t-2xl shadow-[var(--shadow-modal)] flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-subtle)]">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            {dayLabel}
            <span className="ml-2 text-sm font-normal text-[var(--text-muted)]">
              ({tasks.length})
            </span>
          </h2>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-1 rounded"
            aria-label={t('calendar.close_day')}
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto p-4">
          {tasks.length > 0 ? (
            <div className="space-y-2">
              {tasks.map((task) => (
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
            <p className="text-sm text-[var(--text-muted)] italic">
              {t('empty.no_tasks')}
            </p>
          )}
        </div>
      </div>
    </div>
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

function WeeklyGrid({ currentWeekStart, onPrevWeek, onNextWeek, tasks, todayISO, onTaskClick, onSelectDate, onEmptyClick, t }) {
  const weekDays = getWeekDays(currentWeekStart);

  const tasksByCell = {};
  const allDayTasksByDate = {};
  for (const task of tasks) {
    if (!task.due_date) continue;
    if (task.is_rejected) continue;
    if (task.is_completed) continue;

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

      <div className="w-full">
        <div className="overflow-y-auto max-h-[calc(100vh-200px)]">
          <div className="sticky top-0 z-10 bg-[var(--bg-app)] pb-1">
            <div className={GRID_TEMPLATE}>
              <div className="w-9" />
              {weekDays.map((day) => {
                const dayISO = toLocalISODate(day);
                const todayCol = dayISO === todayISO;
                return (
                  <button
                    key={dayISO}
                    onClick={() => onSelectDate(day)}
                    className={`min-w-0 text-center text-xs font-medium hover:bg-[var(--bg-hover)] rounded p-1 transition-colors ${
                      todayCol ? 'text-[var(--brand-primary)] font-bold' : 'text-[var(--text-secondary)]'
                    }`}
                  >
                    <div className="uppercase">{weekdayShort(day)}</div>
                    <div className="text-sm mt-0.5">{day.getDate()}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className={`${GRID_TEMPLATE} mb-1 border-b border-[var(--border-subtle)] pb-2`}>
            <div className="text-xs text-[var(--text-muted)] pt-2 pr-1 text-right w-9">
              {t('calendar.all_day')}
            </div>
            {weekDays.map((day, dayIndex) => {
              const dayKey = toLocalISODate(day);
              return (
                <WeeklyAllDayCell
                  key={dayKey}
                  day={day}
                  dayIndex={dayIndex}
                  tasks={allDayTasksByDate[dayKey] || []}
                  onTaskClick={onTaskClick}
                  onEmptyClick={onEmptyClick}
                />
              );
            })}
          </div>

          <div className="relative">
            {HOURS.map((hour) => (
              <div key={hour} className={`${GRID_TEMPLATE} border-t border-[var(--border-subtle)]`}>
                <div className="text-xs text-[var(--text-muted)] pt-1 pr-1 text-right w-9">
                  {formatHour(hour)}
                </div>
                {weekDays.map((day, dayIndex) => {
                  const dayISO = toLocalISODate(day);
                  const cellKey = `${dayISO}-${hour}`;
                  return (
                    <WeeklyHourCell
                      key={cellKey}
                      day={day}
                      dayIndex={dayIndex}
                      hour={hour}
                      tasks={tasksByCell[cellKey] || []}
                      isTodayCol={dayISO === todayISO}
                      onTaskClick={onTaskClick}
                      onEmptyClick={onEmptyClick}
                    />
                  );
                })}
              </div>
            ))}

            {nowIndicator.show && (
              <div
                className="absolute left-9 right-0 h-0.5 bg-[var(--brand-primary)]"
                style={{ top: `${nowIndicator.topPercent}%` }}
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function WeeklyHourCell({ day, dayIndex, hour, tasks, isTodayCol, onTaskClick, onEmptyClick }) {
  const dropId = `cell:${toLocalISODate(day)}:${hour}`;
  const { isOver, setNodeRef } = useDroppable({ id: dropId });

  function handleCellClick(e) {
    if (e.target === e.currentTarget) {
      onEmptyClick(toLocalISODate(day), `${String(hour).padStart(2, '0')}:00`);
    }
  }

  const alternating = dayIndex % 2 === 1 ? 'bg-[var(--bg-day-alt)]' : 'bg-[var(--bg-card)]';
  const bgClass = isTodayCol ? 'bg-[var(--brand-primary)]/5' : alternating;

  return (
    <div
      ref={setNodeRef}
      onClick={handleCellClick}
      className={`
        min-w-0 min-h-[48px] p-0 flex flex-col gap-0.5 transition-colors cursor-pointer
        ${bgClass}
        ${isOver ? 'bg-[var(--brand-primary)]/15' : ''}
      `}
    >
      {tasks.map((task) => (
        <TaskChip key={task.record_id} task={task} onClick={onTaskClick} />
      ))}
    </div>
  );
}

function WeeklyAllDayCell({ day, dayIndex, tasks, onTaskClick, onEmptyClick }) {
  const dropId = `allday:${toLocalISODate(day)}`;
  const { isOver, setNodeRef } = useDroppable({ id: dropId });

  function handleCellClick(e) {
    if (e.target === e.currentTarget) {
      onEmptyClick(toLocalISODate(day), null);
    }
  }

  const alternating = dayIndex % 2 === 1 ? 'bg-[var(--bg-day-alt)]' : 'bg-[var(--bg-card)]';

  return (
    <div
      ref={setNodeRef}
      onClick={handleCellClick}
      className={`min-w-0 min-h-[40px] p-0 flex flex-col gap-0.5 transition-colors cursor-pointer ${alternating} ${
        isOver ? 'bg-[var(--brand-primary)]/15' : ''
      }`}
    >
      {tasks.map((task) => (
        <TaskChip key={task.record_id} task={task} onClick={onTaskClick} />
      ))}
    </div>
  );
}

function chipColors(priority) {
  switch (priority) {
    case 'P1':
      return { bg: 'var(--priority-p1-bg)', text: 'var(--priority-p1-text)' };
    case 'P2':
      return { bg: 'var(--priority-p2-bg)', text: 'var(--priority-p2-text)' };
    case 'P3':
      return { bg: 'var(--priority-p3-bg)', text: 'var(--priority-p3-text)' };
    default:
      return { bg: 'var(--priority-p3-bg)', text: 'var(--priority-p3-text)' };
  }
}

function TaskChip({ task, onClick, isOverlay = false }) {
  const draggable = isTaskDraggable(task);
  const label = getEventLabel(task.task_name);
  const { bg, text } = chipColors(task.priority);

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
      style={{ ...style, backgroundColor: bg, color: text }}
      {...(isOverlay ? {} : attributes)}
      {...(isOverlay ? {} : listeners)}
      onClick={(e) => {
        e.stopPropagation();
        if (!isDragging) onClick?.(task);
      }}
      className={`w-full flex-1 min-h-0 flex items-center text-left px-2 py-1 rounded text-xs transition-all overflow-hidden ${
        draggable && !isOverlay ? 'cursor-grab active:cursor-grabbing touch-none' : 'cursor-default'
      } ${isOverlay ? 'shadow-lg scale-105' : 'hover:brightness-95'}`}
    >
      <div className={`w-full min-w-0 truncate leading-tight font-medium ${task.is_completed ? 'line-through opacity-60' : ''}`}>
        {label}
      </div>
    </button>
  );
}

function ManualCreateModal({ date, time, onClose, onCreate, t }) {
  const [taskName, setTaskName] = useState('');
  const [priority, setPriority] = useState('P3');
  const [category, setCategory] = useState('Unknown');
  const [description, setDescription] = useState('');
  const [checklist, setChecklist] = useState([]);
  const [newChecklistItem, setNewChecklistItem] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  const displayDate = new Date(`${date}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const displayTime = time || t('modal.all_day');

  const priorityOptions = [
    { value: 'P1', label: 'P1' },
    { value: 'P2', label: 'P2' },
    { value: 'P3', label: 'P3' },
  ];

  const categoryOptions = [
    { value: 'Business', label: t('browse.filter_business') },
    { value: 'Personal', label: t('browse.filter_personal') },
    { value: 'Unknown', label: t('browse.filter_unknown') },
  ];

  async function handleSave() {
    if (!taskName.trim()) return;
    setIsSaving(true);
    setError(null);
    try {
      await onCreate({
        task_name: taskName.trim(),
        description: description.trim(),
        category,
        priority,
        due_date: date,
        due_time: time,
        checklist: checklist.map((text) => ({ text, done: false })),
      });
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  }

  function addChecklistItem() {
    if (newChecklistItem.trim()) {
      setChecklist((prev) => [...prev, newChecklistItem.trim()]);
      setNewChecklistItem('');
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full md:max-w-md bg-[var(--bg-modal)] md:rounded-lg rounded-t-2xl shadow-[var(--shadow-modal)] p-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            {t('modal.new_task')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1 rounded"
            aria-label={t('actions.cancel')}
          >
            ✕
          </button>
        </div>

        <div className="text-sm text-[var(--text-secondary)] mb-3">
          {displayDate} • {displayTime}
        </div>

        <input
          autoFocus
          type="text"
          value={taskName}
          onChange={(e) => setTaskName(e.target.value)}
          placeholder={t('task.name_placeholder')}
          className="w-full px-3 py-2 rounded-md bg-[var(--bg-input)] border border-[var(--border-medium)] text-sm font-medium text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-focus)] focus:ring-2 focus:ring-blue-100 transition-colors"
        />

        <div className="grid grid-cols-2 gap-2 mt-3">
          <CustomSelect
            value={priority}
            options={priorityOptions}
            onChange={setPriority}
            ariaLabel={t('task.priority_label')}
          />
          <CustomSelect
            value={category}
            options={categoryOptions}
            onChange={setCategory}
            ariaLabel={t('task.category_label')}
          />
        </div>

        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('modal.description_placeholder')}
          rows={2}
          className="w-full px-3 py-2 rounded-md bg-[var(--bg-input)] border border-[var(--border-medium)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-focus)] focus:ring-2 focus:ring-blue-100 resize-none transition-colors mt-3"
        />

        <div className="mt-3">
          <div className="text-xs font-medium text-[var(--text-secondary)] mb-1">
            {t('task.checklist_label')}
          </div>
          {checklist.map((item, idx) => (
            <div key={idx} className="flex items-center gap-2 text-sm py-1">
              <span className="flex-1 text-[var(--text-primary)]">{item}</span>
              <button
                type="button"
                onClick={() => setChecklist((prev) => prev.filter((_, i) => i !== idx))}
                className="text-[var(--text-muted)] hover:text-[var(--danger)]"
                title={t('task.remove_item')}
              >
                ✕
              </button>
            </div>
          ))}
          <div className="flex gap-2 mt-1">
            <input
              type="text"
              value={newChecklistItem}
              onChange={(e) => setNewChecklistItem(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addChecklistItem();
                }
              }}
              placeholder={t('modal.add_checklist_item')}
              className="flex-1 px-3 py-1.5 rounded-md bg-[var(--bg-input)] border border-[var(--border-medium)] text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-focus)] focus:ring-2 focus:ring-blue-100 transition-colors"
            />
            <button
              type="button"
              onClick={addChecklistItem}
              className="px-3 py-2 rounded-md bg-[var(--bg-hover)] text-[var(--text-primary)] text-sm"
            >
              +
            </button>
          </div>
        </div>

        {error && (
          <p className="text-sm text-[var(--danger)] mt-2">{error}</p>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)]"
          >
            {t('actions.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!taskName.trim() || isSaving}
            className="px-4 py-2 rounded-md bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSaving ? t('actions.saving') : t('actions.save')}
          </button>
        </div>
      </div>
    </div>
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
