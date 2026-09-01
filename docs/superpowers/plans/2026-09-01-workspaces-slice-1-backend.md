# Workspaces & Categories — Slice 1 (schema + backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every task a workspace and a category that the user owns, served by real
endpoints, without changing one pixel of the UI.

**Architecture:** Two new owner-scoped tables (`workspaces`, `categories`) and two new
nullable foreign keys on `tasks`. The existing `tasks.category` TEXT column stays and
keeps working for the whole of this slice — nothing is dropped here. Hostaway's escalation
stops keying on the literal string `"Hostaway"` and starts keying on the one category row
carrying `system_key = 'hostaway'`, which is the single change that lets a user-defined
category system exist without the integration noticing.

**Tech Stack:** FastAPI, Pydantic v2, Supabase (PostgreSQL) via `supabase-py`, pytest.

**Spec:** `docs/superpowers/specs/2026-08-31-workspaces-and-categories-design.md`

## Global Constraints

- **Every query is scoped by `user_id`.** The backend uses the Supabase SECRET key and
  bypasses RLS, so app-code filtering is the primary protection and RLS is defence in
  depth. A row id alone must never reach another user's data.
- **Nothing is dropped in this slice.** `tasks.category` and `recurrence_rules.category`
  survive intact. Part B of the migration is a separate file, run later, by hand.
- **`tasks.ai_suggested_category` is not touched at all.** It is `Field(frozen=True)` and
  holds a frozen archive of the old vocabulary.
- **Category colours are hex strings** (`'#2563eb'`), stored on the row, not CSS variable
  names.
- Backend suite baseline: **209 passing** (2026-08-17). Run with
  `./venv/Scripts/python.exe -m pytest tests/ -q`. The number goes up, never down.
- Repository row-readers use `_get(row, key, default)`, never `row.get(key, default)` —
  Supabase returns explicit `None` for NULL columns and a bare `.get` default will not
  catch it.
- Tests are pure and offline. No test may reach Supabase, Google, Hostaway or Gemini.

---

## File Structure

| File | Responsibility |
|---|---|
| `docs/migrations/2026-09-01-workspaces-and-categories.sql` | **New.** Part A: create tables, add columns, seed per user, copy data, print counts. Run by the owner in the Supabase SQL Editor. |
| `models.py` | **Modify.** New `Workspace` and `Category` models; two new fields each on `TaskRecord` and `RecurrenceRule`; `active_workspace_id` on `AppSettings`. |
| `repository.py` | **Modify.** Row-readers and CRUD for both new tables; `get_system_category`; the two new columns carried through the task read/write path; `get_active_hostaway_tasks` rekeyed. |
| `main.py` | **Modify.** Seven new endpoints, their response models, the `workspace_id` filter on `GET /tasks`, and the Hostaway webhook writing the system category. |
| `services.py` | **Modify.** One invariant: a task's `category_id` must resolve to a category inside the task's own `workspace_id`. |
| `tests/test_workspaces_repository.py` | **New.** Repository CRUD, every query scoped to `user_id`. |
| `tests/test_workspaces_api.py` | **New.** The seven endpoints and their guards. |
| `tests/test_category_invariants.py` | **New.** The cross-workspace invariant and the system-category protections. |
| `tests/test_hostaway_system_category.py` | **New.** Escalation and webhook creation keyed on `system_key`. |

---

## Task 1: The migration, Part A

**Files:**
- Create: `docs/migrations/2026-09-01-workspaces-and-categories.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: tables `workspaces`, `categories`; columns `tasks.workspace_id`,
  `tasks.category_id`, `recurrence_rules.workspace_id`, `recurrence_rules.category_id`,
  `app_settings.active_workspace_id`. Every later task assumes these column names.

This task writes a file. **It does not run it.** The owner runs it in the Supabase SQL
Editor and reads the counts it prints.

- [ ] **Step 1: Write the migration file**

```sql
-- Workspaces and user-defined categories — PART A of 2.
-- Design: docs/superpowers/specs/2026-08-31-workspaces-and-categories-design.md
-- Run in the Supabase SQL Editor.
--
-- THIS FILE CREATES AND COPIES. IT DROPS NOTHING.
-- tasks.category and recurrence_rules.category survive untouched, and the app
-- keeps reading them for the whole of Slice 1. Part B drops them, and must not
-- be run until a human has read the counts printed at the bottom of this file.

begin;

-- ---------------------------------------------------------------- workspaces
create table if not exists workspaces (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  color       text,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  unique (user_id, name)
);

create index if not exists workspaces_user_id_idx on workspaces (user_id);

alter table workspaces enable row level security;

drop policy if exists "workspaces are owner-only" on workspaces;
create policy "workspaces are owner-only" on workspaces
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------- categories
-- user_id is denormalised (it is reachable via workspace_id -> workspaces).
-- Deliberate: every RLS policy in this database is the literal expression
-- auth.uid() = user_id, and a policy that joins to a second table to decide is
-- both slower and a shape nobody here has reviewed.
--
-- unique (user_id, system_key): Postgres treats NULLs as distinct, so a user
-- may have any number of ordinary categories (system_key NULL) but only ever
-- one 'hostaway'. Two would split escalation in half.
create table if not exists categories (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  workspace_id  uuid not null references workspaces (id) on delete cascade,
  name          text not null,
  color         text,
  position      integer not null default 0,
  system_key    text,
  created_at    timestamptz not null default now(),
  unique (workspace_id, name),
  unique (user_id, system_key)
);

create index if not exists categories_workspace_id_idx on categories (workspace_id);
create index if not exists categories_user_id_idx on categories (user_id);

alter table categories enable row level security;

drop policy if exists "categories are owner-only" on categories;
create policy "categories are owner-only" on categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ------------------------------------------------------------- new columns
-- ON DELETE SET NULL on both, on purpose: deleting a container must never
-- delete work. A task whose workspace or category is removed becomes unfiled,
-- it does not disappear.
alter table tasks
  add column if not exists workspace_id uuid references workspaces (id) on delete set null,
  add column if not exists category_id  uuid references categories (id) on delete set null;

create index if not exists tasks_user_workspace_idx on tasks (user_id, workspace_id);

alter table recurrence_rules
  add column if not exists workspace_id uuid references workspaces (id) on delete set null,
  add column if not exists category_id  uuid references categories (id) on delete set null;

-- NULL means "Όλα" (show every workspace), which is also the default for a
-- user who has never touched the switcher — so no backfill is needed.
alter table app_settings
  add column if not exists active_workspace_id uuid references workspaces (id) on delete set null;

-- ----------------------------------------------------------- seed, per user
-- auth.users, not profiles: auth.users is the authoritative list every other
-- table already references, and colleagues each have their own account and
-- their own Hostaway connection (see DATABASE_SCHEMA.md on hostaway_connections
-- — account_id is deliberately NOT unique because fifteen staff share one
-- Hostaway account). Seeding only the owner would leave their tasks orphaned.
insert into workspaces (user_id, name, color, position)
select u.id, 'Business', '#2563eb', 0 from auth.users u
on conflict (user_id, name) do nothing;

insert into workspaces (user_id, name, color, position)
select u.id, 'Personal', '#16a34a', 1 from auth.users u
on conflict (user_id, name) do nothing;

insert into categories (user_id, workspace_id, name, color, position, system_key)
select w.user_id, w.id, 'Hostaway', '#f59e0b', 0, 'hostaway'
from workspaces w
where w.name = 'Business'
on conflict (user_id, system_key) do nothing;

-- ------------------------------------------------------------- copy the data
-- Each statement guards on `workspace_id is null` so re-running this file is
-- harmless — it will not overwrite a placement the user has since changed.

update tasks t set workspace_id = w.id
from workspaces w
where w.user_id = t.user_id and w.name = 'Business'
  and t.category = 'Business' and t.workspace_id is null;

-- Hostaway is a provenance, not a category: it lands in the Business workspace
-- AND in the locked category, which is what escalation will key on from now on.
update tasks t set workspace_id = c.workspace_id, category_id = c.id
from categories c
where c.user_id = t.user_id and c.system_key = 'hostaway'
  and t.category = 'Hostaway' and t.workspace_id is null;

update tasks t set workspace_id = w.id
from workspaces w
where w.user_id = t.user_id and w.name = 'Personal'
  and t.category = 'Personal' and t.workspace_id is null;

