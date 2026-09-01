# Workspaces & Categories — Slice 3 (the AI learns your names) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A task you dictate while standing in a workspace lands in that workspace, filed
under one of *your* categories. The old four words leave the screen entirely.

**Architecture:** Two AIs, treated oppositely, because they do opposite jobs. The
**extractor** classifies ONE thing, so it is scoped to ONE workspace and offered only that
workspace's category names — a small, sharp choice instead of a guess across everything.
The **agent** answers "what do I have", so it still sees every task, but its category
vocabulary becomes the user's real names instead of four hardcoded words. Both return a
NAME; Python resolves the name to an id, and an unrecognised name files nothing rather
than inventing a category.

**Tech Stack:** FastAPI, Pydantic v2, Gemini via `google-genai`, Supabase, React 18, pytest,
plain-node frontend test scripts.

**Spec:** `docs/superpowers/specs/2026-08-31-workspaces-and-categories-design.md`
**Slice 1:** `docs/superpowers/plans/2026-09-01-workspaces-slice-1-backend.md` (done)
**Slice 2:** `docs/superpowers/plans/2026-09-01-workspaces-slice-2-frontend.md` (done)

## Global Constraints

- **PROMPT CACHING IS A BUDGET LINE, NOT A DETAIL.** `agent_tools.build_system_instruction`
  is a constant on purpose: its docstring records that interpolating the clock made the
  ~2,900-token prefix change every minute, so caching never engaged (4,041 cached of
  1,010,944 prompt tokens over 136 runs — 0.4%) while that block was **74% of every prompt
  token ever billed**. The user's category list is different in kind: it changes weekly,
  not per-minute, so it stays stable across that user's own consecutive requests. It must
  still be **APPENDED AT THE END**, so the long static block before it remains a shared
  prefix. Never interpolate anything per-request into the middle of it.
- **Tool SCHEMAS stay static.** The allowed names go in the system instruction's tail, not
  into each tool's description, so the tool block itself remains byte-identical.
- **The model answers with a NAME, never an id.** Models truncate and invent UUIDs. Python
  resolves name → id, case-insensitively, and an unknown name means **no category** — never
  a newly invented one.
- **`tasks.category` (the old word) is still written exactly as today.** It is dropped in
  Slice 4/5 only. This slice removes it from the SCREEN, not from the database.
- **The agent keeps seeing every task.** Scoping it would break "what do I have today",
  which is its whole job.
- Baselines to hold: backend `pytest tests/ -q` → **267 passed** and rising;
  frontend `npm run check` all PASS; `npm run lint` → **12 problems**, never 13.
- Tests never reach Supabase, Google, Hostaway or Gemini. Any new repository call inside an
  existing code path must be stubbed in every test that exercises that path — this is how
  `test_webhook_fanout.py` silently started hitting the live database in Slice 1.

---

## File Structure

| File | Responsibility |
|---|---|
| `docs/migrations/2026-09-02-default-workspace.sql` | **New.** One nullable column on `app_settings`. |
| `models.py` | **Modify.** `AppSettings.default_workspace_id`. |
| `repository.py` | **Modify.** Read/write that column; `get_categories_for_workspace`. |
| `main.py` | **Modify.** `/extract`, `/extract-voice`, `/extract-image` take `workspace_id`; `/settings` carries the default. |
| `services.py` | **Modify.** Resolve the effective workspace, and the category name → id. |
| `ai_engine.py` | **Modify.** The extractor's prompt carries this workspace's category names. |
| `agent_tools.py` | **Modify.** A dynamic tail on the system instruction; category/workspace params become validated strings. |
| `agent_engine.py` | **Modify.** Pass the user's vocabulary through to the instruction builder. |
| `frontend/src/api.js` | **Modify.** The three extract calls send `workspace_id`. |
| `frontend/src/components/AddTaskModal.jsx`, `VoiceButton.jsx`, `PhotoButton.jsx` | **Modify.** Send the active workspace. |
| `frontend/src/components/TaskRow.jsx` | **Modify.** The old category chip goes. |
| `frontend/src/components/FilterBar.jsx` | **Modify.** Categories of the active workspace. |
| `frontend/src/components/TodayView.jsx`, `CalendarView.jsx`, `BrowseView.jsx` | **Modify.** Filter on `category_id`. |
| `frontend/src/components/WorkspaceBar.jsx` | **Modify.** The «Αταξινόμητα» chip. |
| `frontend/src/components/WorkspacesView.jsx` | **Modify.** Pick the default workspace. |
| `frontend/src/utils/workspaces.js` | **Modify.** Two new pure helpers. |
| `frontend/scripts/workspaces.test.mjs` | **Modify.** Cover them. |

