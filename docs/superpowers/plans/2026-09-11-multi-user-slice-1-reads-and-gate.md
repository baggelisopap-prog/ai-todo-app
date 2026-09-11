# Multi-user slice 1: the tables, the two reads, and the write gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the multi-user foundations in place — three tables, two columns, two
distinct task reads and one write gate — while the app behaves **byte-for-byte identically**
for an account with no other members.

**Architecture:** `tasks.user_id` keeps its meaning ("who created this row"); nothing is
rewritten. A new `workspace_members` table adds a second axis. The single function that
reads a user's tasks is split in two on purpose — `visible_to` (screens) and `belongs_to`
(anything that rings a phone) — because it currently feeds both machines and widening it
would break reminders three ways, two of them silently. A new `access.py` becomes the one
place that answers "may this person write to this task", which today is copy-pasted into
19 of the 29 statements touching `tasks`.

**Tech Stack:** Python 3.12, FastAPI, Pydantic v2, Supabase (PostgREST via `supabase-py`),
pytest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-11-multi-user-workspace-sharing-design.md`

## Global Constraints

- **Migration before code, always.** `repository.update_task` sends its dict straight to
  Supabase and Supabase rejects a write containing an unknown column **wholesale**
  (PGRST204). This took down all task creation on 2026-09-01. The SQL in Task 1 is run by
  the owner in the Supabase SQL Editor **before** any code that touches the new columns is
  deployed.
- **Nothing is pushed.** `main` auto-deploys to Vercel and Render. Commit; do not push.
  The owner pushes.
- **Test baseline: 348 passed** (`./venv/Scripts/python.exe -m pytest tests/ -q`, run
  2026-09-11, `348 passed in 4.70s`). The number goes up, never down.
- **Frontend baseline: ESLint 12** (`cd frontend && npm run check`). No frontend changes
  in this slice.
- **Evidence, not claims.** A task is done when its test output has been read. A script
  that exits 0 because it failed quietly is not evidence.
- **`_supabase_row_to_task` never surfaces `user_id`**, deliberately — ownership is a data
  layer concern and `TaskRecord` does not carry it. Any code that must decide ownership
  reads the row itself; it cannot ask a `TaskRecord`.
- **User-facing strings are Greek.** No user-facing strings in this slice.

---

### Task 1: The migration

**Files:**
- Create: `docs/migrations/2026-09-11-multi-user-sharing.sql`
- Modify: `docs/DATABASE_SCHEMA.md` (append the new tables and columns)

**Interfaces:**
- Consumes: nothing.
- Produces: tables `workspace_members`, `workspace_invites`, `workspace_activity`;
  columns `tasks.assigned_to`, `workspaces.archived_at`. Every later task depends on
  these names.

- [ ] **Step 1: Write the migration file**

Match the house style of `docs/migrations/2026-09-04-task-soft-delete.sql`: long comments
explaining *why*, then the statements, then a **commented-out** verification block.

```sql
-- Multi-user workspace sharing — run in the Supabase SQL Editor.
--
-- RUN THIS BEFORE DEPLOYING THE CODE THAT READS THESE TABLES.
-- Supabase rejects a write containing an unknown column WHOLESALE (PGRST204),
-- which is how `category_name` took down all task creation on 2026-09-01. The
-- other direction is safe: _supabase_row_to_task reads named keys off the row
-- and never splats it into TaskRecord(**row), so running old code simply
-- ignores columns it does not know.
--
-- WHAT THIS IS FOR: workspaces.user_id was added on 2026-09-01 specifically so
-- that sharing would become a table BESIDE this schema rather than a
-- restructuring of it. This is that table, plus the two it needs.
--
-- tasks.user_id DOES NOT CHANGE MEANING. It stays "who created this row" and
-- keeps every existing use. Sharing adds a second axis; it does not redefine
-- the first.

-- ------------------------------------------------------- workspace_members
-- Who may SEE a workspace. workspaces.user_id remains WHO MAY ADMINISTER it
-- (rename, archive, invite, remove, delete tasks). These are two different
-- questions, not two answers to one: the owner is in both sets and nothing
-- else is derived twice.
--
-- notify_all lives here rather than on app_settings because it is a
-- PER-WORKSPACE opinion — an owner may want to watch the cleaning team and
-- not the office.
create table if not exists workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  notify_all boolean not null default false,
  joined_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create index if not exists workspace_members_user_id_idx on workspace_members (user_id);
create index if not exists workspace_members_workspace_id_idx on workspace_members (workspace_id);

alter table workspace_members enable row level security;

-- Flat and owner-scoped, exactly like every other policy in this database.
-- The backend uses the secret key and bypasses RLS, and the frontend reads no
-- tables at all (checked 2026-09-11: every supabase.* call in frontend/src is
-- authentication). So this policy being STRICTER than the application is
-- correct for a defence-in-depth layer, and the joining policy that would be
-- needed to match the app is a shape nobody here has reviewed.
drop policy if exists "workspace_members are self-only" on workspace_members;
create policy "workspace_members are self-only" on workspace_members
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ------------------------------------------------------- workspace_invites
-- token_hash, NOT token. The link is a bearer credential: whoever holds it
-- gets in. Storing it raw would make a database dump a working set of keys to
-- every shared workspace — the same reasoning that made hostaway_connections
-- store a Fernet ciphertext instead of the client secret.
--
-- `email` is nullable and unused today. It exists for the email-invitation
-- phase, which is blocked on a custom domain (see BACKLOG.md).
create table if not exists workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  invited_by uuid references auth.users (id) on delete set null,
  token_hash text not null unique,
  email text,
  role text not null default 'member' check (role in ('owner', 'member')),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists workspace_invites_workspace_id_idx on workspace_invites (workspace_id);

alter table workspace_invites enable row level security;

drop policy if exists "workspace_invites are inviter-only" on workspace_invites;
create policy "workspace_invites are inviter-only" on workspace_invites
  for all using (auth.uid() = invited_by) with check (auth.uid() = invited_by);

-- ------------------------------------------------------ workspace_activity
-- actor_user_id is ON DELETE SET NULL: a departed colleague's history stays
-- readable. task_id is ON DELETE SET NULL for the same reason.
--
-- task_name is a DELIBERATE DUPLICATE of the task's own name. With task_id
-- alone, deleting a task turns its whole history into "somebody did something
-- to something". This is the same reasoning that made
-- agent_action_decisions.record_id a TEXT column rather than a uuid FK: a log
-- whose rows stop being readable when their subject disappears is not a log.
--
-- No retention policy and nothing purges it — permanent archive, same standing
-- as agent_runs.
create table if not exists workspace_activity (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  action text not null,
  task_id uuid references tasks (id) on delete set null,
  task_name text,
  details jsonb,
  created_at timestamptz not null default now()
);

