"""
Boards (2026-09-26) — each test is one of the owner's decisions.

  «στέλνω εγώ»                      -> nothing enters a board by itself
  the card IS the task              -> «Έγινε» / «Ακυρώθηκε» change the task,
                                       through the same service calls as Today
  own columns, born as four         -> the last two cannot be deleted or moved
  one board per task at a time      -> sending it elsewhere moves it
  «ποιος κάνει τι και πότε»         -> every change is written to the diary,
                                       including ones made outside the board

Offline: an in-memory stand-in replaces the repository's board functions.
"""
import inspect
import itertools

import pytest
from fastapi.testclient import TestClient

import boards
import main
import repository
import services
from models import Board, BoardCard, BoardColumn, TaskRecord

ME = "0f3c9d2e-1111-4a5b-9c7d-aaaaaaaaaaaa"
# The real diary writer, captured at import: conftest replaces it with a no-op
# for every test, and the two tests at the bottom are about the real one.
_REAL_LOG = repository.log_task_event_on_boards
NAMES = ["Ιδέα", "Σχεδιασμός", "Live", "Κόπηκε"]


class Store:
    """Just enough of the four tables to exercise boards.py."""

    def __init__(self):
        self.boards, self.columns, self.cards, self.activity = {}, {}, {}, []
        self.ids = (f"id-{n}" for n in itertools.count(1))

    def board(self, board_id):
        row = self.boards.get(board_id)
        if row is None:
            return None
        return Board(
            record_id=board_id, name=row["name"], position=row["position"],
            columns=[c for c in self.columns.values() if c.board_id == board_id],
            cards=[c for c in self.cards.values() if c.board_id == board_id],
        )

    def install(self, monkeypatch):
        def create_board(user_id, name, columns, position):
            board_id = next(self.ids)
            self.boards[board_id] = {"name": name, "position": position}
            for i, (col_name, kind) in enumerate(columns):
                cid = next(self.ids)
                self.columns[cid] = BoardColumn(record_id=cid, board_id=board_id, name=col_name, kind=kind, position=i)
            return self.board(board_id)

        def add_column(user_id, board_id, name, position):
            cid = next(self.ids)
            self.columns[cid] = BoardColumn(record_id=cid, board_id=board_id, name=name, kind="open", position=position)
            return self.columns[cid]

        def update_column(user_id, column_id, updates):
            self.columns[column_id] = self.columns[column_id].model_copy(update=updates)
            return True

        def delete_column(user_id, column_id):
            del self.columns[column_id]
            for task_id, card in list(self.cards.items()):
                if card.column_id == column_id:
                    self.cards[task_id] = card.model_copy(update={"column_id": None})
            return True

        def upsert_card(user_id, board_id, task_id, column_id, position):
            self.cards[task_id] = BoardCard(task_id=task_id, board_id=board_id, column_id=column_id, position=position)
            return self.cards[task_id]

        def update_card(user_id, task_id, updates):
            self.cards[task_id] = self.cards[task_id].model_copy(update=updates)
            return self.cards[task_id]

        def delete_card(user_id, board_id, task_id):
            return self.cards.pop(task_id, None) is not None

        def log(board_id, owner_id, action, **kw):
            self.activity.append({"board_id": board_id, "action": action, **kw})

        monkeypatch.setattr(repository, "get_boards", lambda u: [self.board(b) for b in self.boards])
        monkeypatch.setattr(repository, "get_board", lambda u, b: self.board(b))
        monkeypatch.setattr(repository, "create_board", create_board)
        monkeypatch.setattr(repository, "update_board",
                            lambda u, b, up: self.boards[b].update(up) or True)
        monkeypatch.setattr(repository, "delete_board", lambda u, b: self.boards.pop(b, None) is not None)
        monkeypatch.setattr(repository, "add_board_column", add_column)
        monkeypatch.setattr(repository, "update_board_column", update_column)
        monkeypatch.setattr(repository, "delete_board_column", delete_column)
        monkeypatch.setattr(repository, "get_card_for_task", lambda u, t: self.cards.get(t))
        monkeypatch.setattr(repository, "upsert_board_card", upsert_card)
        monkeypatch.setattr(repository, "update_board_card", update_card)
        monkeypatch.setattr(repository, "delete_board_card", delete_card)
        monkeypatch.setattr(repository, "log_board_activity", log)
        monkeypatch.setattr(repository, "get_board_activity", lambda u, b, limit=100: list(self.activity))
        monkeypatch.setattr(repository, "get_profiles", lambda ids: {ME: {"display_name": "Owner"}})
        return self