-- category = 'Unknown' is deliberately left with workspace_id NULL. That IS
-- "Αταξινόμητα" — Unknown was never a category, it meant "the classifier could
-- not tell", and NULL says exactly that without inventing a bucket.

-- recurrence_rules has no Hostaway rows: its CHECK constraint excluded that
-- category from the day the table was created.
update recurrence_rules r set workspace_id = w.id
from workspaces w
where w.user_id = r.user_id and w.name = 'Business'
  and r.category = 'Business' and r.workspace_id is null;

update recurrence_rules r set workspace_id = w.id
from workspaces w
where w.user_id = r.user_id and w.name = 'Personal'
  and r.category = 'Personal' and r.workspace_id is null;

commit;

-- ===========================================================================
-- STOP HERE. Read these four results before running Part B.
-- ===========================================================================

-- 1. Every task, by where it landed. The 'Αταξινόμητα' count must equal the
--    number of tasks whose old category was 'Unknown' — nothing else.
select coalesce(w.name, 'Αταξινόμητα') as workspace,
       t.category                       as old_category,
       count(*)                         as tasks
from tasks t
left join workspaces w on w.id = t.workspace_id
group by 1, 2
order by 1, 2;

-- 2. The arithmetic that must balance: total before = total placed + unfiled.
select count(*)                                            as tasks_total,
       count(*) filter (where workspace_id is not null)     as placed,
       count(*) filter (where workspace_id is null)         as unfiled,
       count(*) filter (where category = 'Unknown')         as was_unknown
from tasks;

-- 3. Every Hostaway task must have got the locked category. The second
--    number must be ZERO — a non-zero here means guest tasks that escalation
--    will stop finding once Part B removes the old column.
select count(*) filter (where category_id is not null) as hostaway_with_category,
       count(*) filter (where category_id is null)     as hostaway_MISSING_category
from tasks
where category = 'Hostaway';

-- 4. One Business, one Personal and one locked Hostaway category per account.
select u.email,
       count(distinct w.id)                                      as workspaces,
       count(distinct c.id) filter (where c.system_key = 'hostaway') as hostaway_categories
from auth.users u
left join workspaces w on w.user_id = u.id
left join categories c on c.user_id = u.id
group by u.email
order by u.email;
```

- [ ] **Step 2: Verify the file parses as SQL and drops nothing**

Run: `grep -n -i "drop table\|drop column\|delete from\|truncate" docs/migrations/2026-09-01-workspaces-and-categories.sql`
Expected: only the two `drop policy if exists` lines. **No** `drop table`, `drop column`,
`delete from` or `truncate`. If any appear, the file is wrong — Part A never destroys.

- [ ] **Step 3: Commit**

```bash
git add docs/migrations/2026-09-01-workspaces-and-categories.sql
git commit -m "Migration part A: the containers exist, and nothing is dropped yet"
```

---

## Task 2: The models

**Files:**
- Modify: `models.py`
- Test: `tests/test_workspaces_repository.py` (created here, grown in Tasks 3-5)

**Interfaces:**
- Consumes: Task 1's column names.
- Produces: `Workspace(record_id, name, color, position, created_at)`,
  `Category(record_id, workspace_id, name, color, position, system_key, created_at)`,
  `TaskRecord.workspace_id: Optional[str]`, `TaskRecord.category_id: Optional[str]`,
  the same two on `RecurrenceRule`, and `AppSettings.active_workspace_id: Optional[str]`.
  Every later task uses these exact names.

- [ ] **Step 1: Write the failing test**

Create `tests/test_workspaces_repository.py`:

```python
"""
Workspaces and categories: the two tables that turn a category from a word into
a row. Every query here must be scoped to user_id — the backend uses the secret
key and bypasses RLS, so this scoping IS the protection.
"""
from models import Category, Workspace


def test_a_workspace_needs_only_a_name():
    """Everything else has a sane default, because the create endpoint takes
    only a name and the user should not have to pick a colour to get started."""
    w = Workspace(name="Business")

    assert w.name == "Business"
    assert w.position == 0
    assert w.color is None
    assert w.record_id is None


def test_an_ordinary_category_has_no_system_key():
    """system_key is what marks a row the integration owns. A user-made
    category must never carry one, or it becomes undeletable."""
    c = Category(workspace_id="ws-1", name="γραφείο")

    assert c.system_key is None
    assert c.workspace_id == "ws-1"


def test_the_hostaway_category_carries_its_system_key():
    c = Category(workspace_id="ws-1", name="Hostaway", system_key="hostaway")

    assert c.system_key == "hostaway"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./venv/Scripts/python.exe -m pytest tests/test_workspaces_repository.py -q`
Expected: FAIL with `ImportError: cannot import name 'Category' from 'models'`

- [ ] **Step 3: Add the two models to `models.py`**

Insert after `class AppSettings` and before `class RecurrenceRule`:

```python
class Workspace(BaseModel):
    """
    A top-level container the user creates and names. Categories live inside it;
    tasks point at it.

    `user_id` is not a field here, the same ownership-is-a-data-layer-concern
    rule TaskRecord follows — the repository scopes every query and never
    surfaces the owner to the API.
    """
    record_id: Optional[str] = None
    name: str = Field(max_length=40)
    color: Optional[str] = None
    position: int = 0
    created_at: Optional[str] = None


class Category(BaseModel):
    """
    A user-named grouping inside one workspace.

    `system_key` is NULL for everything the user creates and 'hostaway' on
    exactly one row per account. That row is fed by the integration, cannot be
    renamed or deleted, and is what the escalation query keys on — see
    repository.get_active_hostaway_tasks.
    """
    record_id: Optional[str] = None
    workspace_id: str
    name: str = Field(max_length=40)
    color: Optional[str] = None
    position: int = 0
    system_key: Optional[str] = None
    created_at: Optional[str] = None
```

- [ ] **Step 4: Add the new fields to the existing models**

In `TaskRecord`, after the `cancelled_at` field:

```python
    # Workspaces (2026-09-01). Both nullable and both ON DELETE SET NULL in the
    # database: deleting a container must never delete work, so a task whose
    # workspace or category is removed becomes unfiled rather than vanishing.
    # `category` (the old TEXT column) is still the live one throughout Slice 1
    # and is dropped only by migration Part B.
    workspace_id: Optional[str] = None
    category_id: Optional[str] = None
```

In `RecurrenceRule`, after `materialized_through`:

```python
    workspace_id: Optional[str] = None
    category_id: Optional[str] = None
```

In `AppSettings`, after `calendar_show_events`:

```python
    # NULL means "Όλα" — every workspace at once, and the default for a user
    # who has never touched the switcher.
    active_workspace_id: Optional[str] = None
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `./venv/Scripts/python.exe -m pytest tests/test_workspaces_repository.py -q`
Expected: 3 passed

- [ ] **Step 6: Run the whole suite — nothing may regress**

Run: `./venv/Scripts/python.exe -m pytest tests/ -q`
Expected: 212 passed (209 + 3)

- [ ] **Step 7: Commit**

```bash
git add models.py tests/test_workspaces_repository.py
git commit -m "The workspace and the category become models"
```

---

## Task 3: Repository CRUD for workspaces

**Files:**
- Modify: `repository.py`
- Test: `tests/test_workspaces_repository.py`

**Interfaces:**
- Consumes: `Workspace` from Task 2.
- Produces: `create_workspace(user_id, workspace) -> Workspace`,
  `get_workspaces(user_id) -> list[Workspace]`,
  `get_workspace(user_id, workspace_id) -> Optional[Workspace]`,
  `update_workspace(user_id, workspace_id, updates: dict) -> Optional[Workspace]`,
  `delete_workspace(user_id, workspace_id) -> None`.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_workspaces_repository.py`:

```python
import repository


class _FakeQuery:
    """Chainable stand-in for the supabase query builder. Records every call so
    a test can assert WHICH filters were applied, not just what came back."""

    def __init__(self, sink, rows):
        self.sink, self.rows = sink, rows

    def select(self, *a):
        self.sink["select"] = a
        return self

    def insert(self, values):
        self.sink["insert"] = values
        return self

    def update(self, values):
        self.sink["update"] = values
        return self

    def delete(self):
        self.sink["delete"] = True
        return self

    def eq(self, col, val):
        self.sink.setdefault("eq", []).append((col, val))
        return self

    def order(self, col, **kw):
        self.sink["order"] = (col, kw)
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