---

## Task 1: The migration

**Files:**
- Create: `docs/migrations/2026-09-02-default-workspace.sql`

**Interfaces:**
- Produces: `app_settings.default_workspace_id`. Tasks 2 and 10 depend on it.

- [ ] **Step 1: Write the file**

```sql
-- The default workspace — the one the extractor uses when nothing is selected.
-- Design: docs/superpowers/specs/2026-08-31-workspaces-and-categories-design.md
-- Plan:   docs/superpowers/plans/2026-09-02-workspaces-slice-3-ai-and-filters.md
-- Run in the Supabase SQL Editor. Adds one nullable column. Drops nothing.
--
-- Distinct from active_workspace_id, which already exists and means "where the
-- user is looking right now". This one means "which vocabulary the extractor
-- should use when they are looking at everything" — a question the switcher
-- cannot answer, because "Όλα" is not a workspace and the model must never be
-- asked to guess between several.
alter table app_settings
  add column if not exists default_workspace_id uuid
    references workspaces (id) on delete set null;

-- Seed it to Business where that exists, so the extractor has a vocabulary from
-- the first request rather than filing everything unfiled until someone visits
-- Settings. ON CONFLICT is unnecessary: this only ever fills a NULL.
update app_settings s
   set default_workspace_id = w.id
  from workspaces w
 where w.user_id = s.user_id
   and w.name = 'Business'
   and s.default_workspace_id is null;

-- Read it back before trusting it.
select u.email,
       w.name as default_workspace
from app_settings s
join auth.users u on u.id = s.user_id
left join workspaces w on w.id = s.default_workspace_id
order by u.email;
```

- [ ] **Step 2: Verify it destroys nothing**

Run: `grep -n -i "drop\|delete from\|truncate" docs/migrations/2026-09-02-default-workspace.sql`
Expected: no output at all.

- [ ] **Step 3: Commit**

```bash
git add docs/migrations/2026-09-02-default-workspace.sql
git commit -m "Migration: which workspace the extractor speaks for"
```

---

## Task 2: The setting travels

**Files:**
- Modify: `models.py`, `repository.py`, `main.py`
- Test: `tests/test_workspaces_api.py`

**Interfaces:**
- Consumes: Task 1's column.
- Produces: `AppSettings.default_workspace_id` round-trips through `GET`/`PATCH /settings`.
  Task 3 reads it.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_workspaces_api.py`:

```python
def test_the_default_workspace_round_trips(client, monkeypatch):
    """Distinct from active_workspace_id: 'where I am looking' and 'which
    vocabulary the extractor uses when I am looking at everything' are
    different questions, and Όλα cannot answer the second."""
    saved = {}

    def _update(user_id, **fields):
        saved.update(fields)
        return AppSettings(**{k: v for k, v in fields.items()})

    monkeypatch.setattr(main, "update_app_settings", _update)

    r = client.patch("/settings", json={"default_workspace_id": "ws-1"})

    assert r.status_code == 200
    assert saved["default_workspace_id"] == "ws-1"
```

- [ ] **Step 2: Run it**

Run: `./venv/Scripts/python.exe -m pytest tests/test_workspaces_api.py -q`
Expected: FAIL — `KeyError: 'default_workspace_id'`.

- [ ] **Step 3: Add the field to `models.py`'s `AppSettings`**, beside `active_workspace_id`

```python
    # Which workspace the EXTRACTOR speaks for when active_workspace_id is NULL
    # ("Όλα"). Deliberately a second column: "where am I looking" and "whose
    # vocabulary should the model be given" are different questions, and the
    # model must never be asked to guess between several workspaces.
    default_workspace_id: Optional[str] = None
```

- [ ] **Step 4: Read it in `repository.get_app_settings`**, beside `active_workspace_id`

```python
        default_workspace_id=row.get("default_workspace_id"),
```

- [ ] **Step 5: Pass it in `main.py`'s `update_settings`**, beside `active_workspace_id`

```python
            default_workspace_id=payload.default_workspace_id,
```

- [ ] **Step 6: Run the suite**

Run: `./venv/Scripts/python.exe -m pytest tests/ -q`
Expected: 268 passed.

- [ ] **Step 7: Commit**

```bash
git add models.py repository.py main.py tests/test_workspaces_api.py
git commit -m "The setting that tells the extractor which vocabulary to use"
```

---

## Task 3: Resolving the workspace and the category name

**Files:**
- Modify: `repository.py`, `services.py`
- Test: `tests/test_extract_workspace.py` (new)

**Interfaces:**
- Consumes: Task 2's setting; Slice 1's `get_categories`.
- Produces: `repository.get_categories_for_workspace(user_id, workspace_id) -> list[Category]`;
  `services.TaskService.resolve_extraction_workspace(user_id, requested_id) -> Optional[str]`;
  `services.TaskService.resolve_category_name(user_id, workspace_id, name) -> Optional[str]`.
  Tasks 4 and 5 both use the last one.

- [ ] **Step 1: Write the failing test**

Create `tests/test_extract_workspace.py`:

```python
"""
Which workspace the extractor speaks for, and how a name it returns becomes an
id. The model answers with a NAME on purpose — models truncate and invent
UUIDs — so this resolution is the seam where a hallucination is caught.
"""
import pytest