def _task(record_id="task-1", **overrides):
    base = dict(task_name="Νέο feature", description="", category="Business", priority="P2",
                checklist=[], ai_suggested_category="Business", ai_suggested_priority="P2",
                record_id=record_id, approval_status=True)
    base.update(overrides)
    return TaskRecord(**base)


class FakeTasks:
    """The slice of TaskService the board calls — recording each call, so a
    test can say «Έγινε went through update_task», not around it."""

    def __init__(self, *tasks):
        self.tasks = {t.record_id: t for t in tasks}
        self.calls = []
        outer = self

        class _Repo:
            def get_task(self, user_id, record_id):
                return outer.tasks.get(record_id)

        self.repository = _Repo()

    def update_task(self, user_id, record_id, updates, completed_source="ui"):
        self.calls.append(("update_task", updates))
        extra = {"dropped_at": None} if updates.get("is_completed") else {}
        self.tasks[record_id] = self.tasks[record_id].model_copy(update={**updates, **extra})
        return self.tasks[record_id]

    def drop_task(self, user_id, record_id, reason=None):
        self.calls.append(("drop_task", reason))
        self.tasks[record_id] = self.tasks[record_id].model_copy(
            update={"dropped_at": "2026-09-26T10:00:00+03:00", "drop_reason": reason, "is_completed": False})
        return self.tasks[record_id]

    def undrop_task(self, user_id, record_id):
        self.calls.append(("undrop_task", None))
        self.tasks[record_id] = self.tasks[record_id].model_copy(update={"dropped_at": None})
        return self.tasks[record_id]

    def validate_workspace_placement(self, user_id, workspace_id, category_id, check_membership=True):
        self.calls.append(("validate", workspace_id))
        self.validated_category = category_id

    def create_task_manual(self, user_id, fields, approval_status=True):
        self.calls.append(("create", fields))
        task = _task("task-new", task_name=fields["task_name"], approval_status=approval_status,
                     workspace_id=fields.get("workspace_id"))
        self.tasks[task.record_id] = task
        return task


@pytest.fixture
def store(monkeypatch):
    return Store().install(monkeypatch)


def _cols(board):
    return {c.kind if c.kind != "open" else c.name: c for c in board.columns}


# ------------------------------------------------------------ born as four

def test_a_board_is_born_with_two_open_columns_then_the_two_endings(store):
    board = boards.create_board(ME, "  Εφαρμογή  ", NAMES)

    assert board.name == "Εφαρμογή"
    assert [(c.name, c.kind) for c in boards.ordered_columns(board.columns)] == [
        ("Ιδέα", "open"), ("Σχεδιασμός", "open"), ("Live", "done"), ("Κόπηκε", "dropped")]
    assert store.activity[-1]["action"] == "board_created"


def test_anything_but_four_names_falls_back_to_the_defaults(store):
    board = boards.create_board(ME, "Χ", ["μόνο", "δύο"])

    assert [c.name for c in boards.ordered_columns(board.columns)] == list(boards.DEFAULT_COLUMN_NAMES)


def test_a_nameless_board_is_refused(store):
    with pytest.raises(boards.BoardRefused):
        boards.create_board(ME, "   ", NAMES)


# ------------------------------------------------ where a card IS

def test_the_task_decides_the_column_before_the_card_does(store):
    board = boards.create_board(ME, "Χ", NAMES)
    cols = _cols(board)
    card = BoardCard(task_id="t", board_id=board.record_id, column_id=cols["Σχεδιασμός"].record_id)

    assert boards.column_for(_task(), card, board.columns).name == "Σχεδιασμός"
    assert boards.column_for(_task(is_completed=True), card, board.columns).kind == "done"
    assert boards.column_for(_task(dropped_at="2026-09-26T10:00:00+03:00"), card, board.columns).kind == "dropped"


