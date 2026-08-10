# Hostaway Threading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rapid-fire guest messages that are one thought become one task; every Hostaway task links to its conversation; a human reply closes it (P2/P3) or silences it (P1).

**Architecture:** All three decisions are made by pure functions in a new `hostaway_threading.py` — a timestamp comparison, a null check, and a priority rank — with no I/O and no AI. `main.py`'s webhook orchestrates; `classify_message` keeps exactly the job it has today. The AI is never asked "same topic?" or "human or robot?", because those are judgements and the requirement is zero fail.

**Tech Stack:** FastAPI, Supabase (PostgreSQL), Pydantic, pytest (new), React + react-i18next.

**Spec:** `docs/superpowers/specs/2026-08-10-hostaway-threading-design.md`

## Global Constraints

- **Threading window: 90 seconds**, rolling, measured between consecutive guest messages. Measured value, not chosen — see spec §1.3.
- **Timestamps come from Hostaway's `date` field, never the server's `now()`.** This is what makes the feature independent of webhook-vs-poll delivery.
- **`userId` is the only human-reply signal.** Not `communicationId` — a GuestArrive message has neither field set (spec §1.2).
- **Nothing is ever dropped.** No path may discard a guest message.
- **A P1 task never auto-completes.** It stops escalating and stays open.
- Every repository function is scoped by `user_id` — app-code filtering is the primary security boundary (the secret key bypasses RLS).
- New FastAPI endpoints use `def`, not `async def` (ARCHITECTURE.md).
- `requirements.txt` is **UTF-16LE with BOM** — this plan does not touch it; dev dependencies go in a new plain-UTF-8 `requirements-dev.txt`.
- Migrations are run **by hand** by the owner in the Supabase SQL Editor. Claude Code never runs SQL.
- Translations must land in **both** `en.json` and `el.json`.

## Two spec deviations, decided while planning

1. **A fifth column, `hostaway_thread`.** The spec's §2 lists four. Re-classifying the whole thread needs the raw guest messages, and the alternatives are worse: parsing them back out of the formatted `description` is fragile, and re-fetching from the Hostaway API costs an HTTP round-trip per append. A dedicated column is honest and cheap.
2. **Re-classification updates `description` and `priority`, NOT `task_name`.** The spec says "the title changes". It does not: `task_name` is `f"Hostaway: {guest} - {listing}"`, which contains no summary. The visible signals of an appended message are the priority, the summary inside the description, the message-count badge, and the push. Making the title carry the summary would be a real improvement but is outside the approved scope.

---

### Task 1: Migration + model fields + repository round-trip

**⚠️ Run the SQL BEFORE any of this code deploys.** `_task_to_supabase_fields` builds its payload from `task.model_dump()`, so a new model field is written on every insert — and Supabase rejects a write containing an unknown column *wholesale*. Adding fields to `TaskRecord` before the columns exist breaks task creation for everyone. This exact failure has happened before on this project (a missing `model` column broke all token logging — DATABASE_SCHEMA.md).

**Files:**
- Create: `requirements-dev.txt`
- Create: `tests/__init__.py`, `tests/test_repository_hostaway_fields.py`
- Create: `docs/migrations/2026-08-10-hostaway-threading.sql`
- Modify: `models.py:82-83` (add fields to `TaskRecord`)
- Modify: `repository.py:148-149` (read them in `_supabase_row_to_task`)

**Interfaces:**
- Produces: `TaskRecord.hostaway_conversation_id: Optional[str]`, `.hostaway_last_message_at: Optional[str]`, `.hostaway_message_count: int = 0`, `.hostaway_answered_at: Optional[str]`, `.hostaway_thread: Optional[str]`

- [ ] **Step 1: Write the migration file**

Create `docs/migrations/2026-08-10-hostaway-threading.sql`:

```sql
-- Hostaway threading (see docs/superpowers/specs/2026-08-10-hostaway-threading-design.md)
-- Dates are TEXT, matching due_date / hostaway_created_at (DATABASE_SCHEMA.md convention).
alter table tasks add column if not exists hostaway_conversation_id text;
alter table tasks add column if not exists hostaway_last_message_at  text;
alter table tasks add column if not exists hostaway_message_count    integer not null default 0;
alter table tasks add column if not exists hostaway_answered_at      text;
alter table tasks add column if not exists hostaway_thread           text;

-- Looked up on every inbound Hostaway message.
create index if not exists tasks_hostaway_conversation_id_idx
  on tasks (hostaway_conversation_id)
  where hostaway_conversation_id is not null;
```

- [ ] **Step 2: Hand the SQL to the owner and WAIT for confirmation it ran**

Do not proceed until the owner confirms. Verify with:

```sql
select column_name from information_schema.columns
where table_name = 'tasks' and column_name like 'hostaway%';
```

Expected: `hostaway_created_at`, `hostaway_last_notified_at`, `hostaway_conversation_id`, `hostaway_last_message_at`, `hostaway_message_count`, `hostaway_answered_at`, `hostaway_thread`.

- [ ] **Step 3: Add the dev requirements file**

Create `requirements-dev.txt` (plain UTF-8 — do NOT add these to `requirements.txt`, which is UTF-16LE and ships to Render):

```
-r requirements.txt
pytest==8.3.4
```

Install: `./venv/Scripts/python.exe -m pip install pytest==8.3.4`

- [ ] **Step 4: Write the failing test**

Create `tests/__init__.py` (empty) and `tests/test_repository_hostaway_fields.py`:

```python
"""The five new Hostaway threading columns must survive a row -> TaskRecord read."""
from repository import repo


def _row(**overrides):
    """A minimal Supabase row; ai_suggested_* are required by _supabase_row_to_task."""
    row = {
        "id": "11111111-1111-1111-1111-111111111111",
        "task_name": "Hostaway: Κώστας - Arachova",
        "description": "δεν βρίσκω τα κλειδιά",
        "category": "Hostaway",
        "priority": "P1",
        "checklist": [],
        "ai_suggested_category": "Hostaway",
        "ai_suggested_priority": "P1",
    }
    row.update(overrides)
    return row


def test_threading_columns_are_read_from_the_row():
    task = repo._supabase_row_to_task(_row(
        hostaway_conversation_id="47342748",
        hostaway_last_message_at="2026-08-10 14:00:40",
        hostaway_message_count=3,
        hostaway_answered_at="2026-08-10 14:30:00",
        hostaway_thread="καλησπέρα σας\n---\nδεν βρίσκω τα κλειδιά",
    ))
    assert task.hostaway_conversation_id == "47342748"
    assert task.hostaway_last_message_at == "2026-08-10 14:00:40"
    assert task.hostaway_message_count == 3
    assert task.hostaway_answered_at == "2026-08-10 14:30:00"
    assert task.hostaway_thread == "καλησπέρα σας\n---\nδεν βρίσκω τα κλειδιά"


def test_a_non_hostaway_row_defaults_cleanly():
    """Every existing task has these columns null — that must not raise."""
    task = repo._supabase_row_to_task(_row(category="Personal"))
    assert task.hostaway_conversation_id is None
    assert task.hostaway_message_count == 0
    assert task.hostaway_thread is None
```