create index if not exists workspace_activity_ws_created_idx
  on workspace_activity (workspace_id, created_at desc);

alter table workspace_activity enable row level security;

drop policy if exists "workspace_activity is actor-only" on workspace_activity;
create policy "workspace_activity is actor-only" on workspace_activity
  for all using (auth.uid() = actor_user_id) with check (auth.uid() = actor_user_id);

-- -------------------------------------------------------------- new columns
-- SET NULL, not CASCADE, for the same reason workspace_id and category_id are
-- SET NULL: deleting a PERSON must never delete work. A task whose assignee's
-- account is removed becomes unassigned and stays in the workspace.
alter table tasks
  add column if not exists assigned_to uuid references auth.users (id) on delete set null;

create index if not exists tasks_assigned_to_idx on tasks (assigned_to);
create index if not exists tasks_ws_assigned_idx on tasks (workspace_id, assigned_to);

-- Archiving replaces deletion for workspaces (owner's rule: work is never
-- lost). Deleting a workspace already preserved its TASKS via ON DELETE SET
-- NULL — what it destroyed was everything that made them findable, and once
-- visibility is derived from membership it also destroys who can see them.
alter table workspaces
  add column if not exists archived_at timestamptz;

-- --------------------------------------------------------------- backfill
-- Every existing workspace gets its owner as a member, so that
-- get_member_workspace_ids has the same answer for an account that has never
-- shared anything as it would if membership had always existed. Without this,
-- an owner would not be a member of their own workspace and the `or` filter
-- in get_all_tasks would be built from an empty list.
--
-- ON CONFLICT DO NOTHING makes re-running the whole migration harmless.
insert into workspace_members (workspace_id, user_id, role)
select id, user_id, 'owner' from workspaces
on conflict (workspace_id, user_id) do nothing;

-- ---------------------------------------------------------------------------
-- VERIFICATION — commented out deliberately. Uncomment and run AFTER applying
-- the statements above.
--
-- Query 1 must return one row per existing workspace, all role='owner'.
-- Query 2 must show assigned = 0: a new column must not have touched a row.
-- Query 3 must show archived = 0 for the same reason.
-- ---------------------------------------------------------------------------

-- select count(*) as memberships,
--        count(*) filter (where role = 'owner') as owners
-- from workspace_members;

-- select count(*) as total, count(assigned_to) as assigned from tasks;

-- select count(*) as total, count(archived_at) as archived from workspaces;
```

- [ ] **Step 2: Append the new tables to `docs/DATABASE_SCHEMA.md`**

Add three `### Table:` sections and two column notes, in the same voice as the existing
entries — each one saying *why* the shape is what it is, not just what the columns are.
Copy the reasoning from the migration comments: `workspace_members` answers a different
question from `workspaces.user_id`; `token_hash` is a hash because the link is a
credential; `task_name` on the activity log is a deliberate duplicate; `assigned_to` is
SET NULL because deleting a person must not delete work.

- [ ] **Step 3: Verify the SQL parses**

There is no database in the test environment, so this step is a read-through, not a run.
Check by eye: every `create table` has its `enable row level security` and its policy;
every FK names a real table; `gen_random_uuid()` is available (it is — `workspaces` and
`categories` already use it).

- [ ] **Step 4: Commit**

```bash
git add docs/migrations/2026-09-11-multi-user-sharing.sql docs/DATABASE_SCHEMA.md
git commit -m "The tables sharing needs, beside the schema rather than through it"
```

**Note for the owner:** this SQL has to be run by hand in the Supabase SQL Editor before
any of this slice is deployed. Nothing in Tasks 2-7 requires it, because every test uses a
fake Supabase.

---

### Task 2: The models

**Files:**
- Modify: `models.py`
- Test: `tests/test_multi_user_models.py` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `WorkspaceMember(record_id, workspace_id, user_id, role, notify_all,
  joined_at)`; `TaskRecord.assigned_to: Optional[str]`; `Workspace.archived_at:
  Optional[str]`.

- [ ] **Step 1: Write the failing test**

```python
"""
The models multi-user adds. Nothing here talks to a database — these tests
exist so the DEFAULTS are pinned, because a default that drifts is how a task
quietly acquires an assignee nobody chose.
"""
from models import TaskRecord, Workspace, WorkspaceMember


def _task(**overrides):
    base = dict(
        task_name="Καθαρισμός Β2", description="", category="Business",
        priority="P3", ai_suggested_category="Business", ai_suggested_priority="P3",
    )
    base.update(overrides)
    return TaskRecord(**base)


def test_a_new_task_has_nobody_responsible_for_it():
    """NULL is not "unset", it is a real state: in a shared workspace it means
    the work exists and nobody has taken it. get_owned_or_assigned_tasks reads
    it that way."""
    assert _task().assigned_to is None


def test_a_task_can_carry_an_assignee():
    assert _task(assigned_to="user-2").assigned_to == "user-2"


def test_a_workspace_is_live_until_it_is_archived():
    assert Workspace(name="Business").archived_at is None


def test_a_member_defaults_to_member_and_to_silence():
    """notify_all defaults to false: the owner who wants the team's
    notifications has to ask for them. A switch that is on by default would
    make every shared workspace noisy on day one."""
    m = WorkspaceMember(workspace_id="ws-1", user_id="user-2")

    assert m.role == "member"
    assert m.notify_all is False


def test_the_owners_membership_row_says_owner():
    m = WorkspaceMember(workspace_id="ws-1", user_id="user-1", role="owner")

    assert m.role == "owner"
```

- [ ] **Step 2: Run it and watch it fail**

Run: `./venv/Scripts/python.exe -m pytest tests/test_multi_user_models.py -q`
Expected: FAIL — `ImportError: cannot import name 'WorkspaceMember' from 'models'`.

- [ ] **Step 3: Add the models**

In `models.py`, add `assigned_to` to `TaskRecord` beside the workspace columns:

```python
    # Multi-user (2026-09-11). WHO IS RESPONSIBLE, as distinct from user_id,
    # which stays "who created this row". NULL means nobody has taken it —
    # a real state, not an unset one: an unassigned task in a shared workspace
    # is visible to every member and in nobody's day view but its creator's.
    #
    # ON DELETE SET NULL in the database, like workspace_id and category_id:
    # deleting a person must never delete work.
    assigned_to: Optional[str] = None
```

Add `archived_at` to `Workspace`:

```python
    # Archiving replaces deletion (2026-09-11). NULL means live. Deleting a
    # workspace preserved its tasks already, but destroyed what made them
    # findable — and, once visibility comes from membership, who could see
    # them at all.
    archived_at: Optional[str] = None
```