import repository
import services
from models import Category, AppSettings

USER = "user-1"

CATS = [
    Category(record_id="c-stocks", workspace_id="ws-b", name="μετοχές"),
    Category(record_id="c-crypto", workspace_id="ws-b", name="crypto"),
    Category(record_id="c-garden", workspace_id="ws-p", name="κήπος"),
]


@pytest.fixture
def service(monkeypatch):
    monkeypatch.setattr(repository, "get_categories", lambda u: CATS)
    return services.TaskService()


# ------------------------------------------------- which workspace

def test_an_explicit_workspace_wins(service, monkeypatch):
    monkeypatch.setattr(repository, "get_app_settings",
                        lambda u: AppSettings(default_workspace_id="ws-default"))

    assert service.resolve_extraction_workspace(USER, "ws-b") == "ws-b"


def test_no_workspace_falls_back_to_the_default(service, monkeypatch):
    """The user is on 'Όλα'. The model still gets exactly one vocabulary — it
    is never asked to guess between several, which is the whole point."""
    monkeypatch.setattr(repository, "get_app_settings",
                        lambda u: AppSettings(default_workspace_id="ws-default"))

    assert service.resolve_extraction_workspace(USER, None) == "ws-default"


def test_no_workspace_and_no_default_means_unfiled(service, monkeypatch):
    """Rather than picking the first workspace, which would silently file a
    task somewhere the user never chose."""
    monkeypatch.setattr(repository, "get_app_settings", lambda u: AppSettings())

    assert service.resolve_extraction_workspace(USER, None) is None


# ------------------------------------------------- name to id

def test_a_known_name_resolves(service):
    assert service.resolve_category_name(USER, "ws-b", "μετοχές") == "c-stocks"


def test_resolution_ignores_case_and_padding(service):
    """The model echoes what it was given, but not always byte for byte."""
    assert service.resolve_category_name(USER, "ws-b", "  CRYPTO ") == "c-crypto"


def test_a_name_from_ANOTHER_workspace_does_not_resolve(service):
    """'κήπος' lives in Personal. Offered only Business's names, a model that
    answers κήπος has hallucinated, and the task must stay uncategorised."""
    assert service.resolve_category_name(USER, "ws-b", "κήπος") is None


def test_an_invented_name_files_nothing(service):
    """No category is auto-created from a model's output: a hallucinated
    category is worse than no category, because it looks deliberate."""
    assert service.resolve_category_name(USER, "ws-b", "συναλλαγές") is None


def test_no_name_and_no_workspace_are_both_safe(service):
    assert service.resolve_category_name(USER, "ws-b", None) is None
    assert service.resolve_category_name(USER, None, "μετοχές") is None
```

- [ ] **Step 2: Run it**

Run: `./venv/Scripts/python.exe -m pytest tests/test_extract_workspace.py -q`
Expected: FAIL — `AttributeError: 'TaskService' object has no attribute 'resolve_extraction_workspace'`.

- [ ] **Step 3: Add the repository helper**, beside `get_categories` in `repository.py`

```python
def get_categories_for_workspace(user_id: str, workspace_id: str) -> list[Category]:
    """One workspace's categories. Filtered in Python off the user's full set
    rather than queried per workspace, because every caller here already needs
    the whole set for something else in the same request."""
    if not workspace_id:
        return []
    return [c for c in get_categories(user_id) if c.workspace_id == workspace_id]