- [ ] **Step 5: Run it and watch it fail**

Run: `./venv/Scripts/python.exe -m pytest tests/test_repository_hostaway_fields.py -v`
Expected: FAIL — `AttributeError: 'TaskRecord' object has no attribute 'hostaway_conversation_id'`

- [ ] **Step 6: Add the fields to the model**

In `models.py`, replace the `hostaway_created_at` / `hostaway_last_notified_at` block at the end of `TaskRecord` with:

```python
    # Hostaway escalation tracking (only set on category="Hostaway" tasks).
    # hostaway_last_notified_at advances every time an escalation notification
    # fires, so "time since last notification" can be compared against the
    # priority's interval on each scheduler tick.
    hostaway_created_at: Optional[str] = None
    hostaway_last_notified_at: Optional[str] = None

    # Hostaway message threading (2026-08-10). hostaway_last_message_at holds
    # HOSTAWAY's message date, never a server clock read — that is what makes
    # the 90-second window independent of when the webhook reached us.
    # hostaway_thread accumulates the raw guest messages so the whole thread
    # can be re-classified; hostaway_answered_at marks a P1 that was replied
    # to (escalation stops, the task stays open).
    hostaway_conversation_id: Optional[str] = None
    hostaway_last_message_at: Optional[str] = None
    hostaway_message_count: int = 0
    hostaway_answered_at: Optional[str] = None
    hostaway_thread: Optional[str] = None
```

- [ ] **Step 7: Read them in the repository**

In `repository.py`, inside `_supabase_row_to_task`'s `return TaskRecord(...)`, after the `hostaway_last_notified_at=` line:

```python
            hostaway_conversation_id=row.get("hostaway_conversation_id"),
            hostaway_last_message_at=row.get("hostaway_last_message_at"),
            hostaway_message_count=_get(row, "hostaway_message_count", 0),
            hostaway_answered_at=row.get("hostaway_answered_at"),
            hostaway_thread=row.get("hostaway_thread"),
```

- [ ] **Step 8: Run the tests**

Run: `./venv/Scripts/python.exe -m pytest tests/ -v`
Expected: 2 passed.

- [ ] **Step 9: Commit**

```bash
git add models.py repository.py tests/ requirements-dev.txt docs/migrations/
git commit -m "Hostaway threading: the five columns, and a test harness to hang tests on"
```

---

### Task 2: The threading decision — a pure function

**Files:**
- Create: `hostaway_threading.py`
- Create: `tests/test_hostaway_threading.py`

**Interfaces:**
- Produces:
  - `THREAD_WINDOW_SECONDS: int = 90`
  - `parse_hostaway_datetime(value: Optional[str]) -> Optional[datetime]`
  - `should_append_to_thread(last_message_at: Optional[str], new_message_at: Optional[str], window_seconds: int = THREAD_WINDOW_SECONDS) -> bool`
  - `higher_priority(a: str, b: str) -> str`
  - `is_more_urgent(new_priority: Optional[str], old_priority: Optional[str]) -> bool`

- [ ] **Step 1: Write the failing test**

Create `tests/test_hostaway_threading.py`. Every gap below is a real pair measured from the owner's account (spec §1.3):

```python
"""The 90-second window. Cases are real message pairs from the live account."""
import hostaway_threading as ht


def test_the_measured_bursts_all_append():
    # «καλησπέρα σας» -> «Ηθελα να ρωτήσω αν η αυλή...» (0.4 min)
    assert ht.should_append_to_thread("2026-08-10 14:00:00", "2026-08-10 14:00:24") is True
    # «βρίσκεται κοντά στο κέντρο ;» -> «του νησιού» (0.1 min)
    assert ht.should_append_to_thread("2026-08-10 14:00:00", "2026-08-10 14:00:06") is True
    # «...να μας αλλάξετε...» -> «Πετσέτες εννοώ συγγνώμη» (0.2 min)
    assert ht.should_append_to_thread("2026-08-10 14:00:00", "2026-08-10 14:00:12") is True


def test_two_real_problems_do_not_merge():
    # «den exv mpataria» -> «δεν εχω νερο» (2.4 min) — must be two tasks
    assert ht.should_append_to_thread("2026-08-10 14:00:00", "2026-08-10 14:02:24") is False


def test_the_boundary_is_inclusive_at_90_seconds():
    assert ht.should_append_to_thread("2026-08-10 14:00:00", "2026-08-10 14:01:30") is True
    assert ht.should_append_to_thread("2026-08-10 14:00:00", "2026-08-10 14:01:31") is False


def test_a_task_with_no_previous_message_never_appends():
    assert ht.should_append_to_thread(None, "2026-08-10 14:00:00") is False


def test_an_unparseable_date_fails_towards_a_new_task():
    """A new task is the safe direction: noisy, but nothing is ever lost."""
    assert ht.should_append_to_thread("not a date", "2026-08-10 14:00:00") is False
    assert ht.should_append_to_thread("2026-08-10 14:00:00", "") is False


def test_a_message_older_than_the_last_one_does_not_append():
    """Out-of-order delivery must not produce a negative gap that looks tiny."""
    assert ht.should_append_to_thread("2026-08-10 14:00:00", "2026-08-10 13:59:00") is False


def test_higher_priority_picks_the_more_urgent():
    assert ht.higher_priority("P3", "P1") == "P1"
    assert ht.higher_priority("P1", "P3") == "P1"
    assert ht.higher_priority("P2", "P3") == "P2"
    assert ht.higher_priority("P2", "P2") == "P2"


def test_higher_priority_survives_junk():
    assert ht.higher_priority("P3", "banana") == "P3"
    assert ht.higher_priority(None, "P2") == "P2"


def test_is_more_urgent_only_looks_upwards():
    """The burst re-notification fires on an ESCALATION, never on a change."""
    assert ht.is_more_urgent("P1", "P3") is True
    assert ht.is_more_urgent("P2", "P3") is True
    assert ht.is_more_urgent("P3", "P3") is False
    assert ht.is_more_urgent("P3", "P1") is False
    assert ht.is_more_urgent(None, "P3") is False
```

- [ ] **Step 2: Run it and watch it fail**

Run: `./venv/Scripts/python.exe -m pytest tests/test_hostaway_threading.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'hostaway_threading'`

- [ ] **Step 3: Write the module**

Create `hostaway_threading.py`:

```python
"""
Pure decisions for the Hostaway message-threading feature. No I/O, no AI,
no clock reads — every function here is a comparison over values it was
handed, which is exactly why the feature can promise zero fail.

See docs/superpowers/specs/2026-08-10-hostaway-threading-design.md. The
project's standing lesson applies (DECISIONS.md, "a rule the code can
enforce does not belong in the system instruction"): the model summarises
and prioritises, and decides nothing about identity or authorship.
"""

import logging
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)

# Measured, not chosen: across 141 consecutive guest-message pairs, every
# burst was under 42 seconds, nothing at all fell between 1 and 2 minutes,
# and the earliest genuinely-separate second problem was 2.4 minutes out.
# 90 seconds sits in the empty band. Spec §1.3.
THREAD_WINDOW_SECONDS = 90

# Hostaway sends "2026-08-10 14:00:00" — no timezone, listing-local. Both
# sides of every comparison come from the same conversation, so naive
# datetimes are correct here and converting would invent precision.
_HOSTAWAY_DATE_FORMAT = "%Y-%m-%d %H:%M:%S"

_PRIORITY_RANK = {"P1": 3, "P2": 2, "P3": 1}


def parse_hostaway_datetime(value: Optional[str]) -> Optional[datetime]:
    """Parses Hostaway's message date. Returns None on anything unusable."""
    if not value:
        return None
    try:
        return datetime.strptime(value, _HOSTAWAY_DATE_FORMAT)
    except (ValueError, TypeError):
        logger.warning(f"[hostaway threading] Unparseable date: {value!r}")
        return None


def should_append_to_thread(
    last_message_at: Optional[str],
    new_message_at: Optional[str],
    window_seconds: int = THREAD_WINDOW_SECONDS,
) -> bool:
    """
    True when the new message belongs to the same burst as the previous one.

    Every failure mode returns False, i.e. "make a new task". That is the
    safe direction: a spurious extra task is today's behaviour and merely
    noisy, whereas wrongly appending buries a real problem inside a task
    the user may already consider handled.
    """
    previous = parse_hostaway_datetime(last_message_at)
    current = parse_hostaway_datetime(new_message_at)
    if previous is None or current is None:
        return False

    gap = (current - previous).total_seconds()
    # A negative gap means out-of-order delivery, not a tight burst.
    return 0 <= gap <= window_seconds


def higher_priority(a: Optional[str], b: Optional[str]) -> str:
    """
    The more urgent of two priorities, so a thread can only ever escalate.
    Unknown values rank lowest; if both are unknown, falls back to P3.
    """
    rank_a = _PRIORITY_RANK.get(a or "", 0)
    rank_b = _PRIORITY_RANK.get(b or "", 0)
    if rank_a == 0 and rank_b == 0:
        return "P3"
    return a if rank_a >= rank_b else b


def is_more_urgent(new_priority: Optional[str], old_priority: Optional[str]) -> bool:
    """
    True only when the priority moved UP.

    The burst re-notification hangs off this. Asking "did it change?" would
    give the same answer today, because higher_priority() cannot return a
    downgrade — but that is a property of another function, and if it ever
    stops holding, "changed" would start firing pushes on de-escalations.
    The condition says what it means instead.
    """
    return _PRIORITY_RANK.get(new_priority or "", 0) > _PRIORITY_RANK.get(old_priority or "", 0)
```

- [ ] **Step 4: Run the tests**

Run: `./venv/Scripts/python.exe -m pytest tests/test_hostaway_threading.py -v`
Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add hostaway_threading.py tests/test_hostaway_threading.py
git commit -m "The 90-second window, as a pure function with the measured pairs as tests"
```

---

### Task 3: Telling a human reply from an automation

**Files:**
- Modify: `hostaway_threading.py`
- Modify: `tests/test_hostaway_threading.py`

**Interfaces:**
- Produces: `is_human_reply(message: dict) -> bool`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_hostaway_threading.py`. All three payload shapes are real, captured from the live account (spec §1.1–1.2):

```python
def test_a_hostaway_automation_is_not_a_human_reply():
    """The account's own 'arrival' automation: communicationId set, userId null."""
    assert ht.is_human_reply({
        "isIncoming": 0, "userId": None, "communicationId": 395182,
        "communicationEvent": "arrival",
    }) is False


def test_the_auto_reply_is_not_a_human_reply():
    """
    THE trap. communicationEvent 'messageReceived' fires after EVERY guest
    message — treating it as a reply would close every task on creation.
    """
    assert ht.is_human_reply({
        "isIncoming": 0, "userId": None, "communicationId": 368747,
        "communicationEvent": "messageReceived",
    }) is False


def test_a_third_party_automation_is_not_a_human_reply():
    """
    GuestArrive: communicationId null AND userId null. This is why the
    signal is userId — communicationId alone would let this through.
    """
    assert ht.is_human_reply({
        "isIncoming": 0, "userId": None, "communicationId": None,
    }) is False


def test_a_typed_reply_is_a_human_reply():
    assert ht.is_human_reply({
        "isIncoming": 0, "userId": 990952, "communicationId": None,
    }) is True


def test_an_incoming_guest_message_is_never_a_reply():
    assert ht.is_human_reply({"isIncoming": 1, "userId": 990952}) is False


def test_a_missing_userId_key_is_not_a_reply():
    assert ht.is_human_reply({"isIncoming": 0}) is False
```

- [ ] **Step 2: Run it and watch it fail**

Run: `./venv/Scripts/python.exe -m pytest tests/test_hostaway_threading.py -v`
Expected: FAIL — `AttributeError: module 'hostaway_threading' has no attribute 'is_human_reply'`

- [ ] **Step 3: Implement it**

Append to `hostaway_threading.py`:

```python
def is_human_reply(message: dict) -> bool:
    """
    True only when a person typed this outgoing message.

    `userId` is the signal, and the alternative was measured and rejected.
    Across 25 conversations: 66 Hostaway automations, every one with
    userId null; 24 outgoing messages without a communicationId, 23 of them
    carrying userId 990952. The one that disagreed was a GuestArrive
    message — a third-party tool with NEITHER field set — so keying on
    communicationId would have let an automation close a task. userId
    excludes both kinds of automation with one check. Spec §1.2.

    Known limit, failing safe: a reply sent from the Airbnb/Booking app
    rather than through Hostaway may carry no userId. Then this returns
    False, the task stays open, and the user closes it by hand. The error
    direction is never "closed something that was not answered".
    """
    if message.get("isIncoming") != 0:
        return False
    return bool(message.get("userId"))
```

- [ ] **Step 4: Run the tests**

Run: `./venv/Scripts/python.exe -m pytest tests/ -v`
Expected: 17 passed.

- [ ] **Step 5: Commit**

```bash
git add hostaway_threading.py tests/test_hostaway_threading.py
git commit -m "userId is the human-reply signal, with the auto-reply trap as a test"
```

---

### Task 4: Repository — find and update a conversation's tasks

**Files:**
- Modify: `repository.py` (add after `update_hostaway_last_notified`, ~line 568)
- Create: `tests/test_repository_conversation_queries.py`

**Interfaces:**
- Produces:
  - `get_open_tasks_for_conversation(user_id: str, conversation_id: str) -> list[TaskRecord]`
  - `update_hostaway_thread_fields(user_id: str, record_id: str, updates: dict) -> None`

- [ ] **Step 1: Write the failing test**

These use a fake Supabase client, because the real one needs the network and the point is the query shape, not Supabase itself.

Create `tests/test_repository_conversation_queries.py`:

```python
"""The conversation lookup must be a scoped, filtered QUERY — not a full scan."""
import repository


class _FakeQuery:
    def __init__(self, sink, rows):
        self.sink, self.rows = sink, rows

    def select(self, *a):
        self.sink["select"] = a
        return self

    def eq(self, col, val):
        self.sink.setdefault("eq", []).append((col, val))
        return self

    def update(self, values):
        self.sink["update"] = values
        return self

    def order(self, col, desc=False):
        self.sink["order"] = (col, desc)
        return self

    def execute(self):
        return type("R", (), {"data": self.rows})()


class _FakeSupabase:
    def __init__(self, rows=None):
        self.calls = {}
        self.rows = rows or []

    def table(self, name):
        self.calls["table"] = name
        return _FakeQuery(self.calls, self.rows)


def _row(**overrides):
    row = {
        "id": "aaaaaaaa-0000-0000-0000-000000000001",
        "task_name": "Hostaway: Κώστας - Arachova",
        "description": "δεν βρίσκω τα κλειδιά",
        "category": "Hostaway",
        "priority": "P1",
        "checklist": [],
        "ai_suggested_category": "Hostaway",
        "ai_suggested_priority": "P1",
        "hostaway_conversation_id": "47342748",
    }
    row.update(overrides)
    return row


def test_lookup_filters_by_user_conversation_and_open_state(monkeypatch):
    fake = _FakeSupabase(rows=[_row()])
    monkeypatch.setattr(repository, "supabase", fake)

    tasks = repository.get_open_tasks_for_conversation("user-1", "47342748")

    assert fake.calls["table"] == "tasks"
    assert ("user_id", "user-1") in fake.calls["eq"]
    assert ("hostaway_conversation_id", "47342748") in fake.calls["eq"]
    assert ("is_completed", False) in fake.calls["eq"]
    assert ("is_rejected", False) in fake.calls["eq"]
    assert len(tasks) == 1
    assert tasks[0].hostaway_conversation_id == "47342748"


def test_lookup_returns_empty_when_nothing_matches(monkeypatch):
    monkeypatch.setattr(repository, "supabase", _FakeSupabase(rows=[]))
    assert repository.get_open_tasks_for_conversation("user-1", "999") == []


def test_lookup_never_raises(monkeypatch):
    """An inbound webhook must not 500 because a lookup failed."""
    class _Boom:
        def table(self, name):
            raise RuntimeError("supabase is down")

    monkeypatch.setattr(repository, "supabase", _Boom())
    assert repository.get_open_tasks_for_conversation("user-1", "47342748") == []


def test_update_scopes_to_user_and_record(monkeypatch):
    fake = _FakeSupabase()
    monkeypatch.setattr(repository, "supabase", fake)

    repository.update_hostaway_thread_fields(
        "user-1", "task-1", {"hostaway_message_count": 2, "priority": "P1"}
    )

    assert fake.calls["update"] == {"hostaway_message_count": 2, "priority": "P1"}
    assert ("id", "task-1") in fake.calls["eq"]
    assert ("user_id", "user-1") in fake.calls["eq"]


def test_update_with_no_changes_does_not_hit_the_database(monkeypatch):
    fake = _FakeSupabase()
    monkeypatch.setattr(repository, "supabase", fake)
    repository.update_hostaway_thread_fields("user-1", "task-1", {})
    assert fake.calls == {}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `./venv/Scripts/python.exe -m pytest tests/test_repository_conversation_queries.py -v`
Expected: FAIL — `AttributeError: module 'repository' has no attribute 'get_open_tasks_for_conversation'`

- [ ] **Step 3: Implement both functions**

In `repository.py`, directly after `update_hostaway_last_notified`:

```python
def get_open_tasks_for_conversation(user_id: str, conversation_id: str) -> list[TaskRecord]:
    """
    Every open (not completed, not rejected) task belonging to one Hostaway
    conversation, newest first, scoped to user_id.

    Deliberately a filtered QUERY rather than the get_tasks_for_user()
    scan its neighbours use: this runs on every inbound webhook, and that
    function is already known to fetch ~124 rows in ~930 ms to use five
    (CURRENT_TASK.md). The partial index on hostaway_conversation_id makes
    this a handful of rows.

    Never raises — a lookup failure must not turn into a 500 on a webhook
    Hostaway would then retry or disable. Returning [] degrades to today's
    behaviour: a new task gets created.
    """
    try:
        response = (
            supabase.table("tasks")
            .select("*")
            .eq("user_id", user_id)
            .eq("hostaway_conversation_id", conversation_id)
            .eq("is_completed", False)
            .eq("is_rejected", False)
            .order("created_at", desc=True)
            .execute()
        )
        return [repo._supabase_row_to_task(row) for row in (response.data or [])]
    except Exception as e:
        logger.warning(
            f"Failed to load open tasks for conversation {conversation_id} "
            f"(user {user_id}): {e}"
        )
        return []


def update_hostaway_thread_fields(user_id: str, record_id: str, updates: dict) -> None:
    """
    Writes threading fields (thread text, counts, priority, answered/notified
    timestamps) onto one task, scoped to user_id. A no-op when there is
    nothing to change, so callers can build the dict conditionally.
    """
    if not updates:
        return
    supabase.table("tasks").update(updates).eq("id", record_id).eq("user_id", user_id).execute()
```

- [ ] **Step 4: Run the tests**

Run: `./venv/Scripts/python.exe -m pytest tests/ -v`
Expected: 22 passed.

- [ ] **Step 5: Commit**

```bash
git add repository.py tests/test_repository_conversation_queries.py
git commit -m "Conversation lookup as a filtered query, and a threading-field writer"
```

---

### Task 5: The webhook appends an incoming message to an open thread

**Files:**
- Modify: `main.py:833-930` (the `hostaway_webhook` handler)
- Create: `tests/test_webhook_incoming_threading.py`

**Interfaces:**
- Consumes: `hostaway_threading.should_append_to_thread`, `.higher_priority`; `repository.get_open_tasks_for_conversation`, `.update_hostaway_thread_fields`
- Produces: `main._append_to_hostaway_thread(user_id, task, message_body, message_date, classification) -> dict` (the update dict it wrote, for tests)

- [ ] **Step 1: Write the failing test**

Create `tests/test_webhook_incoming_threading.py`:

```python
"""Appending a burst message to an open task, and re-classifying the thread."""
import main
from models import TaskRecord


def _task(**overrides):
    fields = dict(
        task_name="Hostaway: Κώστας - Arachova",
        description="Καλησπέρα.\n\nProperty: Arachova\nDates: ? → ?\n\nOriginal message: καλησπέρα σας",
        category="Hostaway",
        priority="P3",
        checklist=[],
        ai_suggested_category="Hostaway",
        ai_suggested_priority="P3",
        record_id="task-1",
        hostaway_conversation_id="47342748",
        hostaway_last_message_at="2026-08-10 14:00:00",
        hostaway_message_count=1,
        hostaway_thread="καλησπέρα σας",
    )
    fields.update(overrides)
    return TaskRecord(**fields)