def test_a_card_with_no_or_a_deleted_column_is_in_the_first_open_one(store):
    board = boards.create_board(ME, "Χ", NAMES)
    lost = BoardCard(task_id="t", board_id=board.record_id, column_id="gone")

    assert boards.column_for(_task(), lost, board.columns).name == "Ιδέα"


def test_the_endings_stay_last_whatever_the_positions_say():
    cols = [BoardColumn(record_id="d", name="Έγινε", kind="done", position=0),
            BoardColumn(record_id="a", name="Β", kind="open", position=7),
            BoardColumn(record_id="x", name="Ακυρώθηκε", kind="dropped", position=1),
            BoardColumn(record_id="b", name="Α", kind="open", position=3)]

    assert [c.record_id for c in boards.ordered_columns(cols)] == ["b", "a", "d", "x"]


# ------------------------------------------ the card IS the task

def _board_with_card(store, task, column="Ιδέα"):
    board = boards.create_board(ME, "Χ", NAMES)
    tasks = FakeTasks(task)
    boards.send_to_board(tasks, ME, task.record_id, board.record_id, _cols(board)[column].record_id)
    return board, tasks


def test_dragging_to_done_completes_the_task_through_the_service(store):
    board, tasks = _board_with_card(store, _task())

    result = boards.move_card(tasks, ME, board.record_id, "task-1", _cols(board)["done"].record_id)

    assert tasks.calls == [("update_task", {"is_completed": True})]
    assert result.is_completed is True


def test_dragging_to_cancelled_calls_it_off_with_the_reason(store):
    board, tasks = _board_with_card(store, _task())

    boards.move_card(tasks, ME, board.record_id, "task-1", _cols(board)["dropped"].record_id, "βρέχει")

    assert tasks.calls == [("drop_task", "βρέχει")]


def test_dragging_a_done_card_back_reopens_it_and_places_it(store):
    board, tasks = _board_with_card(store, _task(is_completed=True))
    target = _cols(board)["Σχεδιασμός"]

    result = boards.move_card(tasks, ME, board.record_id, "task-1", target.record_id)

    assert tasks.calls == [("update_task", {"is_completed": False})]
    assert result.is_completed is False
    assert store.cards["task-1"].column_id == target.record_id
    moved = store.activity[-1]
    assert moved["action"] == "card_moved"
    assert moved["details"] == {"from": "Live", "to": "Σχεδιασμός"}


def test_dragging_a_cancelled_card_back_undoes_the_cancellation(store):
    board, tasks = _board_with_card(store, _task(dropped_at="2026-09-26T10:00:00+03:00"))

    boards.move_card(tasks, ME, board.record_id, "task-1", _cols(board)["Ιδέα"].record_id)

    assert ("undrop_task", None) in tasks.calls


def test_dropping_a_card_where_it_already_is_does_nothing(store):
    board, tasks = _board_with_card(store, _task())
    before = len(store.activity)

    boards.move_card(tasks, ME, board.record_id, "task-1", _cols(board)["Ιδέα"].record_id)

    assert tasks.calls == [] and len(store.activity) == before


def test_a_move_between_open_columns_changes_no_task_field(store):
    board, tasks = _board_with_card(store, _task())

    boards.move_card(tasks, ME, board.record_id, "task-1", _cols(board)["Σχεδιασμός"].record_id)

    assert tasks.calls == []
    assert store.activity[-1]["details"] == {"from": "Ιδέα", "to": "Σχεδιασμός"}


# ------------------------------------------------ «στέλνω εγώ»

def test_an_inbox_suggestion_cannot_go_on_a_board(store):
    board = boards.create_board(ME, "Χ", NAMES)

    with pytest.raises(boards.BoardRefused):
        boards.send_to_board(FakeTasks(_task(approval_status=False)), ME, "task-1", board.record_id)
    assert store.cards == {}