```

- [ ] **Step 4: Add both resolvers to `services.TaskService`**, beside `validate_workspace_placement`

```python
    def resolve_extraction_workspace(self, user_id: str, requested_id) -> Optional[str]:
        """
        Which workspace the extractor speaks for on this request.

        The one the user is standing in, or — when they are on "Όλα" — their
        default. Never a guess across several: a model given three workspaces
        and fifteen categories makes mistakes a model given five does not, and
        the owner's instinct on this was right.

        Returns None when there is no default either. That means the task is
        filed nowhere, which is honest; picking the first workspace instead
        would quietly put work somewhere nobody chose.
        """
        if requested_id:
            return requested_id
        return repository.get_app_settings(user_id).default_workspace_id

    def resolve_category_name(self, user_id: str, workspace_id, name) -> Optional[str]:
        """
        The id of the category with this NAME inside this workspace, or None.

        The model answers with a name, never an id — models truncate UUIDs,
        transpose them, and invent plausible-looking ones. This is the seam
        where that is caught.

        An unrecognised name resolves to None and the task is left
        uncategorised. No category is ever auto-created from model output: a
        hallucinated category is worse than no category, because it looks
        deliberate and the user will not know to distrust it.
        """
        if not workspace_id or not name:
            return None

        wanted = str(name).strip().casefold()
        for category in repository.get_categories_for_workspace(user_id, workspace_id):
            if category.name.strip().casefold() == wanted:
                return category.record_id
        return None
```

- [ ] **Step 5: Run it**

Run: `./venv/Scripts/python.exe -m pytest tests/test_extract_workspace.py -q`
Expected: 8 passed.

- [ ] **Step 6: Commit**

```bash
git add repository.py services.py tests/test_extract_workspace.py
git commit -m "One workspace for the model, and a name it cannot fake"
```

---

## Task 4: The extractor is given your names

**Files:**
- Modify: `ai_engine.py`, `models.py`, `main.py`, `services.py`
- Test: `tests/test_extract_workspace.py`

**Interfaces:**
- Consumes: Task 3's resolvers.
- Produces: `SingleTask.category_name: Optional[str]` (what the model answers);
  `/extract`, `/extract-voice`, `/extract-image` accept `workspace_id`.

**Read first:** `sed -n '25,70p' ai_engine.py` — the instruction builder and how it is called
from all three extract paths. Line 43 is the hardcoded category line being replaced.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_extract_workspace.py`:

```python
def test_the_prompt_lists_only_this_workspaces_categories(monkeypatch):
    """The whole reason the extractor is scoped. Offered fifteen names across
    three workspaces it guesses; offered five from one, it does not have to."""
    import ai_engine
    monkeypatch.setattr(ai_engine.repository, "get_categories_for_workspace",
                        lambda u, w: [c for c in CATS if c.workspace_id == w])

    instruction = ai_engine.build_extraction_instruction(USER, "ws-b")

    assert "μετοχές" in instruction
    assert "crypto" in instruction
    assert "κήπος" not in instruction  # it lives in the other workspace


def test_a_workspace_with_no_categories_says_so_rather_than_listing_nothing(monkeypatch):
    """An empty list rendered as an empty line reads, to a model, like a
    malformed instruction. Saying there are none is an instruction it can obey."""
    import ai_engine
    monkeypatch.setattr(ai_engine.repository, "get_categories_for_workspace",
                        lambda u, w: [])

    instruction = ai_engine.build_extraction_instruction(USER, "ws-empty")

    assert "category_name" in instruction
```

- [ ] **Step 2: Run it**

Run: `./venv/Scripts/python.exe -m pytest tests/test_extract_workspace.py -q`
Expected: FAIL — `AttributeError: module 'ai_engine' has no attribute 'build_extraction_instruction'`.

- [ ] **Step 3: Add `category_name` to `SingleTask` in `models.py`**

```python
    # What the model ANSWERS with for the user's own categories — a name, never
    # an id, because models truncate and invent UUIDs. services.resolve_category_name
    # turns it into tasks.category_id, and an unrecognised name becomes None.
    # Not persisted: TaskRecord carries category_id instead.
    category_name: Optional[str] = None
```

- [ ] **Step 4: Build the instruction from the user's categories in `ai_engine.py`**

Rename `_build_system_instruction()` to `build_extraction_instruction(user_id, workspace_id)`
and append, after the existing hardcoded `category` line (which stays — it still fills the
old column):

```python
def build_extraction_instruction(user_id: str, workspace_id) -> str:
    """
    The extraction instruction, with THIS workspace's category names appended.

    Scoped to one workspace on purpose. A model offered fifteen names across
    three workspaces makes mistakes a model offered five from one does not —
    and it is never asked to pick the workspace itself, because there is
    exactly one right answer available to us in code and none available to it.

    The old `category` line above is untouched: tasks.category is still the
    live column and is dropped only in a later slice.
    """
    base = _BASE_INSTRUCTION

    categories = repository.get_categories_for_workspace(user_id, workspace_id)
    if categories:
        names = ", ".join(c.name for c in categories)
        return base + (
            f"\n- category_name: the user's own category for this task, EXACTLY one of: "
            f"{names}. Copy the name exactly as written above. If none of them fits, "
            f"leave it out entirely — never invent a category name."
        )

    # Said explicitly rather than rendered as an empty list: an empty line reads
    # to a model like a malformed instruction, while "there are none" is one it
    # can obey.
    return base + (
        "\n- category_name: this user has no categories yet. Always leave it out."
    )
```

