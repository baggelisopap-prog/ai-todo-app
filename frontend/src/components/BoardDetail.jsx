import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
} from '@dnd-kit/core';
import { useBoards } from '../hooks/useBoards';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { useMembers } from '../hooks/useMembers';
import { useConfirm } from '../hooks/useConfirm';
import { useAppSettings } from '../hooks/useAppSettings';
import { layoutBoard, columnFor } from '../utils/boards';
import { formatDate } from '../utils/formatDate';
import { dueTone, DUE_TONE_CLASSES, checklistProgress } from '../utils/taskDisplay';
import { priorityColor } from '../utils/priorityColor';
import { effectiveAssignee } from '../utils/assignment';
import { UNFILED } from '../utils/workspaces';
import KebabMenu from './KebabMenu';
import OptionSheet from './OptionSheet';
import DropDialog from './DropDialog';
import NameDialog from './NameDialog';
import ConfirmDialog from './ConfirmDialog';
import TaskDetailSheet from './TaskDetailSheet';
import BoardColumnsSheet from './BoardColumnsSheet';
import BoardActivityPanel from './BoardActivityPanel';
import Avatar from './Avatar';

/**
 * One board: its columns side by side, cards dragged between them (2026-09-26).
 *
 * WHAT A DROP MEANS depends on the column, and it is the owner's rule: a card
 * dropped on «Έγινε» COMPLETES the task everywhere, on «Ακυρώθηκε» it asks the
 * optional «Γιατί;» and calls it off, and on any other column it is simply
 * placed there (reopening it first if it was finished). The server does the
 * meaning (boards.move_card); this screen only asks.
 *
 * THE CARD IS THE TASK. Nothing here stores done-ness: utils/boards.layoutBoard
 * reads it off the task, so ticking the task in Today moves the card here with
 * nobody touching the board.
 *
 * ON A PHONE: columns scroll sideways, one screen-width-ish each, snapping.
 * A card is picked up by PRESS-AND-HOLD (a quarter second) so that an ordinary
 * swipe still scrolls; and every card also has «Μετακίνηση σε…» in its ⋯ menu,
 * because a drag across a sideways-scrolling strip is the least exact gesture
 * on a small screen. MouseSensor + TouchSensor rather than the calendar's
 * PointerSensor: a pointer sensor that starts at 5px of movement would take the
 * sideways scroll away from a thumb.
 *
 * A move shows at once (an optimistic override) and settles when the server
 * answers; a failure puts the card back and the provider says why.
 */

const DND_SENSOR_TOUCH = { delay: 250, tolerance: 8 };
const DND_SENSOR_MOUSE = { distance: 5 };

function CardBody({ task, column, isSharedRoom, assignee, t }) {
  const progress = checklistProgress(task.checklist);
  const tone = dueTone(task);
  const finished = column?.kind === 'done';
  const dropped = column?.kind === 'dropped';
  return (
    <div
      className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] shadow-sm pl-2.5 pr-7 py-2"
      style={{ borderLeft: `3px solid ${priorityColor(task.priority)}` }}
    >
      <p className={`text-sm leading-snug break-words line-clamp-3 ${
        finished ? 'line-through text-[var(--text-muted)]' : dropped ? 'text-[var(--text-muted)]' : 'text-[var(--text-primary)]'
      }`}>
        {task.task_name}
      </p>
      {dropped && task.drop_reason && (
        <p className="mt-0.5 text-xs italic text-[var(--text-muted)] break-words line-clamp-2">«{task.drop_reason}»</p>
      )}
      <div className="mt-1.5 flex items-center gap-2 text-xs">
        {task.due_date && (
          <span className={`tabular-nums ${finished || dropped ? 'text-[var(--text-muted)]' : DUE_TONE_CLASSES[tone]}`}>
            {formatDate(task.due_date, task.due_time)}
          </span>
        )}
        {progress && (
          <span className="tabular-nums text-[var(--text-muted)]" aria-label={t('boards.checklist_progress', progress)}>
            ☑ {progress.done}/{progress.total}
          </span>
        )}
        <span className="flex-1" />
        {isSharedRoom && assignee.userId && (
          <Avatar member={assignee.member} userId={assignee.userId} size="xs" unknownLabel={t('members.former_member')} />
        )}
      </div>
    </div>
  );
}

