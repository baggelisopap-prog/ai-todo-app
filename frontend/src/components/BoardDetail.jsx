import { useEffect, useMemo, useRef, useState } from 'react';
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
import { useAppSettings } from '../hooks/useAppSettings';
import { useMediaQuery, DESKTOP_QUERY } from '../hooks/useMediaQuery';
import { layoutBoard, columnFor, nextStepColumn, swipeColumnIndex } from '../utils/boards';
import { formatDate } from '../utils/formatDate';
import { dueTone, DUE_TONE_CLASSES, checklistProgress, effectiveStart } from '../utils/taskDisplay';
import { priorityColor } from '../utils/priorityColor';
import { effectiveAssignee } from '../utils/assignment';
import { UNFILED } from '../utils/workspaces';
import KebabMenu from './KebabMenu';
import DropDialog from './DropDialog';
import TaskDetailSheet from './TaskDetailSheet';
import BoardMoveSheet from './BoardMoveSheet';
import Avatar from './Avatar';
import { PlusIcon } from './icons';

/**
 * One board's cards (2026-09-26; reshaped 2026-09-29 after the owner saw it).
 *
 * WHAT A MOVE MEANS depends on the column, and it is the owner's rule: into
 * «Έγινε» the task is COMPLETED everywhere, into «Ακυρώθηκε» it asks the
 * optional «Γιατί;» and calls it off, into any other column it is simply placed
 * there (reopening it first if it was finished). The server does the meaning
 * (boards.move_card); this screen only asks.
 *
 * THE CARD IS THE TASK. Nothing here stores done-ness: utils/boards.layoutBoard
 * reads it off the task, so ticking the task in Today moves the card here with
 * nobody touching the board.
 *
 * TWO SHAPES, the owner's choice from the mockups (proposal 2, «μία στήλη τη
 * φορά»):
 *   - a PHONE shows one column at a time, full width, so a card reads like a
 *     row of Today instead of a name broken over three lines. The columns are
 *     chips across the top with their counts; a sideways swipe changes column.
 *     Each card has a «next step» button, and press-and-hold opens
 *     «Μετακίνηση». There is no drag on a phone — it was the least exact
 *     gesture on a small screen, and on an iPhone the hold grabbed the text.
 *   - a COMPUTER keeps the columns side by side and drags between them.
 *
 * A move shows at once (an optimistic override) and settles when the server
 * answers; a failure puts the card back and the provider says why. Every move
 * says where the card went, with «Αναίρεση» — on a phone the card leaves the
 * column you are looking at, and a card vanishing without a word reads as lost.
 */

const DND_SENSOR_TOUCH = { delay: 250, tolerance: 8 };
const DND_SENSOR_MOUSE = { distance: 5 };

// Press-and-hold on a phone card: long enough that a tap and the start of a
// scroll are never mistaken for it, and a thumb that moves more than a few
// pixels is scrolling, not holding.
const HOLD_MS = 450;
const HOLD_TOLERANCE_PX = 8;

// Which column each board last showed on a phone, for the life of the page —
// leaving «Όλα» for Today and coming back lands on the same column.
const lastColumnByBoard = new Map();