Add the new model after `Workspace`:

```python
class WorkspaceMember(BaseModel):
    """
    One person's membership of one workspace — the answer to "who may SEE
    this", which is a different question from `workspaces.user_id`, the answer
    to "who may ADMINISTER this". The owner appears in both; nothing else is
    derived twice.

    `notify_all` is per-workspace on purpose: an owner may want the cleaning
    team's reminders and not the office's.
    """
    record_id: Optional[str] = None
    workspace_id: str
    user_id: str
    role: Literal["owner", "member"] = "member"
    notify_all: bool = False
    joined_at: Optional[str] = None
```

- [ ] **Step 4: Run the tests**

Run: `./venv/Scripts/python.exe -m pytest tests/test_multi_user_models.py -q`
Expected: `5 passed`.

Then run the whole suite: `./venv/Scripts/python.exe -m pytest tests/ -q`
Expected: `353 passed` (348 + 5). Anything lower means a default changed under an
existing test — read it, do not adjust the baseline.

- [ ] **Step 5: Commit**

```bash
git add models.py tests/test_multi_user_models.py
git commit -m "A task gains somebody responsible for it, separate from who wrote it"
```

---

### Task 3: Membership in the repository

**Files:**
- Modify: `repository.py` (add after `get_workspace`, near the other workspace helpers)
- Test: `tests/test_workspace_membership.py` (create)

**Interfaces:**
- Consumes: `WorkspaceMember` from Task 2.
- Produces:
  - `repository.get_member_workspace_ids(user_id: str) -> list[str]`
  - `repository.add_workspace_member(workspace_id: str, user_id: str, role: str = "member") -> WorkspaceMember`
  - `repository.get_workspace_members(workspace_id: str) -> list[WorkspaceMember]`
  - `repository.is_workspace_owner(user_id: str, workspace_id: str) -> bool`

- [ ] **Step 1: Write the failing test**

Reuse the fake-Supabase harness that `tests/test_workspaces_repository.py` already
defines — copy `_FakeQuery`, `_FakeSupabase` into the new file rather than importing
across test modules, which is what the existing tests do.

```python
"""
Membership: the table that answers "who may SEE this workspace".

Every query here is the protection itself — the backend uses the secret key
and bypasses RLS, so a missing filter is not a slow leak, it is an open door.
"""
import repository
from models import WorkspaceMember


class _FakeQuery:
    """Chainable stand-in for the supabase query builder. Records every call so
    a test can assert WHICH filters were applied, not just what came back."""

    def __init__(self, sink, rows):
        self.sink, self.rows = sink, rows

    def select(self, *a, **kw):
        self.sink["select"] = a
        return self

    def insert(self, values):
        self.sink["insert"] = values
        return self

    def eq(self, col, val):
        self.sink.setdefault("eq", []).append((col, val))
        return self

    def limit(self, n):
        self.sink["limit"] = n
        return self

    def execute(self):
        return type("R", (), {"data": self.rows})()


class _FakeSupabase:
    def __init__(self, rows):
        self.rows, self.sink = rows, {}

    def table(self, name):
        self.sink["table"] = name
        return _FakeQuery(self.sink, self.rows)


def _member_row(**overrides):
    base = {"id": "m-1", "workspace_id": "ws-1", "user_id": "user-1",
            "role": "owner", "notify_all": False,
            "joined_at": "2026-09-11T00:00:00Z"}
    base.update(overrides)
    return base


def test_the_workspace_ids_read_returns_ids_and_nothing_else(monkeypatch):
    """Ids only. The caller builds one `or` filter out of them, and fetching
    whole rows to throw away everything but the id is a round trip's worth of
    data for nothing."""
    fake = _FakeSupabase([{"workspace_id": "ws-1"}, {"workspace_id": "ws-2"}])
    monkeypatch.setattr(repository, "supabase", fake)

    ids = repository.get_member_workspace_ids("user-1")

    assert fake.sink["table"] == "workspace_members"
    assert ("user_id", "user-1") in fake.sink["eq"]
    assert ids == ["ws-1", "ws-2"]


def test_a_user_who_belongs_nowhere_gets_an_empty_list(monkeypatch):
    """NOT None. get_all_tasks branches on emptiness and `None` would reach
    PostgREST as `workspace_id.in.()`, which is a syntax error rather than an
    empty match."""
    monkeypatch.setattr(repository, "supabase", _FakeSupabase([]))

    assert repository.get_member_workspace_ids("user-1") == []


def test_a_row_with_a_null_workspace_is_skipped(monkeypatch):
    """Cannot happen through the FK, but a None reaching the `in.()` list would
    build a malformed filter, and a malformed filter fails open more often than
    it fails closed."""
    fake = _FakeSupabase([{"workspace_id": None}, {"workspace_id": "ws-2"}])
    monkeypatch.setattr(repository, "supabase", fake)

    assert repository.get_member_workspace_ids("user-1") == ["ws-2"]


def test_adding_a_member_records_the_pair_and_the_role(monkeypatch):
    fake = _FakeSupabase([_member_row(user_id="user-2", role="member")])
    monkeypatch.setattr(repository, "supabase", fake)

    m = repository.add_workspace_member("ws-1", "user-2")

    assert fake.sink["insert"]["workspace_id"] == "ws-1"
    assert fake.sink["insert"]["user_id"] == "user-2"
    assert fake.sink["insert"]["role"] == "member"
    assert isinstance(m, WorkspaceMember)
    assert m.role == "member"


def test_listing_members_is_scoped_to_the_workspace(monkeypatch):
    fake = _FakeSupabase([_member_row()])
    monkeypatch.setattr(repository, "supabase", fake)

    members = repository.get_workspace_members("ws-1")

    assert ("workspace_id", "ws-1") in fake.sink["eq"]
    assert members[0].user_id == "user-1"


def test_ownership_asks_the_workspaces_table_not_the_members_table(monkeypatch):
    """workspaces.user_id is the authority on who may administer. The
    membership row marked 'owner' is a convenience for listing people, and
    deciding from it would make the same fact answerable two ways."""
    fake = _FakeSupabase([{"id": "ws-1"}])
    monkeypatch.setattr(repository, "supabase", fake)

    assert repository.is_workspace_owner("user-1", "ws-1") is True
    assert fake.sink["table"] == "workspaces"
    assert ("id", "ws-1") in fake.sink["eq"]
    assert ("user_id", "user-1") in fake.sink["eq"]


def test_ownership_is_false_when_nothing_comes_back(monkeypatch):
    monkeypatch.setattr(repository, "supabase", _FakeSupabase([]))

    assert repository.is_workspace_owner("user-2", "ws-1") is False
```