function DraggableCard({ task, column, onOpen, onMoveRequest, onRemove, cardProps, t }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.record_id });
  return (
    <li
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      // The original stays in place, faded, while the overlay follows the
      // finger: a card that vanishes under your thumb reads as a deletion.
      className={`relative group ${isDragging ? 'opacity-40' : ''}`}
      onClick={(e) => {
        if (e.target.closest('[data-no-toggle]')) return;
        onOpen(task.record_id);
      }}
    >
      <CardBody task={task} column={column} {...cardProps} t={t} />
      <span className="absolute top-1 right-1" data-no-toggle>
        <KebabMenu
          ariaLabel={t('menu.open_menu')}
          items={[
            { key: 'move', label: t('boards.move_to'), onClick: () => onMoveRequest(task.record_id) },
            { key: 'remove', label: t('boards.remove_card'), onClick: () => onRemove(task.record_id), separator: true },
          ]}
        />
      </span>
    </li>
  );
}

function Lane({ lane, count, isOlderOpen, onToggleOlder, renderCard, onCreateCard, t }) {
  const { column } = lane;
  const { setNodeRef, isOver } = useDroppable({ id: column.record_id });
  const [draft, setDraft] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const isOpen = column.kind === 'open';

  async function submit(e) {
    e.preventDefault();
    const name = (draft || '').trim();
    if (!name || isSaving) return;
    setIsSaving(true);
    try {
      await onCreateCard(column.record_id, name);
      setDraft('');
    } catch {
      // The provider has said why; the draft stays typed.
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section
      ref={setNodeRef}
      aria-label={column.name}
      className={`snap-start flex-shrink-0 w-[82vw] max-w-[300px] md:w-72 rounded-xl p-2 flex flex-col transition-colors ${
        isOver ? 'bg-[var(--bg-hover)] ring-2 ring-[color:var(--ring-soft)]' : 'bg-[var(--bg-day-alt)]'
      }`}
    >
      <header className="flex items-center gap-1.5 px-1 pb-2">
        {column.kind === 'done' && <span aria-hidden="true" className="text-[var(--priority-p3)]">✓</span>}
        {column.kind === 'dropped' && <span aria-hidden="true" className="text-[var(--text-muted)]">⊘</span>}
        <h3 className="text-sm font-semibold text-[var(--text-primary)] truncate">{column.name}</h3>
        <span className="text-xs tabular-nums text-[var(--text-muted)]">{count}</span>
      </header>

      <ul className="flex flex-col gap-2 min-h-[48px]">
        {lane.cards.map(({ card, task }) => renderCard(card, task, column))}
      </ul>

      {!isOpen && lane.older.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={onToggleOlder}
            aria-expanded={isOlderOpen}
            className="w-full text-left px-1 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            {isOlderOpen ? '▾' : '▸'} {t('boards.older', { count: lane.older.length })}
          </button>
          {isOlderOpen && (
            <ul className="flex flex-col gap-2 mt-1">
              {lane.older.map(({ card, task }) => renderCard(card, task, column))}
            </ul>
          )}
        </div>
      )}

      {isOpen && (
        draft === null ? (
          <button
            type="button"
            onClick={() => setDraft('')}
            className="mt-2 w-full text-left px-2 py-2 rounded-md text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            + {t('boards.new_card')}
          </button>
        ) : (
          <form onSubmit={submit} className="mt-2 flex flex-col gap-1.5">
            <textarea
              autoFocus
              rows={2}
              value={draft}
              maxLength={80}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) submit(e);
                if (e.key === 'Escape') setDraft(null);
              }}
              placeholder={t('boards.new_card_placeholder')}
              aria-label={t('boards.new_card')}
              className="w-full resize-none rounded-lg border border-[var(--border-medium)] bg-[var(--bg-card)] px-2.5 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--brand-primary)]"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={isSaving || !draft.trim()}
                className="tap-44 px-3 py-1.5 rounded-md text-sm font-medium text-white bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] disabled:opacity-50"
              >
                {isSaving ? t('actions.adding') : t('actions.add')}
              </button>
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="tap-44 px-3 py-1.5 rounded-md text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                {t('actions.cancel')}
              </button>
            </div>
          </form>
        )
      )}
    </section>
  );
}