def test_append_grows_the_thread_and_the_count(monkeypatch):
    written = {}
    monkeypatch.setattr(main.repository, "update_hostaway_thread_fields",
                        lambda u, r, updates: written.update(updates))

    main._append_to_hostaway_thread(
        "user-1", _task(), "δεν βρίσκω τα κλειδιά", "2026-08-10 14:00:40",
        {"summary": "Ο πελάτης δεν βρίσκει τα κλειδιά.", "priority": "P1"},
    )

    assert written["hostaway_thread"] == "καλησπέρα σας\n---\nδεν βρίσκω τα κλειδιά"
    assert written["hostaway_message_count"] == 2
    assert written["hostaway_last_message_at"] == "2026-08-10 14:00:40"


def test_append_escalates_the_priority_but_never_lowers_it(monkeypatch):
    written = {}
    monkeypatch.setattr(main.repository, "update_hostaway_thread_fields",
                        lambda u, r, updates: written.update(updates))

    main._append_to_hostaway_thread(
        "user-1", _task(priority="P1"), "και μια ερώτηση", "2026-08-10 14:00:40",
        {"summary": "Μια ερώτηση.", "priority": "P3"},
    )
    assert written["priority"] == "P1"


def test_append_resets_the_escalation_clock(monkeypatch):
    written = {}
    monkeypatch.setattr(main.repository, "update_hostaway_thread_fields",
                        lambda u, r, updates: written.update(updates))

    main._append_to_hostaway_thread(
        "user-1", _task(), "κάτι", "2026-08-10 14:00:40",
        {"summary": "Κάτι.", "priority": "P3"},
    )
    assert written["hostaway_last_notified_at"] is not None


def test_the_new_summary_replaces_the_old_one_in_the_description(monkeypatch):
    written = {}
    monkeypatch.setattr(main.repository, "update_hostaway_thread_fields",
                        lambda u, r, updates: written.update(updates))

    main._append_to_hostaway_thread(
        "user-1", _task(), "δεν βρίσκω τα κλειδιά", "2026-08-10 14:00:40",
        {"summary": "Ο πελάτης δεν βρίσκει τα κλειδιά.", "priority": "P1"},
    )
    assert written["description"].startswith("Ο πελάτης δεν βρίσκει τα κλειδιά.")
    # both messages survive in the description
    assert "καλησπέρα σας" in written["description"]
    assert "δεν βρίσκω τα κλειδιά" in written["description"]
```

- [ ] **Step 2: Run it and watch it fail**

Run: `./venv/Scripts/python.exe -m pytest tests/test_webhook_incoming_threading.py -v`
Expected: FAIL — `AttributeError: module 'main' has no attribute '_append_to_hostaway_thread'`

- [ ] **Step 3: Add the append helper to `main.py`**

Add above `hostaway_webhook`, and add `import hostaway_threading` to the imports at the top of `main.py`:

```python
HOSTAWAY_THREAD_SEPARATOR = "\n---\n"


def _append_to_hostaway_thread(
    user_id: str,
    task,
    message_body: str,
    message_date: str,
    classification: dict,
) -> dict:
    """
    Folds a burst message into an existing open task and re-classifies the
    whole thread. Returns the update dict that was written.

    The WHOLE thread is re-classified, not just the new message, because
    the messages being merged are precisely the ones that mean nothing
    alone — «του νησιού», «Πετσέτες εννοώ συγγνώμη». The call count is
    unchanged from today (one per message); only ~23 extra tokens per
    burst are spent re-sending it. Spec §3.1.

    Priority can only ever escalate: a follow-up «και μια ερώτηση» must not
    downgrade a P1 thread about missing keys.
    """
    thread = task.hostaway_thread or ""
    new_thread = f"{thread}{HOSTAWAY_THREAD_SEPARATOR}{message_body}" if thread else message_body
    new_priority = hostaway_threading.higher_priority(task.priority, classification["priority"])

    updates = {
        "hostaway_thread": new_thread,
        "hostaway_message_count": (task.hostaway_message_count or 0) + 1,
        "hostaway_last_message_at": message_date,
        "priority": new_priority,
        "description": f"{classification['summary']}\n\nΜηνύματα:\n{new_thread}",
        # A new message restarts the escalation cycle — the clock measures
        # "how long since we nagged", and we are about to notify (or have
        # just deliberately not, on an unchanged priority).
        "hostaway_last_notified_at": datetime.now(ZoneInfo("Europe/Athens")).isoformat(),
    }
    repository.update_hostaway_thread_fields(user_id, task.record_id, updates)
    logging.info(
        f"[hostaway webhook] Appended to thread {task.hostaway_conversation_id} "
        f"(task {task.record_id}, {updates['hostaway_message_count']} messages, "
        f"priority {task.priority} -> {new_priority})"
    )
    return updates
```

- [ ] **Step 4: Run the tests**

Run: `./venv/Scripts/python.exe -m pytest tests/test_webhook_incoming_threading.py -v`
Expected: 4 passed.

- [ ] **Step 5: Wire it into the webhook**

In `hostaway_webhook`, after `message_body` is read and before the enrichment block, capture the two new payload fields:

```python
    conversation_id = data.get("conversationId")
    message_date = data.get("date")
```

Then replace the block that runs from `classification = hostaway_integration.classify_message(...)` through the `service.create_task_manual(...)` call with:

```python
    # Is this message part of a burst already captured by an open task?
    # The comparison uses HOSTAWAY's dates on both sides, never now() — so
    # it behaves identically whether the webhook was instant or the message
    # was picked up minutes later. Spec §3.1.
    existing_task = None
    if conversation_id:
        for candidate in repository.get_open_tasks_for_conversation(user_id, str(conversation_id)):
            if hostaway_threading.should_append_to_thread(
                candidate.hostaway_last_message_at, message_date
            ):
                existing_task = candidate
                break

    # Classify the whole thread when appending, the single message otherwise.
    text_to_classify = message_body
    if existing_task:
        previous = existing_task.hostaway_thread or ""
        text_to_classify = (
            f"{previous}{HOSTAWAY_THREAD_SEPARATOR}{message_body}" if previous else message_body
        )

    try:
        classification = hostaway_integration.classify_message(text_to_classify, user_id=user_id)
    except Exception as e:
        logging.error(f"[hostaway webhook] Classification failed unexpectedly: {e}")
        classification = {"summary": message_body[:200], "priority": "P1"}

    if existing_task:
        previous_priority = existing_task.priority
        updates = _append_to_hostaway_thread(
            user_id, existing_task, message_body, message_date, classification
        )
        # One push per message is the rule (spec §4) — but inside a burst,
        # three pushes in forty seconds for one thought IS the noise this
        # feature exists to remove. So the burst notifies once, and again
        # ONLY on an escalation: decided by the owner, 2026-08-10.
        if hostaway_threading.is_more_urgent(updates["priority"], previous_priority):
            emoji = {"P1": "🔴", "P2": "🟡", "P3": "🟢"}.get(updates["priority"], "")
            try:
                service.send_push_to_user(
                    user_id,
                    title=f"{emoji} {existing_task.task_name}",
                    body=classification["summary"],
                )
            except Exception as e:
                logging.error(f"[hostaway webhook] Failed to send escalation notification: {e}")
        return {"status": "ok", "threaded_into": existing_task.record_id}

    # ── no open burst: create a task, exactly as before ──