def _ws_row(**overrides):
    base = {"id": "ws-1", "user_id": "user-1", "name": "Business",
            "color": "#2563eb", "position": 0, "created_at": "2026-09-01T00:00:00Z"}
    base.update(overrides)
    return base


def test_listing_workspaces_is_scoped_to_the_user_and_ordered(monkeypatch):
    fake = _FakeSupabase([_ws_row()])
    monkeypatch.setattr(repository, "supabase", fake)

    result = repository.get_workspaces("user-1")

    assert fake.sink["table"] == "workspaces"
    assert ("user_id", "user-1") in fake.sink["eq"]
    assert fake.sink["order"][0] == "position"
    assert result[0].name == "Business"
    assert result[0].record_id == "ws-1"


def test_reading_one_workspace_filters_on_BOTH_id_and_user(monkeypatch):
    """A workspace id alone must never read another user's row. The backend
    bypasses RLS, so this pair of filters is the whole protection."""
    fake = _FakeSupabase([_ws_row()])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.get_workspace("user-1", "ws-1")

    assert ("id", "ws-1") in fake.sink["eq"]
    assert ("user_id", "user-1") in fake.sink["eq"]


def test_creating_a_workspace_stamps_the_owner(monkeypatch):
    fake = _FakeSupabase([_ws_row()])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.create_workspace("user-1", Workspace(name="Business", color="#2563eb"))

    assert fake.sink["insert"]["user_id"] == "user-1"
    assert fake.sink["insert"]["name"] == "Business"
    assert "id" not in fake.sink["insert"]


