"""
Boards — a kanban view of tasks the user picks (2026-09-26).

What the owner decided, in the order he decided it, because every rule below
traces to one of these:

  - a board is its own part of the app and HE chooses what goes on it
    («στέλνω εγώ»): nothing enters by filter;
  - a card IS the task — it keeps its deadline, reminders and assignee, and it
    still shows on Today. One thing, seen in two places;
  - each board has its own columns, born as Να γίνει / Σε εξέλιξη / Έγινε /
    Ακυρώθηκε and then shaped freely — except that the last two cannot be
    deleted, because they change the task itself;
  - «Έγινε» and «Ακυρώθηκε» change the task EVERYWHERE, and the reverse holds:
    tick it in Today and the card is in «Έγινε»;
  - one board per task at a time; boards are personal for now;
  - who did what, and when, is written down from day one.

THE BOARD NEVER KEEPS ITS OWN OPINION ABOUT WHETHER A TASK IS DONE. column_for
reads the task first; board_cards.column_id only remembers which OPEN column a
card sits in, which is also where it returns when reopened. Two truths — the
board saying «Έγινε» while Today still rings for the task — is the failure this
shape rules out.

Task-state changes go through TaskService (update_task / drop_task /
undrop_task), never around it: those paths carry the write gate, the
completion stamps, the calendar and the room's log, and the board would
otherwise need its own copy of each. TaskService is passed in rather than
imported, which keeps this module from importing services and services from
ever needing to import it back.
"""
import logging
import time
from typing import Optional

import repository
from agent_tools import is_disposed_of
from models import Board, BoardColumn, BoardCard, TaskRecord

logger = logging.getLogger(__name__)

# The columns every board is born with, and what each one means. The NAMES are
# normally supplied by the screen in the user's language; these are the
# fallback for a caller that sends none. The KINDS are not negotiable.
DEFAULT_COLUMN_NAMES = ("Να γίνει", "Σε εξέλιξη", "Έγινε", "Ακυρώθηκε")
DEFAULT_KINDS = ("open", "open", "done", "dropped")

# Ceilings, so a runaway client cannot build a thousand columns. Generous on
# purpose: nobody has asked for limits, and these only stop accidents.
MAX_BOARDS = 30
MAX_OPEN_COLUMNS = 10


class BoardNotFound(ValueError):
    """Not this user's board — or no such board; deliberately the same answer."""


class BoardRefused(ValueError):
    """A request that is understood and declined: the user's data, a 422."""


def ordered_columns(columns: list[BoardColumn]) -> list[BoardColumn]:
    """Open columns in the user's order, then «Έγινε», then «Ακυρώθηκε».

    The two endings are ALWAYS last. The owner's words were «τις δύο
    τελευταίες μπορείς να τις μετονομάσεις, αλλά όχι να τις σβήσεις»: they are
    the end of a card's road, so reordering only ever moves the open ones."""
    open_cols = sorted((c for c in columns if c.kind == "open"), key=lambda c: c.position)
    done = [c for c in columns if c.kind == "done"]
    dropped = [c for c in columns if c.kind == "dropped"]
    return open_cols + done + dropped


def column_for(task: TaskRecord, card: BoardCard, columns: list[BoardColumn]) -> Optional[BoardColumn]:
    """Where a card IS — decided by the task first, the card second.

    Mirrors utils/boards.js columnFor on the screen; tests hold both to the
    same cases."""
    ordered = ordered_columns(columns)
    if getattr(task, "dropped_at", None):
        return next((c for c in ordered if c.kind == "dropped"), None)
    if task.is_completed:
        return next((c for c in ordered if c.kind == "done"), None)
    open_cols = [c for c in ordered if c.kind == "open"]
    return next((c for c in open_cols if c.record_id == card.column_id), open_cols[0] if open_cols else None)


def _position() -> float:
    """A card's place in its column: when it arrived there, in milliseconds.
    Newest at the bottom, like a list you add to. There is no manual ordering
    within a column yet — nobody has asked for it, and this is the order that
    needs no decision."""
    return time.time() * 1000