- [ ] **Step 2: Run it and watch it fail**

Run: `./venv/Scripts/python.exe -m pytest tests/test_workspace_membership.py -q`
Expected: FAIL — `AttributeError: module 'repository' has no attribute 'get_member_workspace_ids'`.

- [ ] **Step 3: Implement**

In `repository.py`, after `get_workspace`:

```python
def _supabase_row_to_member(row: dict) -> WorkspaceMember:
    return WorkspaceMember(
        record_id=row.get("id"),
        workspace_id=_get(row, "workspace_id", ""),
        user_id=_get(row, "user_id", ""),
        role=_get(row, "role", "member"),
        notify_all=bool(row.get("notify_all", False)),
        joined_at=row.get("joined_at"),
    )


def get_member_workspace_ids(user_id: str) -> list[str]:
    """
    Every workspace this user may SEE. Ids only — the caller turns them into a
    single `or` filter, and reading whole rows to discard everything but the id
    is a round trip's worth of data for nothing.

    Returns [] and never None: get_all_tasks branches on emptiness, and a None
    reaching PostgREST as `workspace_id.in.()` is a syntax error, not an empty
    match.
    """
    response = (
        supabase.table("workspace_members")
        .select("workspace_id")
        .eq("user_id", user_id)
        .execute()
    )
    return [r["workspace_id"] for r in (response.data or []) if r.get("workspace_id")]


def add_workspace_member(workspace_id: str, user_id: str, role: str = "member") -> WorkspaceMember:
    """No user_id scoping argument: the CALLER has already established the
    right to do this (an accepted invite, or creating a workspace). This
    function does not re-decide it."""
    fields = {"workspace_id": workspace_id, "user_id": user_id, "role": role}
    response = supabase.table("workspace_members").insert(fields).execute()
    row = (response.data or [{}])[0]
    logger.info(f"[members] {user_id} joined workspace {workspace_id} as {role}")
    return _supabase_row_to_member(row)


def get_workspace_members(workspace_id: str) -> list[WorkspaceMember]:
    response = (
        supabase.table("workspace_members")
        .select("*")
        .eq("workspace_id", workspace_id)
        .execute()
    )
    return [_supabase_row_to_member(r) for r in (response.data or [])]


def is_workspace_owner(user_id: str, workspace_id: str) -> bool:
    """
    Asks `workspaces`, not `workspace_members`.

    workspaces.user_id is the authority on who may administer a workspace;
    the membership row marked 'owner' exists so that "who is in here" has one
    answer in one table. Deciding ownership from the membership row would make
    one fact answerable two ways, which is how the pair starts to drift.
    """
    response = (
        supabase.table("workspaces")
        .select("id")
        .eq("id", workspace_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    return bool(response.data)
```

Add `WorkspaceMember` to the `from models import ...` line at the top of `repository.py`.

- [ ] **Step 4: Run the tests**

Run: `./venv/Scripts/python.exe -m pytest tests/test_workspace_membership.py -q`
Expected: `7 passed`.

Full suite: `./venv/Scripts/python.exe -m pytest tests/ -q` → `360 passed`.

- [ ] **Step 5: Commit**

```bash
git add repository.py tests/test_workspace_membership.py
git commit -m "A workspace learns who is in it, which workspaces.user_id never answered"
```

---

### Task 4: `visible_to` — widen the read that draws screens

**Files:**
- Modify: `repository.py:205-213` (`AirtableTaskRepository.get_all_tasks`)
- Test: `tests/test_task_visibility.py` (create)

**Interfaces:**
- Consumes: `repository.get_member_workspace_ids` from Task 3.
- Produces: `AirtableTaskRepository.get_all_tasks(user_id)` now returns owned **plus**
  member-workspace tasks. `repository.get_tasks_for_user` delegates to it unchanged and
  keeps its signature.

- [ ] **Step 1: Write the failing test**

The first test is the important one: **it is a regression guard, not a feature test.**

```python
"""
visible_to — what a person may SEE. Screens, search, the API.

The companion read, belongs_to, is in test_task_ownership_reads.py and is what
anything that rings a phone must use instead. Splitting them is the spine of
the 2026-09-11 design: get_all_tasks fed both machines, and widening it without
splitting it pushes one reminder per member.
"""
import repository


class _FakeQuery:
    def __init__(self, sink, rows):
        self.sink, self.rows = sink, rows

    def select(self, *a, **kw):
        return self

    def eq(self, col, val):
        self.sink.setdefault("eq", []).append((col, val))
        return self

    def or_(self, expr):
        self.sink["or"] = expr
        return self

    def execute(self):
        return type("R", (), {"data": self.rows})()


class _FakeSupabase:
    def __init__(self, rows):
        self.rows, self.sink = rows, {}

    def table(self, name):
        self.sink["table"] = name
        return _FakeQuery(self.sink, self.rows)


def _task_row(**overrides):
    base = {"id": "t-1", "user_id": "user-1", "task_name": "Καθαρισμός Β2",
            "description": "", "category": "Business", "priority": "P3",
            "ai_suggested_category": "Business", "ai_suggested_priority": "P3",
            "checklist": [], "approval_status": True, "is_completed": False,
            "is_rejected": False}
    base.update(overrides)
    return base


def test_a_user_who_belongs_to_nothing_is_queried_EXACTLY_as_before(monkeypatch):
    """The regression guard for this whole slice. An account with no shared
    workspaces must produce the same query it produced yesterday — a plain
    user_id filter and no `or` — because that is the only evidence that the
    owner's live app is untouched by this change."""
    fake = _FakeSupabase([_task_row()])
    monkeypatch.setattr(repository, "supabase", fake)
    monkeypatch.setattr(repository, "get_member_workspace_ids", lambda u: [])

    repo = repository.AirtableTaskRepository()
    result = repo.get_all_tasks("user-1")

    assert ("user_id", "user-1") in fake.sink["eq"]
    assert "or" not in fake.sink
    assert len(result) == 1


def test_a_member_gets_an_or_filter_over_their_workspaces(monkeypatch):
    fake = _FakeSupabase([_task_row()])
    monkeypatch.setattr(repository, "supabase", fake)
    monkeypatch.setattr(repository, "get_member_workspace_ids", lambda u: ["ws-1", "ws-2"])

    repository.AirtableTaskRepository().get_all_tasks("user-2")

    assert fake.sink["or"] == "user_id.eq.user-2,workspace_id.in.(ws-1,ws-2)"
    assert "eq" not in fake.sink


def test_an_empty_workspace_list_never_reaches_the_in_filter(monkeypatch):
    """`workspace_id.in.()` is a PostgREST syntax error, not an empty match.
    A malformed filter fails open more often than it fails closed, which on
    this table means another user's tasks."""
    fake = _FakeSupabase([])
    monkeypatch.setattr(repository, "supabase", fake)
    monkeypatch.setattr(repository, "get_member_workspace_ids", lambda u: [])

    repository.AirtableTaskRepository().get_all_tasks("user-1")

    assert "in.()" not in str(fake.sink.get("or", ""))


def test_the_module_level_read_still_delegates(monkeypatch):
    """agent_engine.py imports repository directly and calls this. Its
    signature must not move."""
    fake = _FakeSupabase([_task_row()])
    monkeypatch.setattr(repository, "supabase", fake)
    monkeypatch.setattr(repository, "get_member_workspace_ids", lambda u: [])

    assert len(repository.get_tasks_for_user("user-1")) == 1
```