- [ ] **Step 5: Thread `workspace_id` through the three extract paths**

`main.py`: add `workspace_id: Optional[str] = None` to `ExtractRequest`, and accept it as a
form field / query parameter on the voice and image routes exactly as those routes already
take their other parameters. Each route resolves it before calling the service:

```python
    workspace_id = service.resolve_extraction_workspace(user_id, request.workspace_id)
```

`services.py`: wherever an extracted `SingleTask` becomes a saved task, set

```python
            "workspace_id": workspace_id,
            "category_id": self.resolve_category_name(user_id, workspace_id, item.category_name),
```

- [ ] **Step 6: Run the suite**

Run: `./venv/Scripts/python.exe -m pytest tests/ -q`
Expected: 278 passed. Any existing extraction test that now hits an unstubbed
`get_categories_for_workspace` must be given a stub — an unstubbed repository call reaches
the live database, which is the exact failure Slice 1 uncovered in `test_webhook_fanout.py`.

- [ ] **Step 7: Commit**

```bash
git add ai_engine.py models.py main.py services.py tests/test_extract_workspace.py
git commit -m "The extractor is handed your words, and only yours"
```

---

## Task 5: The agent learns your names without losing the cache

**Files:**
- Modify: `agent_tools.py`, `agent_engine.py`
- Test: `tests/test_agent_dynamic_categories.py` (new)

**Interfaces:**
- Consumes: Slice 1's `get_workspaces` / `get_categories`.
- Produces: `agent_tools.build_system_instruction(vocabulary: str = "")`;
  `agent_tools.build_vocabulary_block(workspaces, categories) -> str`.

**This is the task with a budget attached.** Read `build_system_instruction`'s docstring in
full before touching it (`sed -n '318,336p' agent_tools.py`) — it records that this block is
74% of every prompt token ever billed, and what happened last time it stopped being constant.

- [ ] **Step 1: Write the failing test**

Create `tests/test_agent_dynamic_categories.py`:

```python
"""
The agent's vocabulary becomes the user's own names — without undoing the
prompt-caching fix that build_system_instruction's docstring exists to record.

That fix is why the dynamic part is APPENDED. The long static block above it
stays byte-identical, so it remains a shared cacheable prefix; only the tail
differs, and it differs weekly rather than per-minute.
"""
import agent_tools
from models import Category, Workspace

WS = [Workspace(record_id="ws-b", name="Business"),
      Workspace(record_id="ws-p", name="Personal")]
CATS = [Category(record_id="c1", workspace_id="ws-b", name="μετοχές"),
        Category(record_id="c2", workspace_id="ws-p", name="κήπος")]


def test_the_vocabulary_names_every_workspace_and_category():
    """The agent still sees EVERYTHING — scoping it would break 'what do I have
    today', which is its whole job. Only the extractor is scoped."""
    block = agent_tools.build_vocabulary_block(WS, CATS)

    assert "Business" in block and "Personal" in block
    assert "μετοχές" in block and "κήπος" in block


def test_a_user_with_nothing_gets_an_empty_block_not_a_broken_sentence():
    assert agent_tools.build_vocabulary_block([], []) == ""


def test_the_static_block_is_still_a_PREFIX_of_the_dynamic_one():
    """The load-bearing assertion of this file. If the vocabulary were
    interpolated into the middle, this fails — and prompt caching would go back
    to 0.4%, on a block that is 74% of every prompt token billed."""
    static = agent_tools.build_system_instruction()
    dynamic = agent_tools.build_system_instruction(
        agent_tools.build_vocabulary_block(WS, CATS))

    assert dynamic.startswith(static)


def test_no_vocabulary_leaves_the_instruction_byte_identical():
    """A user with no workspaces must produce exactly the old constant, so
    nothing about their billing changes."""
    assert agent_tools.build_system_instruction("") == agent_tools.build_system_instruction()
```

- [ ] **Step 2: Run it**

Run: `./venv/Scripts/python.exe -m pytest tests/test_agent_dynamic_categories.py -q`
Expected: FAIL — `AttributeError: module 'agent_tools' has no attribute 'build_vocabulary_block'`.

- [ ] **Step 3: Add the vocabulary builder to `agent_tools.py`**