function BoardDetail({ board, tasks, onTaskUpdate, onTaskDeleted, onShowToast, onTaskAcknowledged, onBoardDeleted }) {
  const { t } = useTranslation();
  const { rename, remove, moveCard, removeCard, createCard } = useBoards();
  const { activeId } = useWorkspaces();
  const { settings } = useAppSettings();
  const { isShared, personFor } = useMembers();
  const confirm = useConfirm();

  const [openTaskId, setOpenTaskId] = useState(null);
  const [movingTaskId, setMovingTaskId] = useState(null);
  const [pendingDrop, setPendingDrop] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const [olderOpen, setOlderOpen] = useState({});
  const [dialog, setDialog] = useState(null); // 'rename' | 'columns' | 'history'
  // taskId -> column, while a move is on its way to the server.
  const [optimistic, setOptimistic] = useState({});

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: DND_SENSOR_MOUSE }),
    useSensor(TouchSensor, { activationConstraint: DND_SENSOR_TOUCH }),
  );

  const tasksById = useMemo(() => {
    const map = {};
    for (const task of tasks) map[task.record_id] = task;
    return map;
  }, [tasks]);

  // The board as it will be once the pending moves land: the card's open
  // column and the task's done-ness, overridden for just those cards.
  const lanes = useMemo(() => {
    const ids = Object.keys(optimistic);
    if (!ids.length) return layoutBoard(board, tasksById);
    const now = new Date().toISOString();
    const shadowTasks = { ...tasksById };
    const cards = board.cards.map((card) => {
      const target = optimistic[card.task_id];
      const task = tasksById[card.task_id];
      if (!target || !task) return card;
      if (target.kind === 'done') {
        shadowTasks[card.task_id] = { ...task, is_completed: true, completed_at: now, dropped_at: null };
        return card;
      }
      if (target.kind === 'dropped') {
        shadowTasks[card.task_id] = { ...task, is_completed: false, dropped_at: now };
        return card;
      }
      shadowTasks[card.task_id] = { ...task, is_completed: false, dropped_at: null };
      // Last in its new column, which is where the server will put it too.
      return { ...card, column_id: target.record_id, position: Number.MAX_SAFE_INTEGER };
    });
    return layoutBoard({ ...board, cards }, shadowTasks);
  }, [board, tasksById, optimistic]);

  // Where a new card goes: the room the user is standing in, else the default
  // room the extractor also falls back to — never a guess of our own.
  const newCardWorkspace = activeId && activeId !== UNFILED ? activeId : settings?.default_workspace_id || null;

  function cardProps(task) {
    const assigneeId = effectiveAssignee(task);
    return {
      isSharedRoom: Boolean(task.workspace_id && isShared(task.workspace_id)),
      assignee: { userId: assigneeId, member: assigneeId ? personFor(task.workspace_id, assigneeId) : null },
    };
  }

  async function move(taskId, column, reason) {
    setOptimistic((current) => ({ ...current, [taskId]: column }));
    try {
      await moveCard(board.record_id, taskId, column.record_id, reason);
      if (column.kind === 'done') onShowToast?.('toast.completed', 'success');
      if (column.kind === 'dropped') onShowToast?.('toast.dropped', 'success');
    } catch {
      // The provider has said why; dropping the override puts the card back.
    } finally {
      setOptimistic((current) => {
        const next = { ...current };
        delete next[taskId];
        return next;
      });
    }
  }

  function requestMove(taskId, columnId) {
    const column = board.columns.find((c) => c.record_id === columnId);
    const card = board.cards.find((c) => c.task_id === taskId);
    const task = tasksById[taskId];
    if (!column || !card || !task) return;
    if (columnFor(task, card, board.columns)?.record_id === columnId) return;
    // «Ακυρώθηκε» asks «Γιατί;» first — optional, one tap to skip.
    if (column.kind === 'dropped') {
      setPendingDrop({ taskId, column });
      return;
    }
    move(taskId, column);
  }

  function handleDragEnd({ active, over }) {
    setDraggingId(null);
    if (over) requestMove(active.id, over.id);
  }

  async function handleRemove(taskId) {
    const task = tasksById[taskId];
    try {
      await removeCard(board.record_id, taskId);
      onShowToast?.({ message: t('boards.removed_toast', { board: board.name }), variant: 'success' });
    } catch {
      // Said by the provider.
    }
    if (openTaskId === taskId && !task) setOpenTaskId(null);
  }

  async function handleDeleteBoard() {
    const ok = await confirm.ask({
      title: t('boards.delete_title', { name: board.name }),
      body: t('boards.delete_body'),
      confirmLabel: t('actions.delete'),
    });
    if (!ok) return;
    try {
      await remove(board.record_id);
      onBoardDeleted?.();
    } catch {
      // Said by the provider.
    }
  }

  const renderCard = (card, task, column) => (
    <DraggableCard
      key={task.record_id}
      task={task}
      column={column}
      cardProps={cardProps(task)}
      onOpen={setOpenTaskId}
      onMoveRequest={setMovingTaskId}
      onRemove={handleRemove}
      t={t}
    />
  );

  const dragging = draggingId ? tasksById[draggingId] : null;
  const openTask = openTaskId ? tasksById[openTaskId] : null;
  const movingTask = movingTaskId ? tasksById[movingTaskId] : null;
  const movingCard = movingTaskId ? board.cards.find((c) => c.task_id === movingTaskId) : null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3 px-1">
        <h2 className="text-lg font-semibold text-[var(--text-primary)] truncate flex-1">{board.name}</h2>
        <KebabMenu
          ariaLabel={t('boards.board_menu')}
          items={[
            { key: 'rename', label: t('boards.rename'), onClick: () => setDialog('rename') },
            { key: 'columns', label: t('boards.columns_title'), onClick: () => setDialog('columns') },
            { key: 'history', label: t('boards.history'), onClick: () => setDialog('history') },
            { key: 'delete', label: t('boards.delete'), onClick: handleDeleteBoard, danger: true, separator: true },
          ]}
        />
      </div>

      <DndContext
        sensors={sensors}
        onDragStart={({ active }) => setDraggingId(active.id)}
        onDragCancel={() => setDraggingId(null)}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-4 -mx-4 px-4 md:mx-0 md:px-0">
          {lanes.map((lane) => (
            <Lane
              key={lane.column.record_id}
              lane={lane}
              count={lane.cards.length + lane.older.length}
              isOlderOpen={Boolean(olderOpen[lane.column.record_id])}
              onToggleOlder={() => setOlderOpen((o) => ({ ...o, [lane.column.record_id]: !o[lane.column.record_id] }))}
              renderCard={renderCard}
              onCreateCard={(columnId, name) => createCard(board.record_id, columnId, name, newCardWorkspace)}
              t={t}
            />
          ))}
        </div>
        <DragOverlay>
          {dragging ? (
            <div className="rotate-2 w-[78vw] max-w-[284px] md:w-[272px]">
              <CardBody task={dragging} column={null} {...cardProps(dragging)} t={t} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <p className="px-1 text-xs text-[var(--text-muted)]">{t('boards.drag_hint')}</p>

      {openTask && (
        <TaskDetailSheet
          task={openTask}
          onClose={() => setOpenTaskId(null)}
          onUpdate={onTaskUpdate}
          onTaskDeleted={(id) => { onTaskDeleted?.(id); setOpenTaskId(null); }}
          onShowToast={onShowToast}
          onAcknowledged={onTaskAcknowledged}
        />
      )}

      {movingTask && movingCard && (
        <OptionSheet
          title={t('boards.move_to')}
          value={columnFor(movingTask, movingCard, board.columns)?.record_id}
          options={lanes.map((lane) => ({ value: lane.column.record_id, label: lane.column.name }))}
          onPick={(columnId) => { setMovingTaskId(null); requestMove(movingTask.record_id, columnId); }}
          onClose={() => setMovingTaskId(null)}
        />
      )}

      {pendingDrop && (
        <DropDialog
          taskName={tasksById[pendingDrop.taskId]?.task_name || ''}
          onConfirm={(reason) => move(pendingDrop.taskId, pendingDrop.column, reason)}
          onClose={() => setPendingDrop(null)}
        />
      )}

      {dialog === 'rename' && (
        <NameDialog
          title={t('boards.rename')}
          initial={board.name}
          onSave={(name) => rename(board.record_id, name)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'columns' && <BoardColumnsSheet board={board} onClose={() => setDialog(null)} />}
      {dialog === 'history' && <BoardActivityPanel board={board} onClose={() => setDialog(null)} />}
      <ConfirmDialog request={confirm.request} onAnswer={confirm.onAnswer} />
    </div>
  );
}

export default BoardDetail;