def _require_board(user_id: str, board_id: str) -> Board:
    board = repository.get_board(user_id, board_id)
    if board is None:
        raise BoardNotFound(f"Board {board_id} not found.")
    return board


def _column(board: Board, column_id: str) -> BoardColumn:
    column = next((c for c in board.columns if c.record_id == column_id), None)
    if column is None:
        raise BoardRefused("That column is not on this board.")
    return column


def _clean_name(name, limit: int) -> str:
    cleaned = (name or "").strip()[:limit]
    if not cleaned:
        raise BoardRefused("A name cannot be empty.")
    return cleaned


def _visible_task(task_service, user_id: str, task_id: str) -> TaskRecord:
    task = task_service.repository.get_task(user_id, task_id)
    if task is None:
        raise BoardNotFound(f"Task {task_id} not found.")
    return task


# ------------------------------------------------------------------ boards

def list_boards(user_id: str) -> list[Board]:
    return repository.get_boards(user_id)


def create_board(user_id: str, name: str, column_names: Optional[list[str]] = None) -> Board:
    """A new board, born with its four columns.

    The screen sends the column names in the user's language; anything other
    than four non-empty names falls back to the Greek defaults rather than
    building a board with a missing ending."""
    cleaned = _clean_name(name, 60)
    names = [(n or "").strip()[:40] for n in (column_names or [])]
    if len(names) != len(DEFAULT_KINDS) or not all(names):
        names = list(DEFAULT_COLUMN_NAMES)

    existing = repository.get_boards(user_id)
    if len(existing) >= MAX_BOARDS:
        raise BoardRefused(f"There is a limit of {MAX_BOARDS} boards.")

    board = repository.create_board(user_id, cleaned, list(zip(names, DEFAULT_KINDS)), len(existing))
    repository.log_board_activity(board.record_id, user_id, "board_created", actor_user_id=user_id,
                                  details={"name": cleaned})
    return board


def rename_board(user_id: str, board_id: str, name: str) -> Board:
    board = _require_board(user_id, board_id)
    cleaned = _clean_name(name, 60)
    if cleaned != board.name:
        repository.update_board(user_id, board_id, {"name": cleaned})
        repository.log_board_activity(board_id, user_id, "board_renamed", actor_user_id=user_id,
                                      details={"from": board.name, "to": cleaned})
    return _require_board(user_id, board_id)


def delete_board(user_id: str, board_id: str) -> None:
    """The board, its columns, cards and diary. Never a task — a card is a link."""
    _require_board(user_id, board_id)
    repository.delete_board(user_id, board_id)


# ----------------------------------------------------------------- columns

def add_column(user_id: str, board_id: str, name: str) -> Board:
    """A new OPEN column, placed after the other open ones — so just before
    «Έγινε», which is where a new stage of work belongs."""
    board = _require_board(user_id, board_id)
    cleaned = _clean_name(name, 40)
    open_cols = [c for c in board.columns if c.kind == "open"]
    if len(open_cols) >= MAX_OPEN_COLUMNS:
        raise BoardRefused(f"A board can have up to {MAX_OPEN_COLUMNS} columns before «Έγινε».")
    position = max((c.position for c in open_cols), default=-1) + 1
    repository.add_board_column(user_id, board_id, cleaned, position)
    repository.log_board_activity(board_id, user_id, "column_added", actor_user_id=user_id,
                                  details={"name": cleaned})
    return _require_board(user_id, board_id)


def rename_column(user_id: str, board_id: str, column_id: str, name: str) -> Board:
    """Any column may be renamed, the two endings included — the owner's rule.
    Their KIND is what makes them special, never their label."""
    board = _require_board(user_id, board_id)
    column = _column(board, column_id)
    cleaned = _clean_name(name, 40)
    if cleaned != column.name:
        repository.update_board_column(user_id, column_id, {"name": cleaned})
        repository.log_board_activity(board_id, user_id, "column_renamed", actor_user_id=user_id,
                                      details={"from": column.name, "to": cleaned})
    return _require_board(user_id, board_id)