- [ ] **Step 2: Run it and watch it fail**

Run: `./venv/Scripts/python.exe -m pytest tests/test_task_visibility.py -q`
Expected: the `or` test fails — `KeyError: 'or'`. The regression test should already pass,
which is the point: it is pinning today's behaviour before it is touched.

- [ ] **Step 3: Implement**

Replace `AirtableTaskRepository.get_all_tasks`:

```python
    def get_all_tasks(self, user_id: str) -> list[TaskRecord]:
        """
        Every task this user may SEE — `visible_to`. Tasks they created, plus
        every task in a workspace they are a member of.

        THIS IS THE READ FOR SCREENS. Anything that rings a phone must call
        repository.get_owned_or_assigned_tasks instead, and the split is not a
        nicety: this one function used to feed both the UI and the scheduler
        tick, and widening it without splitting it pushes one reminder per
        member. Worse, tasks.notification_sent is a SINGLE BOOLEAN on the task
        row, so whichever member the scheduler reached first would flip it and
        the rest would find nothing — which phone rang would depend on the
        order get_all_active_user_ids() happened to return profiles in.
        """
        workspace_ids = get_member_workspace_ids(user_id)

        query = supabase.table("tasks").select("*")
        if workspace_ids:
            # PostgREST `or`: comma-separated filters, and `in` takes its
            # values in parentheses. The empty list gets its own branch rather
            # than an inline conditional because `workspace_id.in.()` is a
            # SYNTAX ERROR, not an empty match — and a malformed filter on this
            # table fails open, which means another user's tasks.
            joined = ",".join(workspace_ids)
            query = query.or_(f"user_id.eq.{user_id},workspace_id.in.({joined})")
        else:
            query = query.eq("user_id", user_id)

        response = query.execute()
        rows = response.data
        logger.info(f"Retrieved {len(rows)} visible tasks from Supabase for user {user_id}.")
        return [self._supabase_row_to_task(row) for row in rows]
```

- [ ] **Step 4: Run the tests**

Run: `./venv/Scripts/python.exe -m pytest tests/test_task_visibility.py -q`
Expected: `4 passed`.

Full suite: `./venv/Scripts/python.exe -m pytest tests/ -q` → `364 passed`.
**If any existing test now fails, stop and read it** — it is telling you a caller assumed
the old query shape, and that caller is the real finding.

- [ ] **Step 5: Commit**

```bash
git add repository.py tests/test_task_visibility.py
git commit -m "What you can see stops meaning only what you wrote"
```

---

### Task 5: `belongs_to` — the narrow read, and pointing the scheduler at it

**Files:**
- Modify: `repository.py` (add `get_owned_or_assigned_tasks` after `get_tasks_for_user`)
- Modify: `services.py:1062` (the per-tick fetch)
- Test: `tests/test_task_ownership_reads.py` (create)

**Interfaces:**
- Consumes: `AirtableTaskRepository._supabase_row_to_task`, `_get_shared_tasks_repo`.
- Produces: `repository.get_owned_or_assigned_tasks(user_id: str) -> list[TaskRecord]`.

- [ ] **Step 1: Write the failing test**

```python
"""
belongs_to — what is a person's WORK, as distinct from what they can see.

Used by everything that rings a phone (advance reminders, the daily summary,
Hostaway escalation) and by the agent's day view. The 2026-09-11 design calls
the split between this and visible_to its spine.
"""
import repository
import services


class _FakeQuery:
    def __init__(self, sink, rows):
        self.sink, self.rows = sink, rows

    def select(self, *a, **kw):
        return self

    def or_(self, expr):
        self.sink["or"] = expr
        return self

    def execute(self):
        return type("R", (), {"data": self.rows})()


class _FakeSupabase:
    def __init__(self, rows):
        self.rows, self.sink = rows, {}

    def table(self, name):
        self.sink["table"] = name
        return _FakeQuery(self.sink, self.rows)


def _task_row(**overrides):
    base = {"id": "t-1", "user_id": "user-1", "task_name": "Καθαρισμός Β2",
            "description": "", "category": "Business", "priority": "P3",
            "ai_suggested_category": "Business", "ai_suggested_priority": "P3",
            "checklist": [], "approval_status": True, "is_completed": False,
            "is_rejected": False, "assigned_to": None}
    base.update(overrides)
    return base


def test_the_narrow_read_asks_for_assigned_to_me_or_mine_and_unclaimed(monkeypatch):
    """Two arms, and the second one carries `assigned_to is null` for a reason:
    a task I created and then handed to somebody else is THEIR work, and my
    phone must stop ringing for it the moment I assign it."""
    fake = _FakeSupabase([_task_row()])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.get_owned_or_assigned_tasks("user-1")

    assert fake.sink["table"] == "tasks"
    assert fake.sink["or"] == (
        "assigned_to.eq.user-1,and(user_id.eq.user-1,assigned_to.is.null)"
    )


def test_the_narrow_read_returns_parsed_tasks(monkeypatch):
    """Parsed by the same _supabase_row_to_task every other read uses — a
    second parser is a second set of bugs."""
    monkeypatch.setattr(repository, "supabase", _FakeSupabase([_task_row()]))

    tasks = repository.get_owned_or_assigned_tasks("user-1")

    assert len(tasks) == 1
    assert tasks[0].task_name == "Καθαρισμός Β2"
    assert tasks[0].record_id == "t-1"


def test_one_shared_task_with_five_members_reminds_exactly_one_person(monkeypatch):
    """The regression that this whole split exists to prevent.

    Five members, one task, assigned to user-3. Only user-3's tick may see it.
    Read through the narrow function the way the scheduler does — if this ever
    starts returning the task for user-1, the scheduler is back to pushing one
    reminder per member and racing a single boolean to decide whose phone
    rings."""
    rows_by_user = {
        "user-3": [_task_row(id="t-9", user_id="user-1", assigned_to="user-3")],
    }

    class _PerUserSupabase(_FakeSupabase):
        def __init__(self):
            super().__init__([])
            self.asked_for = None

        def table(self, name):
            # The `or` expression names the user, so the fake can answer the
            # way the database would without reimplementing PostgREST.
            return _FakeQuery(self.sink, self.rows)

    for uid in ["user-1", "user-2", "user-3", "user-4", "user-5"]:
        monkeypatch.setattr(repository, "supabase",
                            _FakeSupabase(rows_by_user.get(uid, [])))
        got = repository.get_owned_or_assigned_tasks(uid)
        assert len(got) == (1 if uid == "user-3" else 0), uid


def test_the_scheduler_tick_uses_the_narrow_read_not_the_wide_one(monkeypatch):
    """services.py's per-tick fetch is the single call site that feeds
    reminders, the daily summary, escalation and missed-occurrence closing at
    once. If it ever reads visible_to again, all four widen together."""
    import inspect

    source = inspect.getsource(services.TaskService.run_notification_scheduler)

    assert "get_owned_or_assigned_tasks" in source
    assert "self.repository.get_all_tasks(user_id)" not in source
```