```

Keep the existing creation code below that comment, and extend its `create_task_manual` fields dict with:

```python
            "hostaway_conversation_id": str(conversation_id) if conversation_id else None,
            "hostaway_last_message_at": message_date,
            "hostaway_message_count": 1,
            "hostaway_thread": message_body,
```

- [ ] **Step 6: Pass the new fields through `create_task_manual`**

In `services.py`, inside `create_task_manual`'s `TaskRecord(...)` construction, after `hostaway_last_notified_at=...`:

```python
            hostaway_conversation_id=fields.get("hostaway_conversation_id"),
            hostaway_last_message_at=fields.get("hostaway_last_message_at"),
            hostaway_message_count=fields.get("hostaway_message_count", 0),
            hostaway_thread=fields.get("hostaway_thread"),
```

- [ ] **Step 7: Run the whole suite**

Run: `./venv/Scripts/python.exe -m pytest tests/ -v`
Expected: 26 passed.

- [ ] **Step 8: Commit**

```bash
git add main.py services.py tests/test_webhook_incoming_threading.py
git commit -m "Burst messages fold into one task instead of three"
```

---

### Task 6: A human reply completes (P2/P3) or silences (P1)

**Files:**
- Modify: `main.py` (the `isIncoming != 1` early return, currently line ~853)
- Create: `tests/test_webhook_outgoing_reply.py`

**Interfaces:**
- Consumes: `hostaway_threading.is_human_reply`, `repository.get_open_tasks_for_conversation`
- Produces: `main._handle_outgoing_hostaway_message(user_id, data) -> dict`

- [ ] **Step 1: Write the failing test**

Create `tests/test_webhook_outgoing_reply.py`:

```python
"""An outgoing message closes a task only when a human wrote it."""
import main
from models import TaskRecord


def _task(record_id="task-1", priority="P3"):
    return TaskRecord(
        task_name="Hostaway: Κώστας - Arachova",
        description="δεν βρίσκω τα κλειδιά",
        category="Hostaway", priority=priority, checklist=[],
        ai_suggested_category="Hostaway", ai_suggested_priority=priority,
        record_id=record_id, hostaway_conversation_id="47342748",
    )


def _wire(monkeypatch, open_tasks):
    calls = {"updates": [], "pushes": []}
    monkeypatch.setattr(main.repository, "get_open_tasks_for_conversation",
                        lambda u, c: open_tasks)
    monkeypatch.setattr(main.repository, "update_hostaway_thread_fields",
                        lambda u, r, updates: calls["updates"].append((r, updates)))
    monkeypatch.setattr(main.service, "send_push_to_user",
                        lambda u, **kw: calls["pushes"].append(kw))
    return calls


def test_the_auto_reply_changes_nothing(monkeypatch):
    """THE trap: 'we received your message and will reply shortly'."""
    calls = _wire(monkeypatch, [_task()])
    result = main._handle_outgoing_hostaway_message("user-1", {
        "isIncoming": 0, "userId": None, "communicationId": 368747,
        "communicationEvent": "messageReceived", "conversationId": 47342748,
    })
    assert result["status"] == "ignored"
    assert calls["updates"] == []


def test_a_guestarrive_message_changes_nothing(monkeypatch):
    calls = _wire(monkeypatch, [_task()])
    main._handle_outgoing_hostaway_message("user-1", {
        "isIncoming": 0, "userId": None, "communicationId": None,
        "conversationId": 47342748,
    })
    assert calls["updates"] == []


def test_a_human_reply_completes_a_p3_task(monkeypatch):
    calls = _wire(monkeypatch, [_task(priority="P3")])
    main._handle_outgoing_hostaway_message("user-1", {
        "isIncoming": 0, "userId": 990952, "conversationId": 47342748,
    })
    record_id, updates = calls["updates"][0]
    assert record_id == "task-1"
    assert updates["is_completed"] is True


def test_a_human_reply_does_NOT_complete_a_p1_task(monkeypatch):
    """Replying is not fixing. The P1 stops nagging and stays open."""
    calls = _wire(monkeypatch, [_task(priority="P1")])
    main._handle_outgoing_hostaway_message("user-1", {
        "isIncoming": 0, "userId": 990952, "conversationId": 47342748,
    })
    _, updates = calls["updates"][0]
    assert "is_completed" not in updates
    assert updates["hostaway_answered_at"] is not None


def test_two_open_tasks_are_left_alone_and_reported(monkeypatch):
    """One reply cannot be attributed to one of two tasks — so ask."""
    calls = _wire(monkeypatch, [_task("task-1"), _task("task-2")])
    result = main._handle_outgoing_hostaway_message("user-1", {
        "isIncoming": 0, "userId": 990952, "conversationId": 47342748,
    })
    assert calls["updates"] == []
    assert len(calls["pushes"]) == 1
    assert result["status"] == "ambiguous"


def test_a_reply_with_no_open_task_is_harmless(monkeypatch):
    calls = _wire(monkeypatch, [])
    result = main._handle_outgoing_hostaway_message("user-1", {
        "isIncoming": 0, "userId": 990952, "conversationId": 47342748,
    })
    assert calls["updates"] == []
    assert result["status"] == "ok"
```

- [ ] **Step 2: Run it and watch it fail**

Run: `./venv/Scripts/python.exe -m pytest tests/test_webhook_outgoing_reply.py -v`
Expected: FAIL — `AttributeError: module 'main' has no attribute '_handle_outgoing_hostaway_message'`

- [ ] **Step 3: Implement the handler**

Add to `main.py` next to `_append_to_hostaway_thread`:

```python
def _handle_outgoing_hostaway_message(user_id: str, data: dict) -> dict:
    """
    An outgoing message arrived. Close the task it answers — if a human
    wrote it, and if there is exactly one task it could be answering.

    Both guards are load-bearing. The account runs a `messageReceived`
    automation that fires after EVERY guest message, so "an outgoing
    message means the task is handled" would close every task within
    seconds of creating it, silently. Spec §1.1.
    """
    if not hostaway_threading.is_human_reply(data):
        return {"status": "ignored", "reason": "automated outgoing message"}

    conversation_id = data.get("conversationId")
    if not conversation_id:
        return {"status": "ignored", "reason": "outgoing message without a conversationId"}

    open_tasks = repository.get_open_tasks_for_conversation(user_id, str(conversation_id))
    if not open_tasks:
        return {"status": "ok", "note": "no open task for this conversation"}

    if len(open_tasks) > 1:
        # Which of the two did the reply answer? That is a judgement, so it
        # is not made — the user is told and decides. Spec §3.2.
        try:
            service.send_push_to_user(
                user_id,
                title="Απάντησες στον πελάτη",
                body=f"{len(open_tasks)} tasks αυτής της συζήτησης είναι ακόμα ανοιχτά.",
            )
        except Exception as e:
            logging.error(f"[hostaway webhook] Failed to send ambiguity notice: {e}")
        return {"status": "ambiguous", "open_tasks": len(open_tasks)}

    task = open_tasks[0]
    now_str = datetime.now(ZoneInfo("Europe/Athens")).isoformat()

    if task.priority == "P1":
        # "I'm coming in 20 minutes" is an answer, not a fixed problem.
        # Stop nagging; leave it on the list until a human closes it.
        updates = {"hostaway_answered_at": now_str}
    else:
        updates = {"is_completed": True, "hostaway_answered_at": now_str}

    repository.update_hostaway_thread_fields(user_id, task.record_id, updates)
    logging.info(
        f"[hostaway webhook] Human reply on conversation {conversation_id}: "
        f"task {task.record_id} ({task.priority}) -> "
        f"{'answered, left open' if task.priority == 'P1' else 'completed'}"
    )
    return {"status": "ok", "task": task.record_id}