def move_column(user_id: str, board_id: str, column_id: str, direction: int) -> Board:
    """One step left (-1) or right (+1) among the OPEN columns. The endings do
    not move: they are always last (ordered_columns)."""
    board = _require_board(user_id, board_id)
    column = _column(board, column_id)
    if column.kind != "open":
        raise BoardRefused("«Έγινε» and «Ακυρώθηκε» stay at the end of the board.")
    open_cols = [c for c in ordered_columns(board.columns) if c.kind == "open"]
    index = next(i for i, c in enumerate(open_cols) if c.record_id == column_id)
    target = index + (1 if direction > 0 else -1)
    if target < 0 or target >= len(open_cols):
        return board
    other = open_cols[target]
    # Positions are rewritten for the whole open run rather than swapped, so two
    # columns that happen to share a position cannot make a swap a no-op.
    reordered = list(open_cols)
    reordered[index], reordered[target] = reordered[target], reordered[index]
    for i, col in enumerate(reordered):
        if col.position != i:
            repository.update_board_column(user_id, col.record_id, {"position": i})
    repository.log_board_activity(board_id, user_id, "column_moved", actor_user_id=user_id,
                                  details={"name": column.name, "past": other.name})
    return _require_board(user_id, board_id)


def delete_column(user_id: str, board_id: str, column_id: str) -> Board:
    """Only an open column, and never the last one. Its cards move to the first
    open column that remains (their column_id becomes NULL in the database)."""
    board = _require_board(user_id, board_id)
    column = _column(board, column_id)
    if column.kind != "open":
        raise BoardRefused("«Έγινε» and «Ακυρώθηκε» cannot be deleted: they change the task itself.")
    if sum(1 for c in board.columns if c.kind == "open") <= 1:
        raise BoardRefused("A board needs at least one column before «Έγινε».")
    repository.delete_board_column(user_id, column_id)
    repository.log_board_activity(board_id, user_id, "column_removed", actor_user_id=user_id,
                                  details={"name": column.name})
    return _require_board(user_id, board_id)


# ------------------------------------------------------------------- cards

def send_to_board(task_service, user_id: str, task_id: str, board_id: str,
                  column_id: Optional[str] = None) -> BoardCard:
    """«Στείλε σε πίνακα…». A task already on another of this person's boards
    MOVES — one board per task at a time, the owner's choice — and both boards'
    diaries say so.

    Refused for an Inbox suggestion (approve it first: an unapproved task on a
    board would sit in «Να γίνει» as if it were accepted work) and for a row
    that is already a record rather than work."""
    board = _require_board(user_id, board_id)
    task = _visible_task(task_service, user_id, task_id)
    if not task.approval_status:
        raise BoardRefused("Approve the task before putting it on a board.")
    if is_disposed_of(task):
        raise BoardRefused("A deleted task cannot go on a board.")

    open_column_id = None
    if column_id:
        column = _column(board, column_id)
        if column.kind != "open":
            raise BoardRefused("A card enters a board in one of its open columns.")
        open_column_id = column.record_id

    previous = repository.get_card_for_task(user_id, task_id)
    if previous and previous.board_id == board_id:
        return previous

    card = repository.upsert_board_card(user_id, board_id, task_id, open_column_id, _position())

    if previous:
        repository.log_board_activity(previous.board_id, user_id, "card_moved_out", actor_user_id=user_id,
                                      task_id=task_id, task_name=task.task_name,
                                      details={"to_board": board.name})
    repository.log_board_activity(board_id, user_id, "card_added", actor_user_id=user_id,
                                  task_id=task_id, task_name=task.task_name)
    return card