- [ ] **Step 2: Run it and watch it fail**

Run: `./venv/Scripts/python.exe -m pytest tests/test_task_ownership_reads.py -q`
Expected: FAIL — `AttributeError: module 'repository' has no attribute 'get_owned_or_assigned_tasks'`.

- [ ] **Step 3: Implement the read**

In `repository.py`, immediately after `get_tasks_for_user`:

```python
def get_owned_or_assigned_tasks(user_id: str) -> list[TaskRecord]:
    """
    Every task that is this person's WORK — `belongs_to`. Tasks assigned to
    them, plus tasks they created that nobody has been made responsible for.

    THIS IS THE READ FOR ANYTHING THAT RINGS A PHONE — advance reminders, the
    daily summary, Hostaway escalation — and for the agent's day view. It must
    never be swapped for get_all_tasks; see that method's docstring for the
    three ways that breaks, two of them silently.

    `assigned_to is null` on the second arm is load-bearing: a task I created
    and then handed to somebody else is THEIR work, and my phone has to stop
    ringing for it the moment I assign it.

    A task in a shared workspace that nobody has taken is in its creator's list
    and nobody else's. Every member sees it on screen; until somebody takes it,
    it is not anybody's work.
    """
    repo = _get_shared_tasks_repo()
    response = (
        supabase.table("tasks")
        .select("*")
        .or_(f"assigned_to.eq.{user_id},and(user_id.eq.{user_id},assigned_to.is.null)")
        .execute()
    )
    rows = response.data or []
    logger.info(f"Retrieved {len(rows)} owned-or-assigned tasks for user {user_id}.")
    return [repo._supabase_row_to_task(row) for row in rows]
```

- [ ] **Step 4: Point the scheduler at it**

In `services.py`, at the per-tick fetch (currently `services.py:1062`), replace

```python
                user_tasks = self.repository.get_all_tasks(user_id)
```

with

```python
                # belongs_to, NOT visible_to. This one fetch feeds advance
                # reminders, the daily summary, Hostaway escalation and
                # missed-occurrence closing, so reading the wide list here
                # would widen all four at once: one reminder per member, and
                # tasks.notification_sent is a single boolean that cannot
                # record five deliveries. See the 2026-09-11 design.
                user_tasks = repository.get_owned_or_assigned_tasks(user_id)
```

Confirm `repository` is imported at module level in `services.py` (it is — the file
already calls `repository.get_task_calendar_fields` and others directly).

- [ ] **Step 5: Run the tests**

Run: `./venv/Scripts/python.exe -m pytest tests/test_task_ownership_reads.py -q`
Expected: `4 passed`.

Full suite: `./venv/Scripts/python.exe -m pytest tests/ -q` → `368 passed`.
`tests/test_scheduler_isolation.py` is the one most likely to react — read any failure
there carefully rather than adjusting it.

- [ ] **Step 6: Commit**

```bash
git add repository.py services.py tests/test_task_ownership_reads.py
git commit -m "What rings your phone stops meaning the same thing as what you can see"
```

---

### Task 6: The write gate

**Files:**
- Create: `access.py`
- Modify: `services.py` (`update_task`, `delete_task`, `restore_task`)
- Test: `tests/test_task_access.py` (create)

**Interfaces:**
- Consumes: `repository.get_member_workspace_ids`, `repository.is_workspace_owner`.
- Produces:
  - `access.TaskAccessDenied(Exception)`
  - `access.task_ownership(task_id: str) -> Optional[dict]` — keys `id`, `user_id`, `workspace_id`, `assigned_to`
  - `access.can_write(user_id: str, task_id: str) -> bool`
  - `access.can_delete(user_id: str, task_id: str) -> bool`
  - `access.require_write(user_id: str, task_id: str) -> dict`
  - `access.require_delete(user_id: str, task_id: str) -> dict`

- [ ] **Step 1: Write the failing test**