def test_a_task_cannot_enter_straight_into_an_ending(store):
    board = boards.create_board(ME, "Χ", NAMES)

    with pytest.raises(boards.BoardRefused):
        boards.send_to_board(FakeTasks(_task()), ME, "task-1", board.record_id, _cols(board)["done"].record_id)


def test_sending_to_another_board_moves_it_and_both_diaries_say_so(store):
    first = boards.create_board(ME, "Πρώτος", NAMES)
    second = boards.create_board(ME, "Δεύτερος", NAMES)
    tasks = FakeTasks(_task())
    boards.send_to_board(tasks, ME, "task-1", first.record_id)

    boards.send_to_board(tasks, ME, "task-1", second.record_id)

    assert store.cards["task-1"].board_id == second.record_id
    out, added = store.activity[-2], store.activity[-1]
    assert (out["board_id"], out["action"], out["details"]) == (first.record_id, "card_moved_out", {"to_board": "Δεύτερος"})
    assert (added["board_id"], added["action"]) == (second.record_id, "card_added")


def test_removing_a_card_leaves_the_task_alone(store):
    board, tasks = _board_with_card(store, _task())

    boards.remove_from_board(tasks, ME, board.record_id, "task-1")

    assert store.cards == {}
    assert tasks.calls == []
    assert store.activity[-1]["action"] == "card_removed"


def test_a_new_card_is_an_approved_task_placed_in_its_column(store):
    board = boards.create_board(ME, "Χ", NAMES)
    tasks = FakeTasks()
    column = _cols(board)["Σχεδιασμός"]

    task = boards.create_card(tasks, ME, board.record_id, column.record_id, "  Βάση δεδομένων ", "ws-1")

    assert task.task_name == "Βάση δεδομένων" and task.approval_status is True
    assert ("validate", "ws-1") in tasks.calls
    assert store.cards[task.record_id].column_id == column.record_id


def test_a_new_card_carries_every_field_the_form_gave(store):
    """2026-09-30, the owner: «Νέα κάρτα» opens the whole task form, not a
    title box — so everything typed there reaches the task in one go."""
    board = boards.create_board(ME, "Χ", NAMES)
    tasks = FakeTasks()
    fields = {"description": "τιμολόγια Q3", "priority": "P1", "due_date": "2026-10-02",
              "due_time": "10:00", "start_date": "2026-10-01", "category_id": "cat-1",
              "checklist": [{"text": "ΦΠΑ", "done": False}]}

    boards.create_card(tasks, ME, board.record_id, _cols(board)["Σχεδιασμός"].record_id,
                       "Λογιστής", "ws-1", fields)

    created = next(f for name, f in tasks.calls if name == "create")
    assert {k: created[k] for k in fields} == fields
    assert created["task_name"] == "Λογιστής" and created["workspace_id"] == "ws-1"
    assert tasks.validated_category == "cat-1"


def test_a_new_card_leaves_empty_fields_to_the_defaults(store):
    board = boards.create_board(ME, "Χ", NAMES)
    tasks = FakeTasks()

    boards.create_card(tasks, ME, board.record_id, _cols(board)["Σχεδιασμός"].record_id, "x", None,
                       {"priority": None, "due_date": "", "checklist": [], "description": ""})

    created = next(f for name, f in tasks.calls if name == "create")
    assert set(created) == {"task_name", "workspace_id"}


def test_a_new_card_starting_after_its_deadline_is_refused_before_anything_is_made(store):
    board = boards.create_board(ME, "Χ", NAMES)
    tasks = FakeTasks()

    with pytest.raises(boards.BoardRefused):
        boards.create_card(tasks, ME, board.record_id, _cols(board)["Σχεδιασμός"].record_id, "x", None,
                           {"start_date": "2026-10-05", "due_date": "2026-10-02"})
    assert not any(name == "create" for name, _ in tasks.calls)
    assert store.cards == {}


def test_a_new_card_cannot_start_as_done(store):
    board = boards.create_board(ME, "Χ", NAMES)

    with pytest.raises(boards.BoardRefused):
        boards.create_card(FakeTasks(), ME, board.record_id, _cols(board)["done"].record_id, "x")