```python
def build_vocabulary_block(workspaces, categories) -> str:
    """
    The user's own workspace and category names, as a block to APPEND to the
    system instruction.

    Appended, never interpolated. build_system_instruction's docstring records
    what happened the last time that block stopped being constant: the
    cacheable prefix changed every minute and caching fell to 0.4%, on ~2,900
    tokens that are 74% of every prompt token ever billed. A category list is
    not a clock — it changes weekly — so it stays stable across one user's
    consecutive requests. Keeping it at the END means the long static part
    above stays a shared prefix regardless.

    Returns "" for a user with nothing, so their instruction is byte-identical
    to the old constant.
    """
    if not workspaces:
        return ""

    lines = []
    for workspace in workspaces:
        own = [c.name for c in categories if c.workspace_id == workspace.record_id]
        lines.append(f"- {workspace.name}: " + (", ".join(own) if own else "(no categories)"))

    return (
        "\n\nTHE USER'S OWN WORKSPACES AND CATEGORIES:\n"
        + "\n".join(lines)
        + "\nWhen the user names one of these, pass it to search_tasks as `workspace` or "
          "`category`, copied exactly. Tasks may have neither; those are 'unfiled'."
    )
```

- [ ] **Step 4: Let the instruction take an optional tail**

```python
def build_system_instruction(vocabulary: str = "") -> str:
```

and change the final `return """..."""` to `return """...""" + vocabulary`. **Do not touch
one character of the string itself** — the test asserting `dynamic.startswith(static)` is
what proves the prefix survived.

- [ ] **Step 5: Pass the vocabulary in `agent_engine.py:182`**

```python
        system_instruction = agent_tools.build_system_instruction(
            agent_tools.build_vocabulary_block(
                repository.get_workspaces(user_id),
                repository.get_categories(user_id),
            )
        )
```

- [ ] **Step 6: Run the suite**

Run: `./venv/Scripts/python.exe -m pytest tests/ -q`
Expected: 282 passed. Agent tests that call the engine need the two repository calls stubbed.

- [ ] **Step 7: Commit**

```bash
git add agent_tools.py agent_engine.py tests/test_agent_dynamic_categories.py
git commit -m "The agent learns your words, at the end of the sentence"
```

---

## Task 6: Two more pure helpers, and their tests

**Files:**
- Modify: `frontend/src/utils/workspaces.js`, `frontend/scripts/workspaces.test.mjs`

**Interfaces:**
- Produces: `filterTasksByCategory(tasks, categoryId)` where `'unfiled'` is a real value;
  `UNFILED` — the sentinel. Tasks 8 and 9 use both.

- [ ] **Step 1: Write the failing test**

Append to `frontend/scripts/workspaces.test.mjs`, before the final `console.log`:

```js
// ------------------------------------------------------ category filtering
check('no category filter returns everything',
  filterTasksByCategory([task({ record_id: 'a', category_id: 'c1' }), task({ record_id: 'b' })], null)
    .map((t) => t.record_id),
  ['a', 'b']);

check('a category keeps only its own',
  filterTasksByCategory(
    [task({ record_id: 'in', category_id: 'c1' }),
     task({ record_id: 'out', category_id: 'c2' })], 'c1').map((t) => t.record_id),
  ['in']);

check('UNFILED is a real choice, not the absence of one',
  filterTasksByCategory(
    [task({ record_id: 'filed', category_id: 'c1' }),
     task({ record_id: 'bare' })], UNFILED).map((t) => t.record_id),
  ['bare']);

check('UNFILED does not collide with a real id', UNFILED.startsWith('__'), true);
```

and add `filterTasksByCategory, UNFILED` to the import at the top of that file.

- [ ] **Step 2: Run it**

Run: `cd frontend && node scripts/workspaces.test.mjs`
Expected: FAIL — `filterTasksByCategory is not a function`.

- [ ] **Step 3: Add both to `frontend/src/utils/workspaces.js`**

```js
/**
 * The value the category filter uses for "has no category".
 *
 * A sentinel rather than null, because null already means "no filter at all" in
 * this control — and "show me everything" and "show me the ones nobody filed"
 * are opposite requests. Prefixed so it can never collide with a uuid.
 */
export const UNFILED = '__unfiled__';

/** The task list narrowed to one category, or to the ones with none. */
export function filterTasksByCategory(tasks, categoryId) {
  const list = tasks || [];
  if (!categoryId) return list;
  if (categoryId === UNFILED) return list.filter((task) => !task.category_id);
  return list.filter((task) => task.category_id === categoryId);
}
```

- [ ] **Step 4: Run it**