```python
"""
The write gate — the one place that answers "may this person write to this
task".

Before 2026-09-11 there was no such place: the check was copy-pasted into each
query as .eq("user_id", user_id), 19 of the 29 statements touching `tasks`.
That worked while "may I write" and "is it mine" were the same question.
"""
import pytest

import access


class _FakeQuery:
    def __init__(self, sink, rows):
        self.sink, self.rows = sink, rows

    def select(self, *a, **kw):
        self.sink["select"] = a
        return self

    def eq(self, col, val):
        self.sink.setdefault("eq", []).append((col, val))
        return self

    def limit(self, n):
        return self

    def execute(self):
        return type("R", (), {"data": self.rows})()


class _FakeSupabase:
    def __init__(self, rows):
        self.rows, self.sink = rows, {}

    def table(self, name):
        self.sink["table"] = name
        return _FakeQuery(self.sink, self.rows)


def _own(**overrides):
    base = {"id": "t-1", "user_id": "user-1", "workspace_id": "ws-1",
            "assigned_to": None}
    base.update(overrides)
    return base


def test_the_gate_reads_the_row_UNSCOPED(monkeypatch):
    """The gate is the thing that does the scoping, so its own lookup cannot be
    scoped — it has to be able to see a row in order to refuse it. A filtered
    read here would turn every refusal into "not found", which is a different
    fact and a worse error message."""
    fake = _FakeSupabase([_own()])
    monkeypatch.setattr(access, "supabase", fake)

    access.task_ownership("t-1")

    assert fake.sink["eq"] == [("id", "t-1")]


def test_the_creator_may_write(monkeypatch):
    monkeypatch.setattr(access, "supabase", _FakeSupabase([_own()]))
    monkeypatch.setattr(access.repository, "get_member_workspace_ids", lambda u: [])

    assert access.can_write("user-1", "t-1") is True


def test_a_member_of_the_workspace_may_write(monkeypatch):
    """v1 answers "yes, if you can see it". The owner's eventual tightening —
    a member changes only what is assigned to them — is an `if` HERE and
    nowhere else."""
    monkeypatch.setattr(access, "supabase", _FakeSupabase([_own()]))
    monkeypatch.setattr(access.repository, "get_member_workspace_ids", lambda u: ["ws-1"])

    assert access.can_write("user-2", "t-1") is True


def test_a_stranger_may_not_write(monkeypatch):
    """The negative test. If it is missing, this is learned about from a
    customer."""
    monkeypatch.setattr(access, "supabase", _FakeSupabase([_own()]))
    monkeypatch.setattr(access.repository, "get_member_workspace_ids", lambda u: ["ws-9"])

    assert access.can_write("user-3", "t-1") is False


def test_a_stranger_may_not_write_to_an_unfiled_task(monkeypatch):
    """workspace_id NULL means the task belongs to nobody's room, so membership
    cannot grant anything and only the creator is left."""
    monkeypatch.setattr(access, "supabase", _FakeSupabase([_own(workspace_id=None)]))
    monkeypatch.setattr(access.repository, "get_member_workspace_ids", lambda u: ["ws-1"])

    assert access.can_write("user-2", "t-1") is False


def test_a_missing_task_is_refused_not_crashed(monkeypatch):
    monkeypatch.setattr(access, "supabase", _FakeSupabase([]))
    monkeypatch.setattr(access.repository, "get_member_workspace_ids", lambda u: ["ws-1"])

    assert access.can_write("user-2", "t-404") is False


def test_only_the_workspace_owner_may_delete(monkeypatch):
    """The one irreversible act stays with one person. A member may change and
    complete anything in the room; removing it is not theirs."""
    monkeypatch.setattr(access, "supabase", _FakeSupabase([_own()]))
    monkeypatch.setattr(access.repository, "get_member_workspace_ids", lambda u: ["ws-1"])
    monkeypatch.setattr(access.repository, "is_workspace_owner",
                        lambda u, w: u == "user-1")

    assert access.can_delete("user-1", "t-1") is True
    assert access.can_delete("user-2", "t-1") is False


def test_the_creator_may_delete_their_own_unfiled_task(monkeypatch):
    """An unfiled task has no workspace and therefore no workspace owner. The
    creator must still be able to delete it, or a personal task outside every
    workspace becomes undeletable."""
    monkeypatch.setattr(access, "supabase", _FakeSupabase([_own(workspace_id=None)]))
    monkeypatch.setattr(access.repository, "get_member_workspace_ids", lambda u: [])

    assert access.can_delete("user-1", "t-1") is True


def test_require_write_raises_rather_than_returning_false(monkeypatch):
    """Two shapes on purpose: can_* for a UI that greys out a button, require_*
    for a write path that must stop. A write path calling can_* and forgetting
    to check the result is exactly the mistake this pair prevents."""
    monkeypatch.setattr(access, "supabase", _FakeSupabase([_own()]))
    monkeypatch.setattr(access.repository, "get_member_workspace_ids", lambda u: [])

    with pytest.raises(access.TaskAccessDenied):
        access.require_write("user-3", "t-1")

    assert access.require_write("user-1", "t-1")["id"] == "t-1"
```

- [ ] **Step 2: Run it and watch it fail**

Run: `./venv/Scripts/python.exe -m pytest tests/test_task_access.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'access'`.

- [ ] **Step 3: Create `access.py`**

```python
"""
The one place that answers "may this person write to this task".

Before 2026-09-11 there was no such place. The check was copy-pasted into each
query as `.eq("user_id", user_id)` — 19 of the 29 statements touching `tasks`
in repository.py — and services.update_task never asked at all: it called
repository.update_task(user_id, record_id, updates) and the filter rode along
inside. That works while "may I write" and "is it mine" are the same question.
Sharing separates them, and 19 copies of a rule is 19 chances to miss one.

Today this answers "yes, if you can see it", with deleting reserved to the
workspace owner. The tightening the owner has already asked about — a member
may change only what is assigned to them — is an `if` inside can_write and
nothing else in the codebase has to move. That is the whole reason this module
exists as a module.

It deliberately lives BELOW both the UI path and the agent path, for the same
reason the calendar-switch item in BACKLOG.md gives: a rule that sits above
only one caller is a rule the other caller walks around.
"""
import logging
from typing import Optional

import repository
from repository import supabase

logger = logging.getLogger(__name__)


class TaskAccessDenied(Exception):
    """Raised by require_write / require_delete. Callers translate it into
    whatever their layer speaks — main.py turns it into an HTTP 403."""


def task_ownership(task_id: str) -> Optional[dict]:
    """
    The four facts the gate decides from: who created the task, which
    workspace it is in, and who is responsible for it.

    DELIBERATELY UNSCOPED. This is the function that performs the scoping, so
    it has to be able to see a row in order to refuse it. A user-filtered read
    here would collapse "you may not touch this" into "there is no such task",
    which is a different fact and a worse error message.

    Returns None when there is no such task.
    """
    response = (
        supabase.table("tasks")
        .select("id, user_id, workspace_id, assigned_to")
        .eq("id", task_id)
        .limit(1)
        .execute()
    )
    rows = response.data or []
    return rows[0] if rows else None


def can_write(user_id: str, task_id: str) -> bool:
    """v1: you may write to what you can see. Creator, or member of the
    task's workspace."""
    row = task_ownership(task_id)
    if row is None:
        return False
    if row.get("user_id") == user_id:
        return True
    workspace_id = row.get("workspace_id")
    if not workspace_id:
        # An unfiled task is in nobody's room, so membership grants nothing
        # and the creator is the only person left.
        return False
    return workspace_id in repository.get_member_workspace_ids(user_id)


def can_delete(user_id: str, task_id: str) -> bool:
    """
    Deleting is the owner's alone — the one irreversible act, kept with one
    person while everything else in the room is shared.

    An unfiled task has no workspace and therefore no workspace owner, so the
    creator decides; otherwise a personal task outside every workspace would
    become undeletable.
    """
    row = task_ownership(task_id)
    if row is None:
        return False
    workspace_id = row.get("workspace_id")
    if not workspace_id:
        return row.get("user_id") == user_id
    return repository.is_workspace_owner(user_id, workspace_id)


def require_write(user_id: str, task_id: str) -> dict:
    """Returns the ownership row so the caller does not read it twice."""
    row = task_ownership(task_id)
    if row is None or not can_write(user_id, task_id):
        logger.warning(f"[access] write refused: user {user_id} on task {task_id}")
        raise TaskAccessDenied(task_id)
    return row


def require_delete(user_id: str, task_id: str) -> dict:
    row = task_ownership(task_id)
    if row is None or not can_delete(user_id, task_id):
        logger.warning(f"[access] delete refused: user {user_id} on task {task_id}")
        raise TaskAccessDenied(task_id)
    return row
```