function CardMeta({ task, column, isSharedRoom, assignee, t }) {
  const progress = checklistProgress(task.checklist);
  const tone = dueTone(task);
  const ended = column?.kind === 'done' || column?.kind === 'dropped';
  return (
    <div className="mt-1.5 flex items-center gap-2 text-xs">
      {task.due_date && (
        <span className={`tabular-nums ${ended ? 'text-[var(--text-muted)]' : DUE_TONE_CLASSES[tone]}`}>
          {/* «από → έως» when there is a start, as on the list row. */}
          {effectiveStart(task) ? `${formatDate(effectiveStart(task))} → ` : ''}
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
  );
}

function CardName({ task, column, className }) {
  const finished = column?.kind === 'done';
  const dropped = column?.kind === 'dropped';
  return (
    <>
      <p className={`${className} break-words ${
        finished ? 'line-through text-[var(--text-muted)]' : dropped ? 'text-[var(--text-muted)]' : 'text-[var(--text-primary)]'
      }`}>
        {task.task_name}
      </p>
      {dropped && task.drop_reason && (
        <p className="mt-0.5 text-xs italic text-[var(--text-muted)] break-words line-clamp-2">«{task.drop_reason}»</p>
      )}
    </>
  );
}

// ------------------------------------------------------------------ computer

function CardBody({ task, column, isSharedRoom, assignee, t }) {
  return (
    <div
      className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] shadow-sm pl-2.5 pr-7 py-2"
      style={{ borderLeft: `3px solid ${priorityColor(task.priority)}` }}
    >
      <CardName task={task} column={column} className="text-sm leading-snug line-clamp-3" />
      <CardMeta task={task} column={column} isSharedRoom={isSharedRoom} assignee={assignee} t={t} />
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
      // pointer: a card that vanishes under the cursor reads as a deletion.
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

function NewCardForm({ onCreate, onCancel, t }) {
  const [draft, setDraft] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const name = draft.trim();
    if (!name || isSaving) return;
    setIsSaving(true);
    try {
      await onCreate(name);
      setDraft('');
    } catch {
      // The provider has said why; the draft stays typed.
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-2 flex flex-col gap-1.5">
      <textarea
        autoFocus
        rows={2}
        value={draft}
        maxLength={80}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) submit(e);
          if (e.key === 'Escape') onCancel();
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
          onClick={onCancel}
          className="tap-44 px-3 py-1.5 rounded-md text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
        >
          {t('actions.cancel')}
        </button>
      </div>
    </form>
  );
}

function OlderToggle({ lane, isOpen, onToggle, renderCard, t }) {
  if (lane.column.kind === 'open' || lane.older.length === 0) return null;
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="w-full text-left px-1 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      >
        {isOpen ? '▾' : '▸'} {t('boards.older', { count: lane.older.length })}
      </button>
      {isOpen && (
        <ul className="flex flex-col gap-2 mt-1">
          {lane.older.map(({ card, task }) => renderCard(card, task, lane.column))}
        </ul>
      )}
    </div>
  );
}

function Lane({ lane, count, isOlderOpen, onToggleOlder, renderCard, onCreateCard, t }) {
  const { column } = lane;
  const { setNodeRef, isOver } = useDroppable({ id: column.record_id });
  const [isAdding, setIsAdding] = useState(false);

  return (
    <section
      ref={setNodeRef}
      aria-label={column.name}
      className={`flex-shrink-0 w-72 rounded-xl p-2 flex flex-col transition-colors ${
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

      <OlderToggle lane={lane} isOpen={isOlderOpen} onToggle={onToggleOlder} renderCard={renderCard} t={t} />

      {column.kind === 'open' && (
        isAdding ? (
          <NewCardForm onCreate={(name) => onCreateCard(column.record_id, name)} onCancel={() => setIsAdding(false)} t={t} />
        ) : (
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            className="mt-2 w-full text-left px-2 py-2 rounded-md text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            + {t('boards.new_card')}
          </button>
        )
      )}
    </section>
  );
}

// --------------------------------------------------------------------- phone

/**
 * A card on a phone: full width, with its «next step» on the right. A tap
 * opens the task; press-and-hold opens «Μετακίνηση». select-none and no
 * callout, so the hold is never taken by the iPhone's text magnifier.
 */
function WideCard({ task, column, nextColumn, onOpen, onHold, onNext, cardProps, t }) {
  const hold = useRef(null);
  const held = useRef(false);

  function start(e) {
    if (e.target.closest('[data-no-toggle]')) return;
    held.current = false;
    const { clientX: x, clientY: y } = e;
    hold.current = {
      x,
      y,
      timer: setTimeout(() => {
        held.current = true;
        hold.current = null;
        onHold(task.record_id);
      }, HOLD_MS),
    };
  }

  function cancel() {
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = null;
  }

  function moveCheck(e) {
    const h = hold.current;
    if (h && (Math.abs(e.clientX - h.x) > HOLD_TOLERANCE_PX || Math.abs(e.clientY - h.y) > HOLD_TOLERANCE_PX)) cancel();
  }

  useEffect(() => cancel, []);

  return (
    <li
      onPointerDown={start}
      onPointerMove={moveCheck}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => {
        if (held.current) { held.current = false; return; }
        if (e.target.closest('[data-no-toggle]')) return;
        onOpen(task.record_id);
      }}
      style={{ borderLeft: `3px solid ${priorityColor(task.priority)}`, WebkitTouchCallout: 'none' }}
      className="select-none flex items-center gap-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] shadow-[var(--shadow-card)] py-2.5 pl-3 pr-2.5 cursor-default"
    >
      <div className="flex-1 min-w-0">
        <CardName task={task} column={column} className="text-[15px] leading-snug font-medium" />
        <CardMeta task={task} column={column} {...cardProps} t={t} />
      </div>
      {nextColumn && (
        <button
          type="button"
          data-no-toggle
          onClick={() => onNext(task.record_id, nextColumn)}
          className={`flex-shrink-0 inline-flex items-center gap-1 min-h-8 px-2.5 py-1.5 rounded-full border text-[12.5px] font-semibold whitespace-nowrap ${
            nextColumn.kind === 'done'
              ? 'border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success-text)]'
              : 'border-[var(--border-medium)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
          }`}
        >
          {nextColumn.kind === 'done' ? `✓ ${nextColumn.name}` : `→ ${nextColumn.name}`}
        </button>
      )}
    </li>
  );
}

function PhoneBoard({ board, lanes, onOpen, onHold, onNext, onCreateCard, cardProps, t }) {
  const [index, setIndex] = useState(() => {
    const remembered = lastColumnByBoard.get(board.record_id);
    const found = lanes.findIndex((l) => l.column.record_id === remembered);
    return found >= 0 ? found : 0;
  });
  const [olderOpen, setOlderOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const swipe = useRef(null);
  const chipRefs = useRef({});

  const safeIndex = Math.min(index, lanes.length - 1);
  const lane = lanes[safeIndex];

  function show(next) {
    setIndex(next);
    setOlderOpen(false);
    setIsAdding(false);
    lastColumnByBoard.set(board.record_id, lanes[next]?.column.record_id);
  }

  // Keep the chosen chip in view when a swipe moved past the edge of the strip.
  useEffect(() => {
    chipRefs.current[lane?.column.record_id]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [lane?.column.record_id]);

  // The red + on a board page writes a card here, in the column you are
  // looking at — or the first open one, if you are looking at an ending.
  function startAdding() {
    if (lane.column.kind !== 'open') {
      const firstOpen = lanes.findIndex((l) => l.column.kind === 'open');
      if (firstOpen >= 0) show(firstOpen);
    }
    setIsAdding(true);
  }

  if (!lane) return null;
  const renderWide = (card, task, column) => (
    <WideCard
      key={task.record_id}
      task={task}
      column={column}
      nextColumn={nextStepColumn(board.columns, column.record_id)}
      onOpen={onOpen}
      onHold={onHold}
      onNext={onNext}
      cardProps={cardProps(task)}
      t={t}
    />
  );

  return (
    <div>
      {/* The columns as chips, stuck under the board's own bar (h-14 + its
          2px rule = 58px) so you always know where you are and how many
          cards each column holds. */}
      <div
        role="tablist"
        aria-label={t('boards.columns_title')}
        className="sticky top-[58px] z-20 -mx-4 px-4 py-2.5 flex gap-1.5 overflow-x-auto bg-[var(--bg-card)] border-b border-[var(--border-subtle)]"
      >
        {lanes.map((l, i) => {
          const isActive = i === safeIndex;
          return (
            <button
              key={l.column.record_id}
              ref={(el) => { chipRefs.current[l.column.record_id] = el; }}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => show(i)}
              className={`flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition-colors ${
                isActive
                  ? 'bg-[var(--brand-primary)] border-[var(--brand-primary)] text-white font-medium'
                  : 'bg-[var(--bg-card)] border-[var(--border-medium)] text-[var(--text-secondary)]'
              }`}
            >
              {l.column.kind === 'done' && <span aria-hidden="true">✓</span>}
              {l.column.kind === 'dropped' && <span aria-hidden="true">⊘</span>}
              {l.column.name}
              <span className={`text-xs font-semibold tabular-nums ${isActive ? 'text-white/85' : 'text-[var(--text-muted)]'}`}>
                {l.cards.length + l.older.length}
              </span>
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        aria-label={lane.column.name}
        className="pt-4 min-h-[50vh] touch-pan-y"
        onTouchStart={(e) => {
          const touch = e.touches[0];
          swipe.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
        }}
        onTouchEnd={(e) => {
          const from = swipe.current;
          const touch = e.changedTouches[0];
          swipe.current = null;
          if (!from || !touch) return;
          const next = swipeColumnIndex(safeIndex, touch.clientX - from.x, touch.clientY - from.y, lanes.length);
          if (next !== safeIndex) show(next);
        }}
      >
        <ul className="flex flex-col gap-2">
          {lane.cards.map(({ card, task }) => renderWide(card, task, lane.column))}
        </ul>

        {lane.cards.length === 0 && lane.older.length === 0 && (
          <p className="py-6 text-center text-xs text-[var(--text-muted)]">{t('boards.column_empty')}</p>
        )}

        <OlderToggle lane={lane} isOpen={olderOpen} onToggle={() => setOlderOpen((o) => !o)} renderCard={renderWide} t={t} />

        {lane.column.kind === 'open' && (
          isAdding ? (
            <NewCardForm
              onCreate={(name) => onCreateCard(lane.column.record_id, name)}
              onCancel={() => setIsAdding(false)}
              t={t}
            />
          ) : (
            <button
              type="button"
              onClick={() => setIsAdding(true)}
              className="mt-2.5 w-full text-left px-3 py-2.5 rounded-lg border border-dashed border-[var(--border-medium)] text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            >
              + {t('boards.new_card')}
            </button>
          )
        )}

        <p className="mt-3.5 text-center text-xs text-[var(--text-muted)]">{t('boards.phone_hint')}</p>
      </div>

      {/* The page's red +. It writes a card straight onto this board, never
          into the Inbox — the app's own + would have sent it through the
          extractor to wait for approval (finding 2 of the redesign). It sits
          lower than the app's, because this page has no AskBar under it. */}
      {!isAdding && (
        <button
          type="button"
          onClick={startAdding}
          aria-label={t('boards.new_card')}
          className="fixed bottom-safe-24 right-4 z-30 w-16 h-16 rounded-full bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] text-white shadow-[var(--shadow-fab)] flex items-center justify-center"
        >
          <PlusIcon className="w-6 h-6" />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------- both

function BoardDetail({ board, tasks, onTaskUpdate, onTaskDeleted, onShowToast, onTaskAcknowledged }) {
  const { t } = useTranslation();
  const { moveCard, removeCard, createCard } = useBoards();
  const { activeId } = useWorkspaces();
  const { settings } = useAppSettings();
  const { isShared, personFor } = useMembers();
  const isDesktop = useMediaQuery(DESKTOP_QUERY);

  const [openTaskId, setOpenTaskId] = useState(null);
  const [movingTaskId, setMovingTaskId] = useState(null);
  const [pendingDrop, setPendingDrop] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const [olderOpen, setOlderOpen] = useState({});
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

  function currentColumnOf(taskId) {
    const card = board.cards.find((c) => c.task_id === taskId);
    const task = tasksById[taskId];
    return card && task ? columnFor(task, card, board.columns) : null;
  }

  /**
   * `rethrow` is for the «Γιατί;» dialog alone. It was built to stay open,
   * with what you typed, when a cancellation fails — but this used to swallow
   * the error first, so the dialog closed and took the reason with it
   * (finding 6 of the redesign).
   */
  async function move(taskId, column, reason, { rethrow = false, isUndo = false } = {}) {
    const from = currentColumnOf(taskId);
    // So that undoing a move OUT of «Ακυρώθηκε» calls it off again with the
    // reason it had, rather than silently without one.
    const previousReason = tasksById[taskId]?.drop_reason || undefined;
    setOptimistic((current) => ({ ...current, [taskId]: column }));
    try {
      await moveCard(board.record_id, taskId, column.record_id, reason);
      // An undo says where the card went back to, but offers no undo of its
      // own: this closure's board is the one from before the first move.
      announceMove(taskId, column, isUndo ? null : from, previousReason);
    } catch (err) {
      // The provider has said why; dropping the override puts the card back.
      if (rethrow) throw err;
    } finally {
      setOptimistic((current) => {
        const next = { ...current };
        delete next[taskId];
        return next;
      });
    }
  }

  function announceMove(taskId, column, from, previousReason) {
    const key = column.kind === 'done' ? 'boards.moved_done' : column.kind === 'dropped' ? 'boards.moved_dropped' : 'boards.moved';
    onShowToast?.({
      message: t(key, { column: column.name }),
      variant: 'success',
      duration: 5000,
      // Back to where it was. A move back out of «Ακυρώθηκε» or «Έγινε»
      // reopens the task, which is exactly what undoing either one means.
      action: from
        ? { label: t('boards.undo'), onClick: () => move(taskId, from, from.kind === 'dropped' ? previousReason : undefined, { isUndo: true }) }
        : undefined,
    });
  }

  function requestMove(taskId, columnId) {
    const column = board.columns.find((c) => c.record_id === columnId);
    if (!column || !tasksById[taskId]) return;
    if (currentColumnOf(taskId)?.record_id === columnId) return;
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
    try {
      await removeCard(board.record_id, taskId);
      onShowToast?.({ message: t('boards.removed_toast', { board: board.name }), variant: 'success' });
    } catch {
      // Said by the provider.
    }
    if (openTaskId === taskId) setOpenTaskId(null);
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
  const onCreateCard = (columnId, name) => createCard(board.record_id, columnId, name, newCardWorkspace);

  return (
    <div>
      {isDesktop ? (
        <>
          <DndContext
            sensors={sensors}
            onDragStart={({ active }) => setDraggingId(active.id)}
            onDragCancel={() => setDraggingId(null)}
            onDragEnd={handleDragEnd}
          >
            <div className="flex gap-3 overflow-x-auto pb-4">
              {lanes.map((lane) => (
                <Lane
                  key={lane.column.record_id}
                  lane={lane}
                  count={lane.cards.length + lane.older.length}
                  isOlderOpen={Boolean(olderOpen[lane.column.record_id])}
                  onToggleOlder={() => setOlderOpen((o) => ({ ...o, [lane.column.record_id]: !o[lane.column.record_id] }))}
                  renderCard={renderCard}
                  onCreateCard={onCreateCard}
                  t={t}
                />
              ))}
            </div>
            <DragOverlay>
              {dragging ? (
                <div className="rotate-2 w-[272px]">
                  <CardBody task={dragging} column={null} {...cardProps(dragging)} t={t} />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
          <p className="px-1 text-xs text-[var(--text-muted)]">{t('boards.drag_hint')}</p>
        </>
      ) : (
        <PhoneBoard
          key={board.record_id}
          board={board}
          lanes={lanes}
          onOpen={setOpenTaskId}
          onHold={setMovingTaskId}
          onNext={(taskId, column) => move(taskId, column)}
          onCreateCard={onCreateCard}
          cardProps={cardProps}
          t={t}
        />
      )}

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

      {movingTask && (
        <BoardMoveSheet
          taskName={movingTask.task_name}
          lanes={lanes.map((lane) => ({ column: lane.column, count: lane.cards.length + lane.older.length }))}
          currentColumnId={currentColumnOf(movingTask.record_id)?.record_id}
          onPick={(columnId) => { setMovingTaskId(null); requestMove(movingTask.record_id, columnId); }}
          onOpenTask={() => { setMovingTaskId(null); setOpenTaskId(movingTask.record_id); }}
          onRemove={() => { setMovingTaskId(null); handleRemove(movingTask.record_id); }}
          onClose={() => setMovingTaskId(null)}
        />
      )}

      {pendingDrop && (
        <DropDialog
          taskName={tasksById[pendingDrop.taskId]?.task_name || ''}
          onConfirm={(reason) => move(pendingDrop.taskId, pendingDrop.column, reason, { rethrow: true })}
          onClose={() => setPendingDrop(null)}
        />
      )}
    </div>
  );
}

export default BoardDetail;