# ------------------------------------------------------------- columns

def test_the_endings_cannot_be_deleted(store):
    board = boards.create_board(ME, "Χ", NAMES)

    for kind in ("done", "dropped"):
        with pytest.raises(boards.BoardRefused):
            boards.delete_column(ME, board.record_id, _cols(board)[kind].record_id)


def test_the_last_open_column_cannot_be_deleted(store):
    board = boards.create_board(ME, "Χ", NAMES)
    boards.delete_column(ME, board.record_id, _cols(board)["Ιδέα"].record_id)

    with pytest.raises(boards.BoardRefused):
        boards.delete_column(ME, board.record_id, _cols(store.board(board.record_id))["Σχεδιασμός"].record_id)


def test_the_endings_can_be_renamed(store):
    board = boards.create_board(ME, "Χ", NAMES)

    after = boards.rename_column(ME, board.record_id, _cols(board)["done"].record_id, "Ανέβηκε")

    assert _cols(after)["done"].name == "Ανέβηκε"


def test_a_new_column_goes_after_the_open_ones_and_before_done(store):
    board = boards.create_board(ME, "Χ", NAMES)

    after = boards.add_column(ME, board.record_id, "Έλεγχος")

    assert [c.name for c in boards.ordered_columns(after.columns)] == [
        "Ιδέα", "Σχεδιασμός", "Έλεγχος", "Live", "Κόπηκε"]


def test_open_columns_move_and_the_endings_do_not(store):
    board = boards.create_board(ME, "Χ", NAMES)

    after = boards.move_column(ME, board.record_id, _cols(board)["Σχεδιασμός"].record_id, -1)
    assert [c.name for c in boards.ordered_columns(after.columns)][:2] == ["Σχεδιασμός", "Ιδέα"]

    with pytest.raises(boards.BoardRefused):
        boards.move_column(ME, board.record_id, _cols(after)["done"].record_id, -1)


# ------------------------------------------ «ποιος κάνει τι και πότε»

def _svc(monkeypatch, existing):
    class _Repo:
        def get_task(self, user_id, record_id):
            return existing

        def update_task(self, user_id, record_id, updates):
            return existing.model_copy(update=updates)

    monkeypatch.setattr(services.access, "require_write", lambda u, t: {"id": t})
    monkeypatch.setattr(services.repository, "get_task_calendar_fields", lambda u, r: None)
    svc = services.TaskService.__new__(services.TaskService)
    svc.repository = _Repo()
    heard = []
    monkeypatch.setattr(repository, "log_task_event_on_boards",
                        lambda task_id, action, **kw: heard.append((action, kw)))
    return svc, heard


def test_a_completion_from_anywhere_reaches_the_boards_diary(monkeypatch):
    svc, heard = _svc(monkeypatch, _task())

    svc.update_task(ME, "task-1", {"is_completed": True})

    assert heard[0][0] == "task_completed"
    assert heard[0][1]["actor_user_id"] == ME and heard[0][1]["actor_kind"] == "user"


def test_the_agent_closing_it_is_said_as_the_agent(monkeypatch):
    svc, heard = _svc(monkeypatch, _task())

    svc.update_task(ME, "task-1", {"is_completed": True}, completed_source="agent")

    assert heard[0][1]["actor_kind"] == "agent"


def test_a_rename_is_not_a_board_event(monkeypatch):
    svc, heard = _svc(monkeypatch, _task())

    svc.update_task(ME, "task-1", {"task_name": "άλλο"})

    assert heard == []


def test_a_cancellation_reaches_the_boards_diary_with_its_reason(monkeypatch):
    svc, heard = _svc(monkeypatch, _task())

    svc.drop_task(ME, "task-1", "βρέχει")

    assert heard[0][0] == "task_dropped"
    assert heard[0][1]["details"] == {"reason": "βρέχει"}