Run: `cd frontend && node scripts/workspaces.test.mjs`
Expected: all PASS, 25 checks.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/workspaces.js frontend/scripts/workspaces.test.mjs
git commit -m "Show me everything and show me the unfiled are opposite requests"
```

---

## Task 7: The old chip leaves the row

**Files:**
- Modify: `frontend/src/components/TaskRow.jsx`

This is the chip that made an AI-created task look as though it had landed in the Personal
workspace when it had landed nowhere. It is the single most misleading thing on the screen.

- [ ] **Step 1: Delete the old category chip**

Remove the whole `{task.category && task.category !== 'Unknown' && (...)}` block (around
`TaskRow.jsx:285`) and, if they become unused, the `categoryColor` / `categoryLabel`
imports with it.

Leave a comment where it was:

```jsx
            {/* The old four-word category chip stood here. It was removed on
                2026-09-02 because it printed "Personal" — the AI's word — right
                where the workspace chip prints "Personal" the workspace, and an
                AI-created task with no workspace at all looked filed. The word
                is still in the database and still written; it is simply no
                longer shown. */}
```

- [ ] **Step 2: Verify**

Run: `cd frontend && npm run check && npm run lint 2>&1 | tail -3`
Expected: all PASS; **12 problems**. An unused-import error here means step 1 left one behind.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/TaskRow.jsx
git commit -m "The chip that lied about where a task went"
```

---

## Task 8: The filter follows the workspace

**Files:**
- Modify: `frontend/src/components/FilterBar.jsx`, `TodayView.jsx`, `CalendarView.jsx`,
  `BrowseView.jsx`

**Interfaces:**
- Consumes: Task 6's `filterTasksByCategory` / `UNFILED`; Slice 2's `useWorkspaces`.

- [ ] **Step 1: Rewrite `FilterBar.jsx`'s category options**

```jsx
  const { activeId, categoriesFor } = useWorkspaces();

  // Hidden entirely on "Όλα": there is no coherent single list of categories
  // across two workspaces — "μετοχές" and "κήπος" do not belong in one menu.
  const categories = categoriesFor(activeId);

  const categoryOptions = activeId
    ? [
        { value: 'All', label: t('workspace.category_label') },
        ...categories.map((c) => ({ value: c.record_id, label: c.name })),
        { value: UNFILED, label: t('workspace.unfiled') },
      ]
    : null;
```

and render the category `CustomSelect` only when `categoryOptions` is non-null, leaving the
priority select to take the full width otherwise.

- [ ] **Step 2: Repoint the two predicates**

`TodayView.jsx:54` and `CalendarView.jsx:381` currently read
`(selectedCategory === 'All' || task.category === selectedCategory)`. Both become a call to
`filterTasksByCategory` over the list, with `selectedCategory === 'All'` passed as `null`.

- [ ] **Step 3: Rewrite `BrowseView.jsx`'s pills and counts**

The hardcoded `categoryOptions` array and the `Business/Personal/Unknown/Hostaway` counts
become the active workspace's categories plus `UNFILED`, counted the same way. Where there
is no active workspace, render no category pills at all — the workspace chips above are
already doing that job.

- [ ] **Step 4: Verify**

Run: `cd frontend && npm run check && npm run lint 2>&1 | tail -3 && npx vite build`
Expected: all PASS; **12 problems**; `✓ built`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/FilterBar.jsx frontend/src/components/TodayView.jsx \
        frontend/src/components/CalendarView.jsx frontend/src/components/BrowseView.jsx
git commit -m "The category filter belongs under a workspace, not beside it"
```

---

## Task 9: The «Αταξινόμητα» chip

**Files:**
- Modify: `frontend/src/components/WorkspaceBar.jsx`, `WorkspaceProvider.jsx`,
  `frontend/src/utils/workspaces.js`, `frontend/scripts/workspaces.test.mjs`

It replaces the old "Unknown" filter, which the workspace chips otherwise removed with
nothing in its place. It is where a task the AI could not place goes to be found.

- [ ] **Step 1: Extend `filterTasksByWorkspace` and its tests**

`UNFILED` becomes a legal `activeId`, meaning "tasks with no workspace":

```js
export function filterTasksByWorkspace(tasks, activeId) {
  const list = tasks || [];
  if (!activeId) return list;
  if (activeId === UNFILED) return list.filter((task) => !task.workspace_id);
  return list.filter((task) => task.workspace_id === activeId);
}
```

New checks, appended to the filtering section of `workspaces.test.mjs`:

```js
check('the unfiled chip shows exactly the tasks with no workspace',
  filterTasksByWorkspace(
    [task({ record_id: 'filed', workspace_id: 'ws-b' }),
     task({ record_id: 'bare' })], UNFILED).map((t) => t.record_id),
  ['bare']);
```

- [ ] **Step 2: Add the chip and keep the fallback honest**

In `WorkspaceBar.jsx`, append after the workspaces:
`{ record_id: UNFILED, name: t('workspace.unfiled'), color: null }`.

In `WorkspaceProvider.jsx`, `resolvedActiveId` currently falls back to `null` unless the id
matches a real workspace — `UNFILED` must be accepted too, or the chip will deselect itself
on every render:

```js
    () => (activeId === UNFILED || workspaces.some((w) => w.record_id === activeId)
      ? activeId : null),