- [ ] **Step 4: Route the service write paths through it**

In `services.py`, add `import access` at the top. Then, as the **first statement** of
`TaskService.update_task` (after the docstring):

```python
        # The gate. Every write to a task goes through one place — see
        # access.py for why this did not exist before 2026-09-11.
        access.require_write(user_id, record_id)
```

The same line as the first statement of `TaskService.restore_task`. In
`TaskService.delete_task`, use the stricter one:

```python
        access.require_delete(user_id, record_id)
```

- [ ] **Step 5: Run the tests**

Run: `./venv/Scripts/python.exe -m pytest tests/test_task_access.py -q`
Expected: `9 passed`.

Full suite: `./venv/Scripts/python.exe -m pytest tests/ -q` → `377 passed`.

**Expect existing tests to fail here, and do not paper over it.** Any test that calls
`service.update_task` or `service.delete_task` with a stubbed repository now hits a real
`access.task_ownership` lookup against whatever `supabase` those tests installed. The fix
is to stub `access.task_ownership` in those tests to return a row owned by the test's
user — not to remove the gate call. Read each failure; a test that cannot be made to pass
this way is telling you about a write path you have not routed.

- [ ] **Step 6: Commit**

```bash
git add access.py services.py tests/test_task_access.py
git commit -m "One place decides who may write, instead of nineteen copies of a filter"
```

---

### Task 7: `mark_notification_sent` stops filtering on the owner

**Files:**
- Modify: `repository.py:622-625`
- Test: `tests/test_task_ownership_reads.py` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces: `repository.mark_notification_sent(user_id: str, record_id: str) -> None` —
  same signature, no `user_id` filter in the query.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_task_ownership_reads.py`:

```python
class _UpdateQuery(_FakeQuery):
    def update(self, values):
        self.sink["update"] = values
        return self

    def eq(self, col, val):
        self.sink.setdefault("eq", []).append((col, val))
        return self


class _UpdateSupabase(_FakeSupabase):
    def table(self, name):
        self.sink["table"] = name
        return _UpdateQuery(self.sink, self.rows)


def test_marking_a_reminder_sent_does_not_filter_on_the_row_owner(monkeypatch):
    """The silent bug this fixes: the person whose tick processed the task is
    frequently NOT the row's owner — it is the assignee. With a user_id filter
    the update matched zero rows and raised nothing, so notification_sent was
    never set and the task re-notified every two minutes, forever.

    The task id is a uuid and the gate above decides who may act on it, so the
    id alone is the correct scope here."""
    fake = _UpdateSupabase([])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.mark_notification_sent("user-3", "t-1")

    assert fake.sink["update"] == {"notification_sent": True}
    assert ("id", "t-1") in fake.sink["eq"]
    assert all(col != "user_id" for col, _ in fake.sink["eq"])
```

- [ ] **Step 2: Run it and watch it fail**

Run: `./venv/Scripts/python.exe -m pytest tests/test_task_ownership_reads.py -q -k notification`
Expected: FAIL — the assertion that no `user_id` filter was applied.

- [ ] **Step 3: Implement**

```python
def mark_notification_sent(user_id: str, record_id: str) -> None:
    """
    Sets notification_sent = True. Scoped by task id ALONE, on purpose.

    It used to carry .eq("user_id", user_id) as well. Once a task can be
    processed by the tick of somebody who did not create it — its ASSIGNEE —
    that filter matches zero rows and raises nothing, so the flag is never set
    and the same reminder fires on every ~2-minute tick forever. A silent
    no-op is the worst shape that bug could have taken.

    `user_id` stays in the signature: every caller passes it, it is what the
    log line is worth reading for, and access.py is what decides whether the
    caller was entitled to get this far.
    """
    supabase.table("tasks").update({"notification_sent": True}).eq("id", record_id).execute()
    logger.info(f"[notify] marked task {record_id} notified (tick user {user_id})")
```

- [ ] **Step 4: Run the tests**

Run: `./venv/Scripts/python.exe -m pytest tests/test_task_ownership_reads.py -q`
Expected: `5 passed`.

Full suite: `./venv/Scripts/python.exe -m pytest tests/ -q` → `378 passed`.

- [ ] **Step 5: Update the docs and commit**

Append to `docs/DATABASE_SCHEMA.md` under the `tasks` section: a note that
`notification_sent` is a single boolean per task and therefore records ONE delivery, which
is why an owner who opts into a team's reminders is notified in the same pass as the
assignee rather than separately.

Overwrite `docs/CURRENT_TASK.md` for the new task, keeping the `ACTIVE TASK —` first line
exact.

```bash
git add repository.py tests/test_task_ownership_reads.py docs/DATABASE_SCHEMA.md docs/CURRENT_TASK.md
git commit -m "A reminder can be marked sent by the person it was actually for"
```

---

## Self-Review

**Spec coverage.** Slice 1 of the spec's implementation order is "Tables, the two reads,
the write gate", and every part is covered: tables and columns (Task 1), models (Task 2),
membership (Task 3), `visible_to` (Task 4), `belongs_to` plus the scheduler repoint
(Task 5), the gate (Task 6), and the `mark_notification_sent` consequence the spec calls
out explicitly in decision 5 (Task 7). Slice 1 does **not** cover: invites, members UI,
assignment UI, archiving behaviour, notification delivery to the assignee, or the activity
log — those are slices 2-5 and their tables exist here only so the schema lands in one
migration.

**Not built here, on purpose:** `workspace_invites` and `workspace_activity` get tables in
Task 1 and no code at all. Creating them now means one migration for the owner to run by
hand instead of three.

**Type consistency.** `get_member_workspace_ids` returns `list[str]` in Task 3 and is
consumed as a list in Tasks 4 and 6. `task_ownership` returns the same four-key dict in
every place it appears. `WorkspaceMember` field names match between `models.py` (Task 2)
and `_supabase_row_to_member` (Task 3).

**Known risk, flagged rather than hidden:** Task 6 will break existing tests that exercise
`services.update_task` / `delete_task` with a stubbed repository, because the gate
performs a real lookup. The step says so and says the fix is to stub
`access.task_ownership`, not to remove the gate. The number of affected tests is not known
in advance — that is the honest state, and the step is written so that it is discovered
rather than assumed away.