def test_both_hostaway_closing_paths_tell_the_boards_it_was_hostaway():
    """The reply poller and the outgoing-message webhook each close a task by
    writing the row directly, so each must tell the boards itself."""
    for source in (inspect.getsource(services.TaskService),
                   inspect.getsource(main._handle_outgoing_hostaway_message)):
        assert 'actor_kind="hostaway"' in source


def test_the_diary_gets_one_line_per_board_the_task_is_on(monkeypatch):
    written = []

    class _Q:
        def __init__(self, rows):
            self.rows = rows

        def select(self, *a):
            return self

        def eq(self, *a):
            return self

        def insert(self, row):
            written.append(row)
            return self

        def execute(self):
            return type("R", (), {"data": self.rows})()

    class _Client:
        def table(self, name):
            return _Q([{"board_id": "b1", "user_id": ME}, {"board_id": "b2", "user_id": "someone"}]
                      if name == "board_cards" else [])

    monkeypatch.setattr(repository, "supabase", _Client())

    _REAL_LOG("task-1", "task_completed", actor_user_id=None, actor_kind="hostaway", task_name="Χ")

    assert [(w["board_id"], w["user_id"], w["actor_kind"]) for w in written] == [
        ("b1", ME, "hostaway"), ("b2", "someone", "hostaway")]



def test_a_board_diary_failure_never_breaks_the_act(monkeypatch):
    class _Broken:
        def table(self, name):
            raise RuntimeError("database down")

    monkeypatch.setattr(repository, "supabase", _Broken())
    _REAL_LOG("task-1", "task_completed", actor_user_id=ME, actor_kind="user", task_name="Χ")


# ------------------------------------------------------------ the routes

@pytest.fixture
def client():
    main.app.dependency_overrides[main.get_current_user_id] = lambda: ME
    yield TestClient(main.app)
    main.app.dependency_overrides.clear()


def test_creating_a_board_answers_with_every_board(client, store):
    r = client.post("/boards", json={"name": "Εφαρμογή", "column_names": NAMES})

    assert r.status_code == 201
    assert [b["name"] for b in r.json()["boards"]] == ["Εφαρμογή"]
    assert len(r.json()["boards"][0]["columns"]) == 4


def test_someone_elses_board_is_a_404(client, store):
    assert client.patch("/boards/nope", json={"name": "x"}).status_code == 404


def test_a_refusal_is_a_422(client, store):
    board = boards.create_board(ME, "Χ", NAMES)
    done = _cols(board)["done"].record_id

    assert client.delete(f"/boards/{board.record_id}/columns/{done}").status_code == 422


def test_a_move_answers_with_the_task_as_it_now_stands(client, store, monkeypatch):
    board, tasks = _board_with_card(store, _task())
    monkeypatch.setattr(main, "service", tasks)

    r = client.post(f"/boards/{board.record_id}/cards/task-1/move",
                    json={"column_id": _cols(board)["done"].record_id})

    assert r.status_code == 200
    assert r.json()["task"]["is_completed"] is True
    assert r.json()["boards"][0]["record_id"] == board.record_id


def test_a_new_card_request_passes_the_whole_form_on(client, store, monkeypatch):
    board = boards.create_board(ME, "Χ", NAMES)
    tasks = FakeTasks()
    monkeypatch.setattr(main, "service", tasks)

    r = client.post(f"/boards/{board.record_id}/cards/new", json={
        "column_id": _cols(board)["Σχεδιασμός"].record_id, "task_name": "Λογιστής", "workspace_id": "ws-1",
        "priority": "P1", "due_date": "2026-10-02", "checklist": [{"text": "ΦΠΑ", "done": False}],
    })

    assert r.status_code == 201
    created = next(f for name, f in tasks.calls if name == "create")
    assert created["priority"] == "P1" and created["due_date"] == "2026-10-02"
    assert created["checklist"] == [{"text": "ΦΠΑ", "done": False}]


def test_the_activity_carries_the_actors_name(client, store):
    board = boards.create_board(ME, "Χ", NAMES)
    store.activity[-1]["actor_user_id"] = ME

    r = client.get(f"/boards/{board.record_id}/activity")

    assert r.status_code == 200
    assert r.json()["activity"][0]["actor_name"] == "Owner"