def test_deleting_a_workspace_is_scoped_to_the_user(monkeypatch):
    fake = _FakeSupabase([])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.delete_workspace("user-1", "ws-1")

    assert fake.sink["delete"] is True
    assert ("id", "ws-1") in fake.sink["eq"]
    assert ("user_id", "user-1") in fake.sink["eq"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./venv/Scripts/python.exe -m pytest tests/test_workspaces_repository.py -q`
Expected: FAIL with `AttributeError: module 'repository' has no attribute 'get_workspaces'`

- [ ] **Step 3: Implement in `repository.py`**

Add after `delete_recurrence_rule` (around line 1348):

```python
# --------------------------------------------------------------- workspaces
# Two tables added 2026-09-01 that turn the category from a fixed word into a
# row the user owns. See
# docs/superpowers/specs/2026-08-31-workspaces-and-categories-design.md.


def _supabase_row_to_workspace(row: dict) -> Workspace:
    """A workspaces row as the Pydantic model. user_id is not surfaced, the
    same rule _supabase_row_to_task and _supabase_row_to_rule follow."""
    return Workspace(
        record_id=row.get("id"),
        name=_get(row, "name", ""),
        color=row.get("color"),
        position=_get(row, "position", 0),
        created_at=row.get("created_at"),
    )


def create_workspace(user_id: str, workspace: Workspace) -> Workspace:
    fields = {
        "user_id": user_id,
        "name": workspace.name,
        "color": workspace.color,
        "position": workspace.position,
    }
    response = supabase.table("workspaces").insert(fields).execute()
    row = (response.data or [{}])[0]
    logger.info(f"[workspaces] Created workspace {row.get('id')} for user {user_id}")
    return _supabase_row_to_workspace(row)


def get_workspaces(user_id: str) -> list[Workspace]:
    """Ordered by position, then created_at — position is what the user drags,
    created_at only breaks ties between two rows never reordered."""
    response = (
        supabase.table("workspaces")
        .select("*")
        .eq("user_id", user_id)
        .order("position", desc=False)
        .order("created_at", desc=False)
        .execute()
    )
    return [_supabase_row_to_workspace(row) for row in (response.data or [])]


def get_workspace(user_id: str, workspace_id: str) -> Optional[Workspace]:
    """Both filters are required. A workspace id alone must never read another
    user's row — the backend uses the service key and bypasses RLS."""
    response = (
        supabase.table("workspaces")
        .select("*")
        .eq("id", workspace_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    rows = response.data or []
    return _supabase_row_to_workspace(rows[0]) if rows else None


def update_workspace(user_id: str, workspace_id: str, updates: dict) -> Optional[Workspace]:
    if not updates:
        return get_workspace(user_id, workspace_id)
    response = (
        supabase.table("workspaces")
        .update(updates)
        .eq("id", workspace_id)
        .eq("user_id", user_id)
        .execute()
    )
    rows = response.data or []
    return _supabase_row_to_workspace(rows[0]) if rows else None


def delete_workspace(user_id: str, workspace_id: str) -> None:
    """The database does the rest: categories CASCADE with the workspace, while
    tasks pointing at either are SET NULL and become unfiled. Deleting a
    container never deletes work."""
    supabase.table("workspaces").delete().eq("id", workspace_id).eq("user_id", user_id).execute()
```

Add `Workspace` and `Category` to the existing `from models import ...` line at the top of
`repository.py`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `./venv/Scripts/python.exe -m pytest tests/test_workspaces_repository.py -q`
Expected: 7 passed

- [ ] **Step 5: Commit**

```bash
git add repository.py tests/test_workspaces_repository.py
git commit -m "Workspaces can be written and read, always scoped to their owner"
```

---

## Task 4: Repository CRUD for categories

**Files:**
- Modify: `repository.py`
- Test: `tests/test_workspaces_repository.py`

**Interfaces:**
- Consumes: `Category` from Task 2; `_FakeSupabase` from Task 3's test file.
- Produces: `create_category(user_id, category) -> Category`,
  `get_categories(user_id) -> list[Category]`,
  `get_category(user_id, category_id) -> Optional[Category]`,
  `update_category(user_id, category_id, updates: dict) -> Optional[Category]`,
  `delete_category(user_id, category_id) -> None`,
  `get_system_category(user_id, system_key: str) -> Optional[Category]`.
  Task 6 and Task 7 both depend on `get_system_category`.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_workspaces_repository.py`:

```python
def _cat_row(**overrides):
    base = {"id": "cat-1", "user_id": "user-1", "workspace_id": "ws-1",
            "name": "γραφείο", "color": "#888888", "position": 0,
            "system_key": None, "created_at": "2026-09-01T00:00:00Z"}
    base.update(overrides)
    return base


def test_listing_categories_is_scoped_to_the_user(monkeypatch):
    """Scoped by user, NOT by workspace: the frontend loads every category once
    and groups them by workspace_id in the provider, rather than making one
    request per workspace on every app open."""
    fake = _FakeSupabase([_cat_row()])
    monkeypatch.setattr(repository, "supabase", fake)

    result = repository.get_categories("user-1")

    assert fake.sink["table"] == "categories"
    assert ("user_id", "user-1") in fake.sink["eq"]
    assert result[0].name == "γραφείο"
    assert result[0].workspace_id == "ws-1"


def test_creating_a_category_stamps_owner_and_workspace(monkeypatch):
    fake = _FakeSupabase([_cat_row()])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.create_category("user-1", Category(workspace_id="ws-1", name="γραφείο"))

    assert fake.sink["insert"]["user_id"] == "user-1"
    assert fake.sink["insert"]["workspace_id"] == "ws-1"
    assert fake.sink["insert"]["system_key"] is None


def test_the_system_category_is_found_by_its_key_not_its_name(monkeypatch):
    """The whole point of system_key. The name 'Hostaway' is a label the user
    sees; the key is what escalation and the webhook actually match on, so
    renaming the label could never break the integration."""
    fake = _FakeSupabase([_cat_row(id="cat-h", name="Hostaway", system_key="hostaway")])
    monkeypatch.setattr(repository, "supabase", fake)

    result = repository.get_system_category("user-1", "hostaway")

    assert ("system_key", "hostaway") in fake.sink["eq"]
    assert ("user_id", "user-1") in fake.sink["eq"]
    assert result.record_id == "cat-h"


def test_a_missing_system_category_returns_None_rather_than_raising(monkeypatch):
    """An account that has not run the migration has no such row. Callers
    branch on None; a raise here would take down the whole scheduler tick."""
    fake = _FakeSupabase([])
    monkeypatch.setattr(repository, "supabase", fake)

    assert repository.get_system_category("user-1", "hostaway") is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./venv/Scripts/python.exe -m pytest tests/test_workspaces_repository.py -q`
Expected: FAIL with `AttributeError: module 'repository' has no attribute 'get_categories'`

- [ ] **Step 3: Implement in `repository.py`**

Add directly after `delete_workspace`:

```python
# --------------------------------------------------------------- categories


def _supabase_row_to_category(row: dict) -> Category:
    return Category(
        record_id=row.get("id"),
        workspace_id=_get(row, "workspace_id", ""),
        name=_get(row, "name", ""),
        color=row.get("color"),
        position=_get(row, "position", 0),
        system_key=row.get("system_key"),
        created_at=row.get("created_at"),
    )


def create_category(user_id: str, category: Category) -> Category:
    fields = {
        "user_id": user_id,
        "workspace_id": category.workspace_id,
        "name": category.name,
        "color": category.color,
        "position": category.position,
        "system_key": category.system_key,
    }
    response = supabase.table("categories").insert(fields).execute()
    row = (response.data or [{}])[0]
    logger.info(f"[workspaces] Created category {row.get('id')} for user {user_id}")
    return _supabase_row_to_category(row)


def get_categories(user_id: str) -> list[Category]:
    """Every category this user owns, across all their workspaces.

    Scoped by user rather than by workspace on purpose: the frontend needs the
    whole set on every app open (to colour task chips that may belong to any
    workspace) and grouping them by workspace_id in the provider is one request
    instead of one per workspace.
    """
    response = (
        supabase.table("categories")
        .select("*")
        .eq("user_id", user_id)
        .order("position", desc=False)
        .order("created_at", desc=False)
        .execute()
    )
    return [_supabase_row_to_category(row) for row in (response.data or [])]


def get_category(user_id: str, category_id: str) -> Optional[Category]:
    response = (
        supabase.table("categories")
        .select("*")
        .eq("id", category_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    rows = response.data or []
    return _supabase_row_to_category(rows[0]) if rows else None


def get_system_category(user_id: str, system_key: str) -> Optional[Category]:
    """
    The one category the integration owns, found by its KEY and never by its
    name. That indirection is the reason a user-defined category system can
    exist at all without the Hostaway path noticing: the label is the user's to
    rename, the key is not.

    Returns None — never raises — for an account that predates the migration.
    Callers run inside the scheduler's per-user loop, where a raise costs every
    later user their tick.
    """
    response = (
        supabase.table("categories")
        .select("*")
        .eq("user_id", user_id)
        .eq("system_key", system_key)
        .limit(1)
        .execute()
    )
    rows = response.data or []
    return _supabase_row_to_category(rows[0]) if rows else None


def update_category(user_id: str, category_id: str, updates: dict) -> Optional[Category]:
    if not updates:
        return get_category(user_id, category_id)
    response = (
        supabase.table("categories")
        .update(updates)
        .eq("id", category_id)
        .eq("user_id", user_id)
        .execute()
    )
    rows = response.data or []
    return _supabase_row_to_category(rows[0]) if rows else None


def delete_category(user_id: str, category_id: str) -> None:
    """Tasks pointing here are SET NULL by the database and become unfiled."""
    supabase.table("categories").delete().eq("id", category_id).eq("user_id", user_id).execute()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./venv/Scripts/python.exe -m pytest tests/test_workspaces_repository.py -q`
Expected: 11 passed

- [ ] **Step 5: Commit**

```bash
git add repository.py tests/test_workspaces_repository.py
git commit -m "Categories become rows, and the system one is found by key"
```

---

## Task 5: The task read/write path carries the two new columns

**Files:**
- Modify: `repository.py` (`_supabase_row_to_task`, and the task write path)
- Test: `tests/test_workspaces_repository.py`

**Interfaces:**
- Consumes: `TaskRecord.workspace_id` / `.category_id` from Task 2.
- Produces: tasks round-trip both columns. Tasks 6-10 assume a `TaskRecord` read from
  the database already carries them.

- [ ] **Step 1: Find the two functions**

Run: `grep -n "def _supabase_row_to_task\|def _task_to_supabase_fields" repository.py`
Read both completely before editing. The writer's exact name is whatever that grep
reports; the steps below call it `_task_to_supabase_fields`.

- [ ] **Step 2: Write the failing test**

Append to `tests/test_workspaces_repository.py`:

```python
def test_a_task_row_carries_its_workspace_and_category(monkeypatch):
    """Read-side. Both are nullable, so both must survive as None rather than
    being defaulted to a string — 'unfiled' is a real, meaningful state."""
    row = {"id": "task-1", "task_name": "Χ", "description": "", "category": "Business",
           "priority": "P2", "ai_suggested_category": "Business",
           "ai_suggested_priority": "P2", "workspace_id": "ws-1", "category_id": "cat-1"}

    task = repository._supabase_row_to_task(row)

    assert task.workspace_id == "ws-1"
    assert task.category_id == "cat-1"


def test_an_unfiled_task_keeps_None_and_is_not_defaulted():
    row = {"id": "task-2", "task_name": "Χ", "description": "", "category": "Unknown",
           "priority": "P3", "ai_suggested_category": "Unknown",
           "ai_suggested_priority": "P3", "workspace_id": None, "category_id": None}

    task = repository._supabase_row_to_task(row)

    assert task.workspace_id is None
    assert task.category_id is None
```

- [ ] **Step 3: Run test to verify it fails**

Run: `./venv/Scripts/python.exe -m pytest tests/test_workspaces_repository.py -q`
Expected: FAIL — `assert None == 'ws-1'` (the reader ignores the columns)

- [ ] **Step 4: Add both columns to the reader**

In `_supabase_row_to_task`, alongside the other `row.get(...)` lines:

```python
        workspace_id=row.get("workspace_id"),
        category_id=row.get("category_id"),
```

`row.get`, deliberately not `_get(row, key, default)`: NULL here is a real value meaning
"unfiled", not a blank standing in for a typed default.

- [ ] **Step 5: Add both columns to the writer**

In `_task_to_supabase_fields`, alongside the other optional passthrough fields:

```python
        "workspace_id": task.workspace_id,
        "category_id": task.category_id,
```

- [ ] **Step 6: Run the whole suite**

Run: `./venv/Scripts/python.exe -m pytest tests/ -q`
Expected: 222 passed

- [ ] **Step 7: Commit**

```bash
git add repository.py tests/test_workspaces_repository.py
git commit -m "A task remembers which box it is in"
```

---

## Task 6: Hostaway escalation keys on the system category

**Files:**
- Modify: `repository.py:558-571` (`get_active_hostaway_tasks`)
- Test: `tests/test_hostaway_system_category.py` (new)

**Interfaces:**
- Consumes: `get_system_category` from Task 4.
- Produces: `get_active_hostaway_tasks(user_id, tasks=None)` — same signature, new
  matching rule.

**Why this is not keyed on `hostaway_conversation_id`:** that column is written as
`str(conversation_id) if conversation_id else None` (`main.py:1334`) and can legitimately
be NULL. A NULL there would silently drop a P1 guest task out of escalation. `system_key`
cannot be NULL by accident.

- [ ] **Step 1: Write the failing test**

Create `tests/test_hostaway_system_category.py`:

```python
"""
Escalation stops matching the literal word "Hostaway" and starts matching the
one category row carrying system_key='hostaway'. This is the single change that
lets categories become user-defined without the integration noticing.
"""
import repository
from models import Category, TaskRecord


def _task(**overrides):
    base = dict(record_id="t1", task_name="Guest", description="", category="Hostaway",
                priority="P1", ai_suggested_category="Hostaway", ai_suggested_priority="P1",
                approval_status=True)
    base.update(overrides)
    return TaskRecord(**base)


_HOSTAWAY_CAT = Category(record_id="cat-h", workspace_id="ws-1",
                         name="Hostaway", system_key="hostaway")


def test_escalation_finds_tasks_by_category_id(monkeypatch):
    monkeypatch.setattr(repository, "get_system_category", lambda u, k: _HOSTAWAY_CAT)
    tasks = [_task(record_id="t1", category_id="cat-h"),
             _task(record_id="t2", category_id="cat-other", category="Business")]

    result = repository.get_active_hostaway_tasks("user-1", tasks=tasks)

    assert [t.record_id for t in result] == ["t1"]


def test_a_renamed_hostaway_category_still_escalates(monkeypatch):
    """The name is the user's label. If matching were on the name, renaming it
    would silently stop every guest escalation on the account."""
    renamed = Category(record_id="cat-h", workspace_id="ws-1",
                       name="Μηνύματα επισκεπτών", system_key="hostaway")
    monkeypatch.setattr(repository, "get_system_category", lambda u, k: renamed)

    result = repository.get_active_hostaway_tasks("user-1", tasks=[_task(category_id="cat-h")])

    assert len(result) == 1


def test_closed_and_rejected_tasks_are_still_excluded(monkeypatch):
    """Pre-existing behaviour that must survive the rekeying."""
    monkeypatch.setattr(repository, "get_system_category", lambda u, k: _HOSTAWAY_CAT)
    tasks = [_task(record_id="open", category_id="cat-h"),
             _task(record_id="done", category_id="cat-h", is_completed=True),
             _task(record_id="rejected", category_id="cat-h", is_rejected=True)]

    result = repository.get_active_hostaway_tasks("user-1", tasks=tasks)

    assert [t.record_id for t in result] == ["open"]


def test_an_account_with_no_system_category_escalates_nothing(monkeypatch):
    """Rather than raising. This runs inside the scheduler's per-user loop,
    where one raise costs every user processed after it their whole tick — the
    lesson the Hostaway encryption key already taught once."""
    monkeypatch.setattr(repository, "get_system_category", lambda u, k: None)

    assert repository.get_active_hostaway_tasks("user-1", tasks=[_task(category_id="cat-h")]) == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./venv/Scripts/python.exe -m pytest tests/test_hostaway_system_category.py -q`
Expected: FAIL — the current implementation matches `t.category == "Hostaway"`, so
`test_an_account_with_no_system_category_escalates_nothing` returns one task instead of
none.

- [ ] **Step 3: Rewrite `get_active_hostaway_tasks`**

```python
def get_active_hostaway_tasks(
    user_id: str, tasks: Optional[list[TaskRecord]] = None
) -> list[TaskRecord]:
    """
    Returns all not-completed, not-rejected guest-message tasks belonging to
    user_id — the candidate set for escalation re-notification. Pass a
    pre-fetched `tasks` list to avoid a second table scan.

    Matched on the category whose system_key is 'hostaway', NOT on the literal
    word: since 2026-09-01 categories are rows the user names, and the label on
    this one is theirs to rename. The key is not.

    An account with no such category (one that predates the migration)
    escalates nothing rather than raising — this runs inside the scheduler's
    per-user loop, where a raise costs every later user their tick.
    """
    system_category = get_system_category(user_id, "hostaway")
    if system_category is None:
        return []

    all_tasks = tasks if tasks is not None else get_tasks_for_user(user_id)
    return [
        t for t in all_tasks
        if t.category_id == system_category.record_id
        and not t.is_completed and not t.is_rejected
    ]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./venv/Scripts/python.exe -m pytest tests/test_hostaway_system_category.py -q`
Expected: 4 passed

- [ ] **Step 5: Run the Hostaway suite — nothing may regress**

Run: `./venv/Scripts/python.exe -m pytest tests/ -q -k "hostaway or scheduler"`
Expected: all pass. If an existing test builds a `TaskRecord` with `category="Hostaway"`
and no `category_id`, it must be updated to set `category_id` and to stub
`get_system_category` — the word is no longer what matches.

- [ ] **Step 6: Commit**

```bash
git add repository.py tests/test_hostaway_system_category.py
git commit -m "Escalation follows the key, not the label"
```

---

## Task 7: The webhook files guest tasks into the system category

**Files:**
- Modify: `main.py:1315-1339`
- Test: `tests/test_hostaway_system_category.py`

**Interfaces:**
- Consumes: `get_system_category` from Task 4.
- Produces: a webhook-created task carries `workspace_id` and `category_id`. Task 6's
  escalation depends on this; without it, new guest tasks would never escalate.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_hostaway_system_category.py`:

```python
import main


def test_a_webhook_task_lands_in_the_system_category(monkeypatch):
    """Task 6 made escalation match on category_id. If the webhook did not set
    it, every NEW guest task would be created already invisible to escalation —
    the two changes only work as a pair."""
    captured = {}
    monkeypatch.setattr(main.repository, "get_system_category", lambda u, k: _HOSTAWAY_CAT)
    monkeypatch.setattr(main.service, "create_task_manual",
                        lambda u, fields: captured.update(fields))

    main._create_task_from_hostaway_message(
        user_id="user-1",
        task_name="Guest question",
        classification={"summary": "asks about check-in", "priority": "P1"},
        listing_name="Apartment A",
        reservation_details={"arrival_date": "2026-09-02", "departure_date": "2026-09-05"},
        message_body="What time is check-in?",
        conversation_id="conv-1",
        message_date="2026-09-01T10:00:00Z",
    )

    assert captured["category_id"] == "cat-h"
    assert captured["workspace_id"] == "ws-1"
    assert captured["category"] == "Hostaway"  # old column still written in Slice 1
```

**Before writing this test**, run
`grep -n "def _create_task_from_hostaway_message\|category\": \"Hostaway\"" main.py`
and read the enclosing function completely. Its real name and parameter list are whatever
that grep reports — match them exactly rather than the placeholder above.

- [ ] **Step 2: Run test to verify it fails**

Run: `./venv/Scripts/python.exe -m pytest tests/test_hostaway_system_category.py -q`
Expected: FAIL with `KeyError: 'category_id'`

- [ ] **Step 3: Set both columns at `main.py:1327`**

Replace the single `"category": "Hostaway",` line with:

```python
            # Both the old word and the new pair, for the whole of Slice 1: the
            # column is still live and is dropped only by migration Part B.
            # system_category is None only on an account that predates the
            # migration, and a guest task with no category is better than no
            # guest task at all.
            "category": "Hostaway",
            "workspace_id": system_category.workspace_id if system_category else None,
            "category_id": system_category.record_id if system_category else None,
```

and above the `service.create_task_manual(...)` call:

```python
    system_category = repository.get_system_category(user_id, "hostaway")
    if system_category is None:
        logging.warning(
            f"[hostaway webhook] No 'hostaway' system category for {user_id} — "
            "task will be created unfiled and will NOT escalate"
        )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./venv/Scripts/python.exe -m pytest tests/test_hostaway_system_category.py -q`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add main.py tests/test_hostaway_system_category.py
git commit -m "A guest message lands in the box escalation is watching"
```

---

## Task 8: The workspace endpoints

**Files:**
- Modify: `main.py` (response models near line 127; endpoints near line 675)
- Test: `tests/test_workspaces_api.py` (new)

**Interfaces:**
- Consumes: Task 3's repository functions.
- Produces: `GET /workspaces` returning `{"workspaces": [...], "categories": [...]}`,
  `POST /workspaces`, `PATCH /workspaces/{id}`, `DELETE /workspaces/{id}`.

**Why one endpoint returns both:** the frontend provider needs every workspace and every
category on each app open — a task chip may belong to any workspace, so a per-workspace
fetch would be one request per workspace on every launch.

- [ ] **Step 1: Write the failing test**

Create `tests/test_workspaces_api.py`:

```python
"""
The workspace endpoints. What matters beyond the write: GET returns workspaces
AND categories together (the provider needs both on every app open), and every
route is scoped so one user's id can never reach another's row.
"""
import pytest
from fastapi.testclient import TestClient

import main
from models import Category, Workspace

USER = "user-1"


@pytest.fixture
def client():
    main.app.dependency_overrides[main.get_current_user_id] = lambda: USER
    yield TestClient(main.app)
    main.app.dependency_overrides.clear()


def _ws(**overrides):
    base = dict(record_id="ws-1", name="Business", color="#2563eb", position=0)
    base.update(overrides)
    return Workspace(**base)


def _cat(**overrides):
    base = dict(record_id="cat-1", workspace_id="ws-1", name="γραφείο", position=0)
    base.update(overrides)
    return Category(**base)


def test_listing_returns_workspaces_and_categories_together(client, monkeypatch):
    monkeypatch.setattr(main.repository, "get_workspaces", lambda u: [_ws()])
    monkeypatch.setattr(main.repository, "get_categories", lambda u: [_cat()])

    r = client.get("/workspaces")

    assert r.status_code == 200
    assert r.json()["workspaces"][0]["name"] == "Business"
    assert r.json()["categories"][0]["name"] == "γραφείο"


def test_creating_a_workspace_returns_201(client, monkeypatch):
    monkeypatch.setattr(main.repository, "create_workspace", lambda u, w: _ws(name=w.name))

    r = client.post("/workspaces", json={"name": "Επενδύσεις"})

    assert r.status_code == 201
    assert r.json()["workspace"]["name"] == "Επενδύσεις"


def test_a_duplicate_workspace_name_is_409_not_500(client, monkeypatch):
    """The database's unique(user_id, name) would raise a generic exception and
    surface as a 500. The user typed a name that is already taken — that is a
    409 with a message they can act on."""
    monkeypatch.setattr(main.repository, "get_workspaces", lambda u: [_ws(name="Business")])

    r = client.post("/workspaces", json={"name": "Business"})

    assert r.status_code == 409


def test_editing_someone_elses_workspace_is_404(client, monkeypatch):
    monkeypatch.setattr(main.repository, "get_workspace", lambda u, i: None)

    r = client.patch("/workspaces/ws-999", json={"name": "Δικό μου τώρα"})

    assert r.status_code == 404


def test_deleting_a_workspace_reports_what_became_unfiled(client, monkeypatch):
    """The user is about to lose an organisation they built. Telling them how
    many tasks are about to become unfiled is the difference between an
    informed click and a surprise."""
    monkeypatch.setattr(main.repository, "get_workspace", lambda u, i: _ws())
    monkeypatch.setattr(main.repository, "count_tasks_in_workspace", lambda u, i: 12)
    monkeypatch.setattr(main.repository, "delete_workspace", lambda u, i: None)

    r = client.delete("/workspaces/ws-1")

    assert r.status_code == 200
    assert r.json()["tasks_unfiled"] == 12
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./venv/Scripts/python.exe -m pytest tests/test_workspaces_api.py -q`
Expected: FAIL — 404 on `/workspaces` (route does not exist)

- [ ] **Step 3: Add `count_tasks_in_workspace` to `repository.py`**

```python
def count_tasks_in_workspace(user_id: str, workspace_id: str) -> int:
    """How many tasks would become unfiled if this workspace went away. Asked
    before the delete, so the confirmation can say a number instead of a
    warning nobody reads."""
    response = (
        supabase.table("tasks")
        .select("id", count="exact")
        .eq("user_id", user_id)
        .eq("workspace_id", workspace_id)
        .execute()
    )
    return response.count or 0
```

- [ ] **Step 4: Add the response models to `main.py`** (beside `RecurrencesListResponse`, ~line 127)

```python
class WorkspacesListResponse(BaseModel):
    workspaces: list[Workspace]
    categories: list[Category]


class WorkspaceWriteResponse(BaseModel):
    workspace: Workspace


class WorkspaceDeleteResponse(BaseModel):
    deleted: bool
    tasks_unfiled: int


class WorkspaceCreateRequest(BaseModel):
    name: str = Field(max_length=40)
    color: Optional[str] = None
    position: int = 0


class WorkspaceUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, max_length=40)
    color: Optional[str] = None
    position: Optional[int] = None
```

- [ ] **Step 5: Add the four endpoints to `main.py`** (after the `/recurrences` block)

```python
# ---------------------------------------------------------------- workspaces


@app.get("/workspaces", response_model=WorkspacesListResponse)
def list_workspaces(user_id: str = Depends(get_current_user_id)):
    """
    Every workspace AND every category this user owns, in one call.

    Both together because the frontend provider needs the whole set on each app
    open — a task chip may belong to any workspace, so fetching categories per
    workspace would be one request per workspace on every launch.
    """
    try:
        return WorkspacesListResponse(
            workspaces=repository.get_workspaces(user_id),
            categories=repository.get_categories(user_id),
        )
    except Exception as e:
        logger.exception("Failed to list workspaces")
        raise HTTPException(status_code=500, detail=f"Failed to list workspaces: {str(e)}")


@app.post("/workspaces", response_model=WorkspaceWriteResponse, status_code=status.HTTP_201_CREATED)
def create_workspace(payload: WorkspaceCreateRequest, user_id: str = Depends(get_current_user_id)):
    # Checked here rather than left to the database's unique(user_id, name),
    # whose violation arrives as a generic exception and a wrong 500. The user
    # typed a name that is taken; that is a 409 they can act on.
    existing = repository.get_workspaces(user_id)
    if any(w.name == payload.name for w in existing):
        raise HTTPException(status_code=409, detail="A workspace with that name already exists")

    workspace = repository.create_workspace(user_id, Workspace(**payload.model_dump()))
    return WorkspaceWriteResponse(workspace=workspace)


@app.patch("/workspaces/{workspace_id}", response_model=WorkspaceWriteResponse)
def update_workspace(
    workspace_id: str,
    payload: WorkspaceUpdateRequest,
    user_id: str = Depends(get_current_user_id),
):
    if repository.get_workspace(user_id, workspace_id) is None:
        raise HTTPException(status_code=404, detail="Workspace not found")

    # exclude_unset only — a field sent explicitly as null is how a client says
    # "clear this" (color is legitimately nullable).
    updates = payload.model_dump(exclude_unset=True)
    if "name" in updates and any(
        w.name == updates["name"] and w.record_id != workspace_id
        for w in repository.get_workspaces(user_id)
    ):
        raise HTTPException(status_code=409, detail="A workspace with that name already exists")

    updated = repository.update_workspace(user_id, workspace_id, updates)
    if updated is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return WorkspaceWriteResponse(workspace=updated)


@app.delete("/workspaces/{workspace_id}", response_model=WorkspaceDeleteResponse)
def delete_workspace(workspace_id: str, user_id: str = Depends(get_current_user_id)):
    """
    Deletes the workspace and, by CASCADE, its categories. Tasks pointing at
    either are SET NULL by the database and become unfiled — deleting a
    container never deletes work. The count is read BEFORE the delete, because
    afterwards there is nothing left to count.
    """
    if repository.get_workspace(user_id, workspace_id) is None:
        raise HTTPException(status_code=404, detail="Workspace not found")

    affected = repository.count_tasks_in_workspace(user_id, workspace_id)
    repository.delete_workspace(user_id, workspace_id)
    return WorkspaceDeleteResponse(deleted=True, tasks_unfiled=affected)
```

Add `Workspace` and `Category` to `main.py`'s `from models import ...` line.

- [ ] **Step 6: Run tests to verify they pass**

Run: `./venv/Scripts/python.exe -m pytest tests/test_workspaces_api.py -q`
Expected: 5 passed

- [ ] **Step 7: Commit**

```bash
git add main.py repository.py tests/test_workspaces_api.py
git commit -m "Workspaces get a front door"
```

---

## Task 9: The category endpoints, and the guards that matter

**Files:**
- Modify: `main.py`
- Test: `tests/test_category_invariants.py` (new)

**Interfaces:**
- Consumes: Task 4's repository functions; Task 8's response-model conventions.
- Produces: `POST /categories`, `PATCH /categories/{id}`, `DELETE /categories/{id}`.

Three guards, each a spec requirement:
1. A category with `system_key` set cannot be renamed or deleted → **422**.
2. A category in a workspace that is not yours → **404**.
3. A duplicate name inside one workspace → **409**.

- [ ] **Step 1: Write the failing test**

Create `tests/test_category_invariants.py`:

```python
"""
The three things a category endpoint must refuse. Each one is a spec
requirement, and each one protects something a 500 would not explain.
"""
import pytest
from fastapi.testclient import TestClient

import main
from models import Category, Workspace

USER = "user-1"


@pytest.fixture
def client():
    main.app.dependency_overrides[main.get_current_user_id] = lambda: USER
    yield TestClient(main.app)
    main.app.dependency_overrides.clear()


def _cat(**overrides):
    base = dict(record_id="cat-1", workspace_id="ws-1", name="γραφείο", position=0)
    base.update(overrides)
    return Category(**base)


_SYSTEM = _cat(record_id="cat-h", name="Hostaway", system_key="hostaway")


def test_renaming_the_system_category_is_refused(client, monkeypatch):
    """Its label is cosmetic, but allowing the rename invites allowing the
    delete, and deleting it stops every guest escalation on the account."""
    monkeypatch.setattr(main.repository, "get_category", lambda u, i: _SYSTEM)

    r = client.patch("/categories/cat-h", json={"name": "Ό,τι θέλω"})

    assert r.status_code == 422


def test_deleting_the_system_category_is_refused(client, monkeypatch):
    monkeypatch.setattr(main.repository, "get_category", lambda u, i: _SYSTEM)

    r = client.delete("/categories/cat-h")

    assert r.status_code == 422


def test_recolouring_the_system_category_is_allowed(client, monkeypatch):
    """Only the name and its existence are protected. Colour is pure display
    and the user should be able to make their own board legible."""
    monkeypatch.setattr(main.repository, "get_category", lambda u, i: _SYSTEM)
    monkeypatch.setattr(main.repository, "get_categories", lambda u: [_SYSTEM])
    monkeypatch.setattr(main.repository, "update_category",
                        lambda u, i, up: _SYSTEM.model_copy(update=up))

    r = client.patch("/categories/cat-h", json={"color": "#ff0000"})

    assert r.status_code == 200


def test_creating_a_category_in_someone_elses_workspace_is_404(client, monkeypatch):
    """get_workspace is scoped by user_id, so another user's workspace reads as
    absent. 404 rather than 403 — confirming a row exists is itself a leak."""
    monkeypatch.setattr(main.repository, "get_workspace", lambda u, i: None)

    r = client.post("/categories", json={"workspace_id": "ws-999", "name": "κλεμμένη"})

    assert r.status_code == 404


def test_a_duplicate_name_in_the_same_workspace_is_409(client, monkeypatch):
    monkeypatch.setattr(main.repository, "get_workspace", lambda u, i: Workspace(
        record_id="ws-1", name="Business"))
    monkeypatch.setattr(main.repository, "get_categories", lambda u: [_cat()])

    r = client.post("/categories", json={"workspace_id": "ws-1", "name": "γραφείο"})

    assert r.status_code == 409


def test_the_same_name_in_a_DIFFERENT_workspace_is_allowed(client, monkeypatch):
    """Uniqueness is per workspace, not per account: 'έξοδα' under Business and
    'έξοδα' under Personal are two different things, and the user means both."""
    monkeypatch.setattr(main.repository, "get_workspace", lambda u, i: Workspace(
        record_id="ws-2", name="Personal"))
    monkeypatch.setattr(main.repository, "get_categories", lambda u: [_cat()])
    monkeypatch.setattr(main.repository, "create_category",
                        lambda u, c: _cat(record_id="cat-2", workspace_id="ws-2"))

    r = client.post("/categories", json={"workspace_id": "ws-2", "name": "γραφείο"})

    assert r.status_code == 201
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./venv/Scripts/python.exe -m pytest tests/test_category_invariants.py -q`
Expected: FAIL — 404 on `/categories` (routes do not exist)

- [ ] **Step 3: Add the request/response models to `main.py`**

```python
class CategoryWriteResponse(BaseModel):
    category: Category


class CategoryDeleteResponse(BaseModel):
    deleted: bool
    tasks_unfiled: int


class CategoryCreateRequest(BaseModel):
    workspace_id: str
    name: str = Field(max_length=40)
    color: Optional[str] = None
    position: int = 0


class CategoryUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, max_length=40)
    color: Optional[str] = None
    position: Optional[int] = None
```

`CategoryCreateRequest` deliberately has no `system_key` field: the system category is
created by the migration and by nothing else, so the API has no way to mint one.

- [ ] **Step 4: Add the three endpoints to `main.py`**

```python
# ---------------------------------------------------------------- categories


@app.post("/categories", response_model=CategoryWriteResponse, status_code=status.HTTP_201_CREATED)
def create_category(payload: CategoryCreateRequest, user_id: str = Depends(get_current_user_id)):
    # get_workspace is scoped by user_id, so another user's workspace reads as
    # absent — 404, not 403. Confirming that a row exists is itself a leak.
    if repository.get_workspace(user_id, payload.workspace_id) is None:
        raise HTTPException(status_code=404, detail="Workspace not found")

    # Per WORKSPACE, not per account: 'έξοδα' under Business and 'έξοδα' under
    # Personal are two different things and the user means both.
    siblings = [c for c in repository.get_categories(user_id)
                if c.workspace_id == payload.workspace_id]
    if any(c.name == payload.name for c in siblings):
        raise HTTPException(
            status_code=409, detail="A category with that name already exists in this workspace"
        )

    category = repository.create_category(user_id, Category(**payload.model_dump()))
    return CategoryWriteResponse(category=category)


@app.patch("/categories/{category_id}", response_model=CategoryWriteResponse)
def update_category(
    category_id: str,
    payload: CategoryUpdateRequest,
    user_id: str = Depends(get_current_user_id),
):
    existing = repository.get_category(user_id, category_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Category not found")

    updates = payload.model_dump(exclude_unset=True)

    # Colour stays editable on the system category — it is pure display, and
    # the user should be able to make their own board legible. The NAME does
    # not: allowing the rename invites allowing the delete, and deleting this
    # row stops every guest escalation on the account.
    if existing.system_key and "name" in updates:
        raise HTTPException(
            status_code=422, detail="This category belongs to an integration and cannot be renamed"
        )

    if "name" in updates and any(
        c.name == updates["name"]
        and c.workspace_id == existing.workspace_id
        and c.record_id != category_id
        for c in repository.get_categories(user_id)
    ):
        raise HTTPException(
            status_code=409, detail="A category with that name already exists in this workspace"
        )

    updated = repository.update_category(user_id, category_id, updates)
    if updated is None:
        raise HTTPException(status_code=404, detail="Category not found")
    return CategoryWriteResponse(category=updated)


@app.delete("/categories/{category_id}", response_model=CategoryDeleteResponse)
def delete_category(category_id: str, user_id: str = Depends(get_current_user_id)):
    existing = repository.get_category(user_id, category_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Category not found")
    if existing.system_key:
        raise HTTPException(
            status_code=422, detail="This category belongs to an integration and cannot be deleted"
        )

    affected = repository.count_tasks_in_category(user_id, category_id)
    repository.delete_category(user_id, category_id)
    return CategoryDeleteResponse(deleted=True, tasks_unfiled=affected)
```

- [ ] **Step 5: Add `count_tasks_in_category` to `repository.py`**

```python
def count_tasks_in_category(user_id: str, category_id: str) -> int:
    """Same purpose as count_tasks_in_workspace: a number in the confirmation
    instead of a warning nobody reads."""
    response = (
        supabase.table("tasks")
        .select("id", count="exact")
        .eq("user_id", user_id)
        .eq("category_id", category_id)
        .execute()
    )
    return response.count or 0
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `./venv/Scripts/python.exe -m pytest tests/test_category_invariants.py -q`
Expected: 6 passed

- [ ] **Step 7: Commit**

```bash
git add main.py repository.py tests/test_category_invariants.py
git commit -m "Categories get a front door, and three doors that stay shut"
```

---

## Task 10: `GET /tasks` filters by workspace, and the switcher remembers

**Files:**
- Modify: `main.py` (the `GET /tasks` route), `repository.py` (app_settings read/write)
- Test: `tests/test_workspaces_api.py`

**Interfaces:**
- Consumes: `TaskRecord.workspace_id` from Task 5; `AppSettings.active_workspace_id`
  from Task 2.
- Produces: `GET /tasks?workspace_id=<id>` filtering; `active_workspace_id` round-tripping
  through the existing app-settings endpoints. Slice 2's switcher consumes both.

- [ ] **Step 1: Read the existing route and settings path**

Run: `grep -n '@app.get("/tasks"' -A 20 main.py`
Run: `grep -n "def get_app_settings\|def update_app_settings" -A 25 repository.py`

`active_workspace_id` is added to the same field list every other settings column already
travels through — it is not a new mechanism.

- [ ] **Step 2: Write the failing test**

Append to `tests/test_workspaces_api.py`:

```python
from models import TaskRecord


def _task(**overrides):
    base = dict(record_id="t1", task_name="Χ", description="", category="Business",
                priority="P2", ai_suggested_category="Business",
                ai_suggested_priority="P2", approval_status=True)
    base.update(overrides)
    return TaskRecord(**base)


def test_tasks_can_be_filtered_to_one_workspace(client, monkeypatch):
    monkeypatch.setattr(main.repository, "get_tasks_for_user", lambda u: [
        _task(record_id="in", workspace_id="ws-1"),
        _task(record_id="out", workspace_id="ws-2"),
        _task(record_id="unfiled", workspace_id=None),
    ])

    r = client.get("/tasks?workspace_id=ws-1")

    assert [t["record_id"] for t in r.json()["tasks"]] == ["in"]


def test_no_filter_returns_everything_including_unfiled(client, monkeypatch):
    """The default is 'Όλα'. An unfiled task is still the user's work and must
    never be hidden by the absence of a choice."""
    monkeypatch.setattr(main.repository, "get_tasks_for_user", lambda u: [
        _task(record_id="in", workspace_id="ws-1"),
        _task(record_id="unfiled", workspace_id=None),
    ])

    r = client.get("/tasks")

    assert len(r.json()["tasks"]) == 2


def test_the_active_workspace_survives_a_round_trip(client, monkeypatch):
    """The switcher's position is remembered server-side, so it is the same on
    the phone and the laptop."""
    from models import AppSettings
    saved = {}
    monkeypatch.setattr(main.repository, "get_app_settings",
                        lambda u: AppSettings(active_workspace_id="ws-1"))
    monkeypatch.setattr(main.repository, "update_app_settings",
                        lambda u, up: saved.update(up) or AppSettings(**saved))

    r = client.get("/settings")

    assert r.json()["active_workspace_id"] == "ws-1"
```

The exact route names and response shapes for `/tasks` and `/settings` are whatever
Step 1's greps report — match them rather than the placeholders above.

- [ ] **Step 3: Run test to verify it fails**

Run: `./venv/Scripts/python.exe -m pytest tests/test_workspaces_api.py -q`
Expected: FAIL — the filter is ignored, so `test_tasks_can_be_filtered_to_one_workspace`
returns three tasks.

- [ ] **Step 4: Add the query parameter to `GET /tasks`**

```python
def list_tasks(
    workspace_id: Optional[str] = None,
    user_id: str = Depends(get_current_user_id),
):
    ...
    # Filtered in Python beside the existing filters rather than in the query:
    # this route already fetches the user's tasks once and filters them several
    # ways, and a second round trip buys nothing.
    #
    # Omitting workspace_id means "Όλα" and returns unfiled tasks too — an
    # unfiled task is still the user's work and must never be hidden by the
    # absence of a choice.
    if workspace_id is not None:
        tasks = [t for t in tasks if t.workspace_id == workspace_id]
```

- [ ] **Step 5: Carry `active_workspace_id` through app settings**

Add `"active_workspace_id"` to the field list in both `get_app_settings` and
`update_app_settings` in `repository.py`, alongside `calendar_show_events`.

- [ ] **Step 6: Run the whole suite**

Run: `./venv/Scripts/python.exe -m pytest tests/ -q`
Expected: 241 passed

- [ ] **Step 7: Commit**

```bash
git add main.py repository.py tests/test_workspaces_api.py
git commit -m "Look at one workspace, and be remembered doing it"
```

---

## Task 11: A category may not escape its workspace

**Files:**
- Modify: `services.py` (the task create and update paths)
- Test: `tests/test_category_invariants.py`

**Interfaces:**
- Consumes: Task 4's `get_category`; Task 5's task fields.
- Produces: `services.TaskService` rejects a `category_id` whose workspace does not match
  the task's `workspace_id`. Slice 3's AI name→id resolution relies on this being enforced
  centrally rather than at each caller.

This is the spec's parked invariant, made real. Enforced in the service layer because a
database CHECK cannot see another table.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_category_invariants.py`:

```python
def test_a_task_cannot_take_a_category_from_another_workspace(client, monkeypatch):
    """A task in Personal must not be filed under 'μετοχές', which lives in
    Business. Enforced here because a CHECK constraint cannot see another
    table, and left unenforced it produces a task the UI cannot render."""
    monkeypatch.setattr(main.repository, "get_workspace", lambda u, i: Workspace(
        record_id="ws-personal", name="Personal"))
    monkeypatch.setattr(main.repository, "get_category", lambda u, i: _cat(
        record_id="cat-stocks", workspace_id="ws-business", name="μετοχές"))

    r = client.patch("/tasks/t1", json={
        "workspace_id": "ws-personal", "category_id": "cat-stocks"})

    assert r.status_code == 422
    assert "workspace" in r.json()["detail"].lower()


def test_a_matching_pair_is_accepted(client, monkeypatch):
    monkeypatch.setattr(main.repository, "get_workspace", lambda u, i: Workspace(
        record_id="ws-1", name="Business"))
    monkeypatch.setattr(main.repository, "get_category", lambda u, i: _cat(
        record_id="cat-1", workspace_id="ws-1"))
    monkeypatch.setattr(main.service, "update_task", lambda u, i, up: None)

    r = client.patch("/tasks/t1", json={"workspace_id": "ws-1", "category_id": "cat-1"})

    assert r.status_code != 422
```

Read the real `PATCH /tasks/{id}` route first (`grep -n '@app.patch("/tasks' -A 25 main.py`)
and match its response shape.

- [ ] **Step 2: Run test to verify it fails**

Run: `./venv/Scripts/python.exe -m pytest tests/test_category_invariants.py -q`
Expected: FAIL — the mismatched pair is accepted, returning 200 instead of 422.

- [ ] **Step 3: Add the check to `services.py`**

```python
    def validate_workspace_placement(self, user_id: str, workspace_id, category_id) -> None:
        """
        A task's category must live inside the task's own workspace.

        Enforced here rather than by a database CHECK, which cannot see another
        table, and centrally rather than at each caller because Slice 3 adds two
        more writers (the extractor and the chat agent) that resolve a category
        by NAME and would each have to repeat it.

        Raises ValueError; the routes turn that into a 422.
        """
        if category_id is None:
            return

        category = self.repository.get_category(user_id, category_id)
        if category is None:
            raise ValueError("Category not found")

        if workspace_id is not None and category.workspace_id != workspace_id:
            raise ValueError(
                "That category belongs to a different workspace"
            )
```

Call it from the task create and update paths, wrapping the raise as a 422 the same way
`POST /recurrences` already does with `RecurrenceRule`'s validators (`main.py:706-707`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `./venv/Scripts/python.exe -m pytest tests/test_category_invariants.py -q`
Expected: 8 passed

- [ ] **Step 5: Run the whole suite**

Run: `./venv/Scripts/python.exe -m pytest tests/ -q`
Expected: 243 passed, 0 failed

- [ ] **Step 6: Commit**

```bash
git add services.py main.py tests/test_category_invariants.py
git commit -m "A category cannot escape its workspace"
```

---

## Slice 1 completion checklist

Evidence, not claims. Paste the actual output when reporting.

- [ ] `./venv/Scripts/python.exe -m pytest tests/ -q` — **243 passed**, up from 209, none failing

  The running totals in each task (212, 222, 241, 243) assume no existing test had to be
  rewritten. Task 6 changes what Hostaway escalation matches on, so some existing Hostaway
  tests will need `category_id` set and `get_system_category` stubbed. Rewriting them is
  expected and keeps the count the same; **deleting** one to make the suite green is not.
- [ ] `cd frontend && npm run check` — still green, ESLint still at 12 (this slice does not
      touch the frontend; if the number moved, something unintended was edited)
- [ ] The owner has run migration Part A in the Supabase SQL Editor and **read the four
      count queries**. Query 3's `hostaway_MISSING_category` must be **0**.
- [ ] `curl -s "$API/workspaces" -H "Authorization: Bearer $TOKEN"` returns his two
      workspaces and the locked Hostaway category.
- [ ] **Part B is NOT run.** `tasks.category` still exists and still holds its old values.

## What Slice 1 deliberately leaves undone

- No UI. Not one pixel changes; the app keeps reading `tasks.category`.
- The AI extractor and the chat agent still know only the four fixed words. They keep
  writing `tasks.category`, which is still live — so nothing breaks, and nothing new works
  either. Slice 3.
- **`main.py:967`'s `valid_categories = {"Business", "Personal", "Unknown", "Hostaway"}`
  and every `Literal[...]` category type in `models.py`, `agent_tools.py` and
  `task_agent.py` stay exactly as they are.** The spec has them becoming lookups against
  the user's own categories, and that is Slice 3's work: while `tasks.category` is still
  the live column, loosening its validation would remove a guard and buy nothing. Listed
  here so the gap is deliberate rather than forgotten.
- `recurrence_rules` has the two columns but nothing writes them yet. Slice 4.
- The old columns are still there. Slice 5, and only after the counts have been read.