def remove_from_board(task_service, user_id: str, board_id: str, task_id: str) -> None:
    """«Βγάλε από τον πίνακα». The card goes; the task stays exactly as it was."""
    _require_board(user_id, board_id)
    task = task_service.repository.get_task(user_id, task_id)
    if repository.delete_board_card(user_id, board_id, task_id):
        repository.log_board_activity(board_id, user_id, "card_removed", actor_user_id=user_id,
                                      task_id=task_id, task_name=task.task_name if task else None)


def move_card(task_service, user_id: str, board_id: str, task_id: str, column_id: str,
              reason: Optional[str] = None) -> TaskRecord:
    """A card dragged to a column. What that MEANS depends on the column:

      «Έγινε»      -> the task is completed, everywhere (TaskService.update_task)
      «Ακυρώθηκε»  -> the task is called off, with the optional reason
                       (TaskService.drop_task)
      an open one  -> a finished or called-off task is reopened first, then the
                       card is placed there

    The first two write their own diary lines through TaskService (the same
    lines a completion from Today writes); only a move between open columns is
    recorded here, as a move. Returns the task as it now stands."""
    board = _require_board(user_id, board_id)
    target = _column(board, column_id)
    card = repository.get_card_for_task(user_id, task_id)
    if card is None or card.board_id != board_id:
        raise BoardNotFound("That task is not on this board.")
    task = _visible_task(task_service, user_id, task_id)

    current = column_for(task, card, board.columns)
    if current is not None and current.record_id == target.record_id:
        return task

    if target.kind == "done":
        return task_service.update_task(user_id, task_id, {"is_completed": True})

    if target.kind == "dropped":
        return task_service.drop_task(user_id, task_id, reason)

    if task.is_completed:
        task = task_service.update_task(user_id, task_id, {"is_completed": False})
    if getattr(task, "dropped_at", None):
        task = task_service.undrop_task(user_id, task_id)
    repository.update_board_card(user_id, task_id, {"column_id": target.record_id, "position": _position()})
    repository.log_board_activity(board_id, user_id, "card_moved", actor_user_id=user_id,
                                  task_id=task_id, task_name=task.task_name,
                                  details={"from": current.name if current else None, "to": target.name})
    return task


def create_card(task_service, user_id: str, board_id: str, column_id: str, task_name: str,
                workspace_id: Optional[str] = None) -> TaskRecord:
    """«Νέα κάρτα» typed straight into a column: an ordinary task — approved,
    since the person typed it themselves, exactly like POST /tasks — placed on
    this board in that column.

    workspace_id is the screen's to choose (the room the user is standing in,
    else their default) and is checked like any other placement."""
    board = _require_board(user_id, board_id)
    column = _column(board, column_id)
    if column.kind != "open":
        raise BoardRefused("New cards start in one of the open columns.")
    cleaned = _clean_name(task_name, 80)
    task_service.validate_workspace_placement(user_id, workspace_id, None)

    task = task_service.create_task_manual(user_id, {"task_name": cleaned, "workspace_id": workspace_id})
    repository.upsert_board_card(user_id, board_id, task.record_id, column.record_id, _position())
    repository.log_board_activity(board_id, user_id, "card_created", actor_user_id=user_id,
                                  task_id=task.record_id, task_name=cleaned,
                                  details={"column": column.name})
    return task


# ----------------------------------------------------------------- the diary

def board_activity(user_id: str, board_id: str, limit: int = 100) -> list[dict]:
    """The board's diary, newest first, each row carrying its actor's NAME —
    resolved here in one read of profiles, for the reason the workspace log
    gives: the screen only knows the people it can see now, and a diary is
    largely about the ones it cannot."""
    _require_board(user_id, board_id)
    rows = repository.get_board_activity(user_id, board_id, limit=min(limit, 500))
    profiles = repository.get_profiles([r.get("actor_user_id") for r in rows])
    out = []
    for row in rows:
        profile = profiles.get(row.get("actor_user_id")) or {}
        out.append({**row, "actor_name": profile.get("display_name") or profile.get("email")})
    return out