```

- [ ] **Step 3: Verify**

Run: `cd frontend && npm run check && npm run lint 2>&1 | tail -3`
Expected: all PASS; **12 problems**.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/WorkspaceBar.jsx frontend/src/components/WorkspaceProvider.jsx \
        frontend/src/utils/workspaces.js frontend/scripts/workspaces.test.mjs
git commit -m "Somewhere to find what nobody filed"
```

---

## Task 10: Sending the workspace, and choosing the default

**Files:**
- Modify: `frontend/src/api.js`, `AddTaskModal.jsx`, `VoiceButton.jsx`, `PhotoButton.jsx`,
  `WorkspacesView.jsx`, `frontend/src/locales/{el,en}.json`

**Interfaces:**
- Consumes: Task 4's `workspace_id` parameters; Task 2's setting.

- [ ] **Step 1: Send the active workspace from the three add paths**

`api.js`: `extractTasks(text, workspaceId)`, and the same second argument on the voice and
image calls, sent the way each of those routes already takes its parameters.

Each caller passes `useWorkspaces().activeId`, **except when it is `UNFILED`** — that is a
view, not a destination, and a task added while looking at the unfiled pile should go to the
default rather than deliberately back onto the pile:

```jsx
  const { activeId } = useWorkspaces();
  const destination = activeId === UNFILED ? null : activeId;
```

- [ ] **Step 2: Add the default-workspace picker to `WorkspacesView.jsx`**

One `CustomSelect` at the top of that screen, labelled `t('workspace.default_label')`, over
`workspaces`, saving through `updateSettings({ default_workspace_id: value || null })`, with
`t('workspace.default_hint')` under it.

New keys, in **both** locale files:

```json
    "default_label": "Προεπιλεγμένος χώρος",
    "default_hint": "Όταν γράφεις task ενώ βλέπεις «Όλα», το AI χρησιμοποιεί τις κατηγορίες αυτού του χώρου."
```

```json
    "default_label": "Default workspace",
    "default_hint": "When you add a task while viewing “All”, the AI uses this workspace's categories."
```

- [ ] **Step 3: Verify**

Run: `cd frontend && npm run check && npm run lint 2>&1 | tail -3 && npx vite build`
Expected: all PASS (`ui-check` proves both locale files gained both keys); **12 problems**;
`✓ built`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api.js frontend/src/components/AddTaskModal.jsx \
        frontend/src/components/VoiceButton.jsx frontend/src/components/PhotoButton.jsx \
        frontend/src/components/WorkspacesView.jsx frontend/src/locales/el.json \
        frontend/src/locales/en.json
git commit -m "A task lands where you were standing"
```

---

## Slice 3 completion checklist

Automated:

- [ ] `./venv/Scripts/python.exe -m pytest tests/ -q` — **282+ passed**, none failing
- [ ] `cd frontend && npm run check` — every suite PASS, `ui-check: OK`
- [ ] `cd frontend && npm run lint 2>&1 | tail -3` — **12 problems**, not 13
- [ ] `npx vite build` — `✓ built`
- [ ] The owner has run `2026-09-02-default-workspace.sql` and read its one query back

**The browser walkthrough:**

- [ ] Standing in **Business**, dictate "buy bitcoin" → the task appears **in Business**,
      and if a `crypto` category exists there, **under crypto**.
- [ ] The same task shows **no "Personal"** anywhere. The old word is off the screen.
- [ ] Standing in **Όλα**, add a task → it lands in the **default workspace**, not nowhere
      and not somewhere guessed.
- [ ] With Business active, the category filter offers **Business's categories only**,
      plus Αταξινόμητα. On Όλα it is **not shown at all**.
- [ ] The **Αταξινόμητα** chip shows the tasks with no workspace, and nothing else.
- [ ] Ask the agent "τι έχω στα crypto;" → it answers about that category **by name**,
      and still answers "τι έχω σήμερα" across **every** workspace.
- [ ] A real Hostaway guest message still arrives, still lands in Business/Hostaway, and
      still escalates.

## What Slice 3 deliberately leaves undone

- `tasks.category` is still written by the extractor and still in the database. It is now
  invisible in the UI. Dropping it is Slice 5, after the agent's remaining uses are gone.
- `recurrence_rules` still has no workspace. Slice 4.
- The agent can filter and read by workspace and category, but its `create_task` proposal
  does not set them. A task the agent creates is unfiled until the user files it.
- No reordering of workspaces or categories by dragging. `position` is still creation order.