```

- [ ] **Step 4: Replace the silent early return in the webhook**

In `hostaway_webhook`, replace:

```python
    if data.get("isIncoming") != 1:
        return {"status": "ignored", "reason": "not an incoming guest message"}
```

with:

```python
    if data.get("isIncoming") != 1:
        # Was silently dropped until 2026-08-10. An outgoing message is how
        # we learn the conversation was answered — and the log line matters
        # independently: it is the only evidence of whether Hostaway fires
        # this webhook for outgoing messages at all (spec §6).
        logging.info(
            f"[hostaway webhook] Outgoing message: conversation="
            f"{data.get('conversationId')} userId={data.get('userId')} "
            f"communicationId={data.get('communicationId')} "
            f"communicationEvent={data.get('communicationEvent')}"
        )
        user_id = hostaway_integration.get_user_id_for_hostaway_account(payload.get("accountId"))
        try:
            return _handle_outgoing_hostaway_message(user_id, data)
        except Exception as e:
            logging.error(f"[hostaway webhook] Outgoing handling failed: {e}")
            return {"status": "error", "note": "outgoing handling failed, see logs"}
```

- [ ] **Step 5: Run the whole suite**

Run: `./venv/Scripts/python.exe -m pytest tests/ -v`
Expected: 32 passed.

- [ ] **Step 6: Commit**

```bash
git add main.py tests/test_webhook_outgoing_reply.py
git commit -m "Replying closes the task — unless a robot sent it, or a P1"
```

---

### Task 7: Escalation stops on an answered P1

**Files:**
- Modify: `services.py:473-509` (`_check_hostaway_escalations`)
- Create: `tests/test_hostaway_escalation_answered.py`

**Interfaces:**
- Consumes: `TaskRecord.hostaway_answered_at`

- [ ] **Step 1: Write the failing test**

Create `tests/test_hostaway_escalation_answered.py`:

```python
"""An answered P1 stays on the list but stops nagging."""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import services
from models import TaskRecord


def _task(answered_at=None):
    long_ago = (datetime.now(ZoneInfo("Europe/Athens")) - timedelta(hours=9)).isoformat()
    return TaskRecord(
        task_name="Hostaway: Κώστας - Arachova",
        description="δεν βρίσκω τα κλειδιά",
        category="Hostaway", priority="P1", checklist=[],
        ai_suggested_category="Hostaway", ai_suggested_priority="P1",
        record_id="task-1",
        hostaway_last_notified_at=long_ago,
        hostaway_answered_at=answered_at,
    )


def _run(monkeypatch, task):
    sent = []
    monkeypatch.setattr(services.repository, "get_active_hostaway_tasks", lambda u, tasks=None: [task])
    monkeypatch.setattr(services.repository, "update_hostaway_last_notified", lambda *a: None)
    svc = services.TaskService.__new__(services.TaskService)
    monkeypatch.setattr(svc, "send_push_to_user", lambda u, **kw: sent.append(kw), raising=False)
    result = svc._check_hostaway_escalations("user-1", datetime.now(ZoneInfo("Europe/Athens")), [])
    return sent, result


def test_an_unanswered_p1_still_escalates(monkeypatch):
    sent, result = _run(monkeypatch, _task(answered_at=None))
    assert result["escalations_sent"] == 1
    assert len(sent) == 1


def test_an_answered_p1_does_not_escalate(monkeypatch):
    sent, result = _run(monkeypatch, _task(answered_at="2026-08-10 14:30:00"))
    assert result["escalations_sent"] == 0
    assert sent == []
```

- [ ] **Step 2: Run it and watch it fail**

Run: `./venv/Scripts/python.exe -m pytest tests/test_hostaway_escalation_answered.py -v`
Expected: FAIL — `test_an_answered_p1_does_not_escalate` sends 1 escalation.

- [ ] **Step 3: Add the guard**

In `services.py`'s `_check_hostaway_escalations`, immediately inside `for task in hostaway_tasks:` and before the `hostaway_last_notified_at` check:

```python
            if task.hostaway_answered_at:
                # A human replied to this conversation. On a P1 the task
                # deliberately stays open (replying is not fixing — see the
                # threading spec §3.2), but it must stop nagging.
                continue
```

- [ ] **Step 4: Run the suite**

Run: `./venv/Scripts/python.exe -m pytest tests/ -v`
Expected: 34 passed.

- [ ] **Step 5: Commit**

```bash
git add services.py tests/test_hostaway_escalation_answered.py
git commit -m "An answered P1 stops escalating without leaving the list"
```

---

### Task 8: The conversation link and the message count on the card

**Files:**
- Modify: `frontend/src/components/TaskCard.jsx`
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/el.json`

**Interfaces:**
- Consumes: `task.hostaway_conversation_id`, `task.hostaway_message_count`, `task.hostaway_answered_at` (already serialised by `TaskRecord`, so no `api.js` change is needed)

- [ ] **Step 1: Add the translation keys**

In `frontend/src/locales/en.json`, inside the `task` object:

```json
    "hostaway_open_conversation": "Open in Hostaway",
    "hostaway_message_count": "{{count}} messages",
    "hostaway_answered": "Replied — still open",
```

In `frontend/src/locales/el.json`, inside the `task` object:

```json
    "hostaway_open_conversation": "Άνοιγμα στη Hostaway",
    "hostaway_message_count": "{{count}} μηνύματα",
    "hostaway_answered": "Απαντήθηκε — ακόμα ανοιχτό",
```

- [ ] **Step 2: Add the constant and the block to `TaskCard.jsx`**

Near the other module-level constants at the top of `TaskCard.jsx`:

```jsx
// Confirmed against a real inbox URL, not documentation: a conversation's
// id from the Hostaway API is exactly the id in this path.
const HOSTAWAY_INBOX_URL = 'https://dashboard.hostaway.com/messages/inbox';
```

Inside the **expanded** card, directly above the `✨` agent panel:

```jsx
{task.hostaway_conversation_id && (
  <div className="flex items-center gap-2 flex-wrap" data-no-toggle>
    <a
      href={`${HOSTAWAY_INBOX_URL}/${task.hostaway_conversation_id}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="text-sm underline"
    >
      {t('task.hostaway_open_conversation')}
    </a>
    {task.hostaway_message_count > 1 && (
      <span className="text-xs opacity-70">
        {t('task.hostaway_message_count', { count: task.hostaway_message_count })}
      </span>
    )}
    {task.hostaway_answered_at && (
      <span className="text-xs opacity-70">{t('task.hostaway_answered')}</span>
    )}
  </div>
)}
```

`data-no-toggle` keeps a click on the row from collapsing the card, matching the agent panel. `stopPropagation` on the anchor keeps the card from toggling when the link is followed.

- [ ] **Step 3: Verify the build and lint**

```bash
cd frontend && npm run build && npx eslint src/components/TaskCard.jsx
```

Expected: build succeeds; no NEW eslint errors (`CalendarView.jsx` has a known pre-existing one — leave it).

- [ ] **Step 4: Check both locales have the same keys**

```bash
cd frontend && node -e "const a=require('./src/locales/en.json').task,b=require('./src/locales/el.json').task;const m=Object.keys(a).filter(k=>!(k in b)).concat(Object.keys(b).filter(k=>!(k in a)));console.log(m.length?'MISMATCH: '+m:'locales in sync')"
```

Expected: `locales in sync`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/TaskCard.jsx frontend/src/locales/en.json frontend/src/locales/el.json
git commit -m "A Hostaway task links to its conversation"
```

---

### Task 9: Delete the stale warning, and update the docs

The probe that preceded this design confirmed `get_reservation_details`' guessed field names are correct. Unrelated to threading, free to fix, and it removes a warning that would otherwise mislead the next reader.

**Files:**
- Modify: `hostaway_integration.py:88-120`
- Modify: `docs/ARCHITECTURE.md`, `docs/DATABASE_SCHEMA.md`, `docs/FEATURES.md`, `docs/PROJECT_STATUS.md`, `docs/CURRENT_TASK.md`, `docs/BACKLOG.md`

- [ ] **Step 1: Replace the docstring**

In `hostaway_integration.py`, replace `get_reservation_details`' docstring with:

```python
    """
    Fetches guest name and stay dates from Hostaway's reservation object.

    Field names VERIFIED against a live API response (2026-08-10): the
    Reservation object really does carry guestName, arrivalDate and
    departureDate. This previously carried a warning that they were
    guessed from a naming pattern and had never been confirmed.
    """
```

Also delete the now-pointless verification log line in the same function:

```python
        logging.info(f"[hostaway] Raw reservation response for verification: {result}")
```

It dumps an entire reservation — including `guestEmail`, `phone` and `ccNumberEndingDigits` — into the application log on every guest message.

- [ ] **Step 2: Update the docs**

- `DATABASE_SCHEMA.md` — add the five columns to the `tasks` row list and the new partial index to the Indexes section.
- `ARCHITECTURE.md` — add `hostaway_threading.py` to "Backend files and responsibilities"; note that the webhook now handles outgoing messages; correct the `get_reservation_details` entry.
- `FEATURES.md` — describe threading, the link, and the reply behaviour, including that P1 does not auto-complete.
- `PROJECT_STATUS.md` — new entry, stating plainly what is verified (unit tests, live API probe) and what is not (never exercised against a real webhook delivery).
- `CURRENT_TASK.md` — replace with the verification checklist from Task 10.
- `BACKLOG.md` — mark the design entry as implemented.

- [ ] **Step 3: Commit**

```bash
git add hostaway_integration.py docs/
git commit -m "The reservation field names were right all along; docs catch up"
```

---

### Task 10: Live verification checklist

Nothing above proves the feature works against a real Hostaway delivery — the unit tests exercise the decisions, not the wiring. This is the pass that does, and it is the one the project has historically skipped (see the Gap 0–3 list in `CURRENT_TASK.md`).

- [ ] **Step 1: Confirm the open assumption from spec §6**

Search Render's logs for `[hostaway webhook] Outgoing message:` after replying to any guest through the Hostaway inbox.

- **A line appears** → the webhook fires for outgoing messages, and Task 6 works as designed. Record it in `PROJECT_STATUS.md`.
- **No line appears** → Hostaway does not send outgoing messages to this webhook. Feature 3 must move to the scheduler: on each tick, for every open Hostaway task with a `hostaway_conversation_id`, fetch `GET /v1/conversations/{id}/messages` and apply `is_human_reply` to the newest one. The decision functions are unchanged — only the trigger moves. **Write this outcome down either way; it is the last unknown in the design.**

- [ ] **Step 2: Threading, against a real burst**

From a test guest thread, send three messages under 40 seconds apart: a greeting, a name, then a real P1 problem. Confirm: **one** task, not three; `hostaway_message_count` = 3; the priority ended at P1; the description's summary describes the *problem*, not the greeting; and a push arrived on the priority change.

- [ ] **Step 3: Two problems stay two tasks**

Send one problem, wait **three minutes**, send a different one. Confirm two separate tasks.

- [ ] **Step 4: The auto-reply does not close anything**

Send a guest message and let the account's own `messageReceived` automation fire. Confirm the task is **still open** — this is the regression that matters most.

- [ ] **Step 5: A real reply closes a P3 and only silences a P1**

Reply by hand to a P3 thread → task completes. Reply by hand to a P1 thread → task stays open, shows "Απαντήθηκε — ακόμα ανοιχτό", and sends no further escalation for at least one full escalation interval.

- [ ] **Step 6: The link**

Open a threaded task, tap the link, confirm it lands on the right conversation. Check EN and EL.

- [ ] **Step 7: Record the results**

Update `PROJECT_STATUS.md` and `CURRENT_TASK.md` with what was actually observed — including anything that failed. Commit.

---

## Self-review

**Spec coverage** — §1 verification → Task 9 (warning) + Task 10 (open assumption). §2 schema → Task 1. §3.1 incoming → Tasks 2, 4, 5. §3.2 outgoing → Tasks 3, 4, 6, 7. §3.3 link → Task 8. §4 unchanged behaviour → asserted in Task 5's push logic and Task 10's checklist. §5 risks → Task 10. §6 pre-implementation → Task 1 Step 2, Task 10 Step 1.

**Deviations from the spec, both flagged above:** a fifth column (`hostaway_thread`), and re-classification updating `description`/`priority` rather than `task_name`.

**One conflict with the spec, resolved by the owner (2026-08-10):** inside a burst the app pushes only when the priority moves **up**, not on every message. The spec's §4 says "one push per incoming message, exactly as today". The owner chose escalation-only — three notifications in forty seconds for one thought is the noise this feature exists to remove. Enforced by `is_more_urgent()` rather than a `!=` comparison, so it cannot silently start firing on de-escalations if `higher_priority()` ever changes.
