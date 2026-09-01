# Workspaces & Categories — Slice 2 (the screen) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner can create a workspace, name categories inside it, put a task in one,
and switch what he is looking at — all from the app.

**Architecture:** One `WorkspaceProvider` fetches workspaces and categories once and serves
them through a context, modelled directly on `RecurrenceProvider` — the pattern this
codebase already used to solve "a task row four components deep needs shared data it was
never handed". A chip row under the AppBar sets the active workspace; App filters the task
list once, before `viewProps`, so every view obeys it without being edited. All decision
logic lives in a new pure module `src/utils/workspaces.js` so it can be tested by a node
script, because this project has no React test runner and components cannot be tested here.

**Tech Stack:** React 18, react-i18next, Tailwind via CSS custom properties, plain-node
test scripts (`frontend/scripts/*.test.mjs`).

**Spec:** `docs/superpowers/specs/2026-08-31-workspaces-and-categories-design.md`
**Slice 1 (done):** `docs/superpowers/plans/2026-09-01-workspaces-slice-1-backend.md`

## Global Constraints

- **The existing "Κατηγορία" filter in `FilterBar.jsx` is NOT touched.** It filters on the
  old `category` word, which is still live and populated on every task. Repointing it at
  `category_id` would filter on a column that is NULL for 163 of the owner's 301 tasks —
  the user would tap a category and see nothing. That repointing is Slice 3's job, after
  the AI starts filling `category_id`.
- **"Όλα" is the default and returns unfiled tasks too.** A task with no workspace is still
  the user's work and must never be hidden by the absence of a choice.
- **The switcher filters what you LOOK AT, never what the system DOES.** It is a client-side
  filter over the already-fetched list. Reminders, calendar sync and Hostaway are untouched.
- **The system category (`system_key` set) is read-only in the UI**: no rename, no delete,
  and it is not offered in the "add category" flow. The backend returns 422 either way
  (Slice 1, Task 9); the UI must not offer the action in the first place.
- Every user-visible string goes through `t()` and into **both** `el.json` and `en.json`.
  `scripts/ui-check.mjs` fails the build on a key present in one and missing in the other.
- Baselines to hold: `npm run lint` → **12 problems** (pre-existing, do not add a 13th);
  `npm run check` → all suites PASS. Backend `pytest tests/ -q` → **267 passed**, untouched
  by this slice.

---

## File Structure

| File | Responsibility |
|---|---|
| `frontend/src/api.js` | **Modify.** Four calls: list, create/update/delete workspace, create/update/delete category. |
| `frontend/src/utils/workspaces.js` | **New.** Every pure decision: filtering, grouping, chip text, next position. The only file the tests can reach. |
| `frontend/src/hooks/useWorkspaces.js` | **New.** The context + its hook. Split from the provider for the same react-refresh reason `useRecurrence.js` is. |
| `frontend/src/components/WorkspaceProvider.jsx` | **New.** Fetches once, owns the active selection, persists it. |
| `frontend/src/components/WorkspaceBar.jsx` | **New.** The chip row. |
| `frontend/src/components/WorkspacesView.jsx` | **New.** The management screen inside Settings. |
| `frontend/src/App.jsx` | **Modify.** Mount the provider, render the bar, filter tasks once. |
| `frontend/src/components/SettingsModal.jsx` | **Modify.** One row that opens `WorkspacesView`. |
| `frontend/src/components/TaskDetailSheet.jsx` | **Modify.** Two rows: workspace, category. |
| `frontend/src/components/TaskRow.jsx` | **Modify.** The placement chip. |
| `frontend/src/locales/{el,en}.json` | **Modify.** New `workspace.*` keys. |
| `frontend/scripts/workspaces.test.mjs` | **New.** The pure module, against the real locale files. |
| `frontend/package.json` | **Modify.** Add the new suite to `check`. |

---

## Task 1: The API calls

**Files:**
- Modify: `frontend/src/api.js`

**Interfaces:**
- Produces: `getWorkspaces()` → `{ workspaces: [...], categories: [...] }`;
  `createWorkspace(payload)`, `updateWorkspace(id, updates)`, `deleteWorkspace(id)`;
  `createCategory(payload)`, `updateCategory(id, updates)`, `deleteCategory(id)`.
  Every later task uses these exact names.

- [ ] **Step 1: Append to `frontend/src/api.js`**, following the `getRecurrences` block's shape

```js
/**
 * GET /workspaces — this user's workspaces AND every category they own, in one
 * call. Both together because the provider needs the whole set on each app
 * open: a task chip may belong to any workspace, so fetching categories per
 * workspace would be one request per workspace on every launch.
 * Returns { workspaces: [...], categories: [...] }.
 */
export async function getWorkspaces() {
  return request('/workspaces');
}

/** POST /workspaces — { name, color?, position? }. 409 if the name is taken. */
export async function createWorkspace(payload) {
  return request('/workspaces', { method: 'POST', body: JSON.stringify(payload) });
}

/** PATCH /workspaces/{id} — any of name, color, position. 409 on a taken name. */
export async function updateWorkspace(workspaceId, updates) {
  return request(`/workspaces/${workspaceId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

/**
 * DELETE /workspaces/{id} — removes the workspace and, by cascade, its
 * categories. Tasks in it are NOT deleted; they become unfiled.
 * Returns { deleted: true, tasks_unfiled: N } — show N before asking.
 */
export async function deleteWorkspace(workspaceId) {
  return request(`/workspaces/${workspaceId}`, { method: 'DELETE' });
}

/** POST /categories — { workspace_id, name, color?, position? }. */
export async function createCategory(payload) {
  return request('/categories', { method: 'POST', body: JSON.stringify(payload) });
}

/**
 * PATCH /categories/{id}. 422 if the category belongs to an integration and
 * the change includes its name — colour is always allowed.
 */
export async function updateCategory(categoryId, updates) {
  return request(`/categories/${categoryId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

/**
 * DELETE /categories/{id} — 422 for an integration's category.
 * Returns { deleted: true, tasks_unfiled: N }.
 */
export async function deleteCategory(categoryId) {
  return request(`/categories/${categoryId}`, { method: 'DELETE' });
}
```

- [ ] **Step 2: Verify the module still parses**

Run: `cd frontend && npm run lint 2>&1 | tail -3`
Expected: `✖ 12 problems` — the same pre-existing count, no new entry naming `api.js`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api.js
git commit -m "The frontend learns to ask for workspaces"
```

---

## Task 2: The pure module, and its tests

**Files:**
- Create: `frontend/src/utils/workspaces.js`
- Create: `frontend/scripts/workspaces.test.mjs`
- Modify: `frontend/package.json`
- Modify: `frontend/src/locales/el.json`, `frontend/src/locales/en.json`

**Interfaces:**
- Produces: `filterTasksByWorkspace(tasks, activeId)`,
  `categoriesForWorkspace(categories, workspaceId)`,
  `describePlacement(task, workspaces, categories, t)`, `nextPosition(items)`.
  Tasks 3-7 all consume these; **no component may re-implement any of them**, because a
  node script is the only thing in this project that can test them.

This task is first among the UI work on purpose: it is the only part that can be proved.

- [ ] **Step 1: Write the failing test**

Create `frontend/scripts/workspaces.test.mjs`:

```js
#!/usr/bin/env node
/**
 * Every decision the workspace UI makes, as pure functions, against the REAL
 * locale files rather than a stub dictionary.
 *
 * Using the real files is the point, and it is the same reason
 * recurrence-badge.test.mjs does it: the failure mode here is not a wrong
 * sentence, it is a MISSING KEY. i18next renders the key itself, so a chip
 * reads "workspace.unfiled", nothing throws, nothing logs, and the build is
 * green. A translator that refuses an unknown key turns that into a red test.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  filterTasksByWorkspace,
  categoriesForWorkspace,
  describePlacement,
  nextPosition,
} from '../src/utils/workspaces.js';

const here = dirname(fileURLToPath(import.meta.url));
const locales = Object.fromEntries(
  ['en', 'el'].map((lang) => [
    lang,
    JSON.parse(readFileSync(join(here, '..', 'src', 'locales', `${lang}.json`), 'utf8')),
  ])
);

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
};

/** i18next's t(), minus the tolerance: an unknown key is a failure, not a string. */
function translator(dict) {
  return (key, opts) => {
    const value = key.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), dict);
    if (value === undefined) throw new Error(`missing translation key: ${key}`);
    return String(value).replace(/\{\{(\w+)\}\}/g, (_, name) => String(opts?.[name] ?? ''));
  };
}

const WS = [
  { record_id: 'ws-b', name: 'Business', color: '#2563eb', position: 0 },
  { record_id: 'ws-p', name: 'Personal', color: '#16a34a', position: 1 },
];
const CATS = [
  { record_id: 'c-office', workspace_id: 'ws-b', name: 'γραφείο', position: 1, system_key: null },
  { record_id: 'c-host', workspace_id: 'ws-b', name: 'Hostaway', position: 0, system_key: 'hostaway' },
  { record_id: 'c-garden', workspace_id: 'ws-p', name: 'κήπος', position: 0, system_key: null },
];
const task = (o) => ({ record_id: 't', workspace_id: null, category_id: null, ...o });

// ---------------------------------------------------------------- filtering
check('no active workspace returns every task',
  filterTasksByWorkspace([task({ record_id: 'a', workspace_id: 'ws-b' }), task({ record_id: 'b' })], null)
    .map((t) => t.record_id),
  ['a', 'b']);

check('an unfiled task survives "All" — it is still the user\'s work',
  filterTasksByWorkspace([task({ record_id: 'unfiled' })], null).map((t) => t.record_id),
  ['unfiled']);

check('an active workspace keeps only its own',
  filterTasksByWorkspace(
    [task({ record_id: 'in', workspace_id: 'ws-b' }),
     task({ record_id: 'out', workspace_id: 'ws-p' }),
     task({ record_id: 'unfiled' })], 'ws-b').map((t) => t.record_id),
  ['in']);

check('an empty list stays an empty list', filterTasksByWorkspace([], 'ws-b'), []);
check('a missing list does not throw', filterTasksByWorkspace(undefined, 'ws-b'), []);

// --------------------------------------------------------------- grouping
check('categories are scoped to one workspace, in position order',
  categoriesForWorkspace(CATS, 'ws-b').map((c) => c.record_id),
  ['c-host', 'c-office']);

check('a workspace with none returns empty, not undefined',
  categoriesForWorkspace(CATS, 'ws-nothing'), []);

check('no workspace means no categories to offer',
  categoriesForWorkspace(CATS, null), []);

// -------------------------------------------------------------- the chip
for (const [lang, dict] of Object.entries(locales)) {
  const t = translator(dict);

  check(`${lang}: an unfiled task says so rather than showing nothing`,
    describePlacement(task({}), WS, CATS, t),
    t('workspace.unfiled'));

  check(`${lang}: a workspace with no category shows just the workspace`,
    describePlacement(task({ workspace_id: 'ws-b' }), WS, CATS, t),
    'Business');

  check(`${lang}: both shows workspace and category`,
    describePlacement(task({ workspace_id: 'ws-b', category_id: 'c-office' }), WS, CATS, t),
    'Business · γραφείο');

  check(`${lang}: a DELETED workspace does not print "undefined"`,
    describePlacement(task({ workspace_id: 'ws-gone' }), WS, CATS, t),
    t('workspace.unfiled'));

  check(`${lang}: a deleted category falls back to the workspace alone`,
    describePlacement(task({ workspace_id: 'ws-b', category_id: 'c-gone' }), WS, CATS, t),
    'Business');
}

// ------------------------------------------------------------- ordering
check('the first item takes position 0', nextPosition([]), 0);
check('a new item goes after the highest, not after the count',
  nextPosition([{ position: 0 }, { position: 7 }]), 8);
check('a missing position counts as 0 rather than NaN',
  nextPosition([{}, { position: 2 }]), 3);

console.log(failures === 0 ? '\nAll workspace checks passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && node scripts/workspaces.test.mjs`
Expected: `ERR_MODULE_NOT_FOUND` — `src/utils/workspaces.js` does not exist.

- [ ] **Step 3: Add the translation keys to `el.json`**

At the top level, beside the existing `calendar` / `recurrence` blocks:

```json
  "workspace": {
    "all": "Όλα",
    "unfiled": "Αταξινόμητα",
    "label": "Χώρος",
    "category_label": "Κατηγορία",
    "manage": "Χώροι και κατηγορίες",
    "manage_hint": "Φτιάξε χώρους (π.χ. Επαγγελματικά, Προσωπικά) και μέσα τους κατηγορίες.",
    "new_workspace": "Νέος χώρος",
    "new_category": "Νέα κατηγορία",
    "name_placeholder": "Όνομα",
    "no_categories": "Καμία κατηγορία ακόμη",
    "system_locked": "Τη διαχειρίζεται η ενσωμάτωση Hostaway — δεν μετονομάζεται και δεν σβήνεται.",
    "delete_workspace_confirm": "Να διαγραφεί ο χώρος «{{name}}»; Οι κατηγορίες του χάνονται. Τα {{count}} tasks του ΔΕΝ σβήνονται — γίνονται Αταξινόμητα.",
    "delete_category_confirm": "Να διαγραφεί η κατηγορία «{{name}}»; Τα {{count}} tasks της ΔΕΝ σβήνονται — μένουν στον χώρο τους χωρίς κατηγορία.",
    "saved": "Αποθηκεύτηκε",
    "deleted": "Διαγράφηκε",
    "name_taken": "Υπάρχει ήδη με αυτό το όνομα"
  },
```

- [ ] **Step 4: Add the same keys to `en.json`**

```json
  "workspace": {
    "all": "All",
    "unfiled": "Unfiled",
    "label": "Workspace",
    "category_label": "Category",
    "manage": "Workspaces and categories",
    "manage_hint": "Create workspaces (e.g. Business, Personal) and categories inside them.",
    "new_workspace": "New workspace",
    "new_category": "New category",
    "name_placeholder": "Name",
    "no_categories": "No categories yet",
    "system_locked": "Managed by the Hostaway integration — it cannot be renamed or deleted.",
    "delete_workspace_confirm": "Delete the workspace “{{name}}”? Its categories go with it. Its {{count}} tasks are NOT deleted — they become Unfiled.",
    "delete_category_confirm": "Delete the category “{{name}}”? Its {{count}} tasks are NOT deleted — they stay in their workspace with no category.",
    "saved": "Saved",
    "deleted": "Deleted",
    "name_taken": "That name is already taken"
  },
```

- [ ] **Step 5: Write `frontend/src/utils/workspaces.js`**

```js
/**
 * Every decision the workspace UI makes, as pure functions.
 *
 * They live here rather than inside the components for one practical reason:
 * this project has no React test runner, and `frontend/scripts/*.test.mjs` can
 * import a plain module but cannot render a component. Logic left in a
 * component is logic nothing can check.
 */

/**
 * The task list narrowed to one workspace.
 *
 * `activeId` null means "Όλα", and that deliberately INCLUDES unfiled tasks —
 * a task with no workspace is still the user's work and must never disappear
 * because they have not made a choice.
 */
export function filterTasksByWorkspace(tasks, activeId) {
  const list = tasks || [];
  if (!activeId) return list;
  return list.filter((task) => task.workspace_id === activeId);
}

/** One workspace's categories, in the order the user arranged them. */
export function categoriesForWorkspace(categories, workspaceId) {
  if (!workspaceId) return [];
  return (categories || [])
    .filter((category) => category.workspace_id === workspaceId)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

/**
 * The one-line placement shown on a task row: "Business · γραφείο".
 *
 * Both lookups fall back rather than printing undefined. A task can outlive
 * the workspace or category it pointed at — the database sets those columns to
 * NULL on delete, but a row already in the browser's memory still holds the old
 * id until the next fetch, and that window is exactly when this renders.
 */
export function describePlacement(task, workspaces, categories, t) {
  const workspace = (workspaces || []).find((w) => w.record_id === task?.workspace_id);
  if (!workspace) return t('workspace.unfiled');

  const category = (categories || []).find((c) => c.record_id === task?.category_id);
  return category ? `${workspace.name} · ${category.name}` : workspace.name;
}

/**
 * Where a newly created item goes: after the highest position, not after the
 * count. Deleting the middle of a list leaves gaps, so a count-based answer
 * would collide with an existing row and make the order arbitrary.
 */
export function nextPosition(items) {
  const list = items || [];
  if (list.length === 0) return 0;
  return Math.max(...list.map((item) => item.position ?? 0)) + 1;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd frontend && node scripts/workspaces.test.mjs`
Expected: every line `PASS`, final line `All workspace checks passed.`, exit 0.

- [ ] **Step 7: Add the suite to `npm run check`**

In `frontend/package.json`, append to the `check` script:
` && node scripts/workspaces.test.mjs`

- [ ] **Step 8: Run the whole frontend check**

Run: `cd frontend && npm run check`
Expected: every suite PASS, including `ui-check: OK` (which proves the new keys exist in
BOTH locale files — it fails on a key present in one and missing in the other).

- [ ] **Step 9: Commit**

```bash
git add frontend/src/utils/workspaces.js frontend/scripts/workspaces.test.mjs \
        frontend/package.json frontend/src/locales/el.json frontend/src/locales/en.json
git commit -m "The workspace rules, in the one place a test can reach them"
```

---

## Task 3: The provider and its hook

**Files:**
- Create: `frontend/src/hooks/useWorkspaces.js`
- Create: `frontend/src/components/WorkspaceProvider.jsx`
- Modify: `frontend/src/App.jsx`

**Interfaces:**
- Consumes: Task 1's `getWorkspaces`; Task 2's `categoriesForWorkspace`.
- Produces: `useWorkspaces()` → `{ workspaces, categories, activeId, setActiveId, reload,
  categoriesFor }`. Tasks 4-7 all read from this.

- [ ] **Step 1: Create `frontend/src/hooks/useWorkspaces.js`**

```js
import { createContext, useContext } from 'react';

/**
 * This user's workspaces and categories, and which one they are looking at.
 * The provider that fills it lives in components/WorkspaceProvider.jsx.
 *
 * Split across two files for the same reason useRecurrence.js is: a module
 * exporting a component may export nothing else, or react-refresh complains.
 */
export const WorkspaceContext = createContext(null);

/**
 * Returns { workspaces, categories, activeId, setActiveId, reload, categoriesFor }.
 *
 * - `activeId` — null means "Όλα", which is the default and includes unfiled
 *   tasks. It is persisted server-side (app_settings.active_workspace_id) so
 *   the phone and the laptop agree.
 * - `categoriesFor(workspaceId)` — that workspace's categories in order.
 * - `reload()` — refetch after any write.
 *
 * Reachable from anywhere on purpose: a task row is four components deep
 * (App → view → TaskList → TaskCard → TaskRow) and the calendar reaches
 * TaskCard by a different path — the same problem RecurrenceProvider solved.
 */
export function useWorkspaces() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspaces must be used inside <WorkspaceProvider>');
  }
  return context;
}
```

- [ ] **Step 2: Create `frontend/src/components/WorkspaceProvider.jsx`**

```jsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getWorkspaces } from '../api';
import { WorkspaceContext } from '../hooks/useWorkspaces';
import { useAppSettings } from '../hooks/useAppSettings';
import { categoriesForWorkspace } from '../utils/workspaces';

/**
 * One copy of this user's workspaces and categories, fetched once.
 *
 * Modelled on RecurrenceProvider, for the same reason: several components at
 * different depths need the same list, and threading it through App → view →
 * TaskList → TaskCard → TaskRow means editing every component in between.
 *
 * The active selection is persisted through app_settings rather than
 * localStorage, so switching to Business on the phone is still Business on the
 * laptop. It is applied optimistically — the chip must not wait for a round
 * trip before it looks pressed.
 */
export function WorkspaceProvider({ children, onShowToast }) {
  const [workspaces, setWorkspaces] = useState([]);
  const [categories, setCategories] = useState([]);

  const { settings, updateSettings } = useAppSettings();
  const [activeId, setActiveIdLocal] = useState(null);

  // Held in a ref rather than read from the closure: onShowToast arrives as a
  // fresh function identity on every render of App, and `reload` is the mount
  // effect's only dependency — depending on it directly would refetch on every
  // keystroke that re-renders the tree above. Same reason, same shape, as
  // RecurrenceProvider.
  const onShowToastRef = useRef(onShowToast);
  useEffect(() => { onShowToastRef.current = onShowToast; }, [onShowToast]);

  const reload = useCallback(() => {
    return getWorkspaces()
      .then((data) => {
        setWorkspaces(data.workspaces || []);
        setCategories(data.categories || []);
      })
      .catch((err) => onShowToastRef.current?.(err.message, 'error'));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Adopt the stored selection once it arrives. Only when the local value is
  // still null: after that the user's own taps win, and re-adopting would
  // undo a switch the moment any other setting changed.
  const adopted = useRef(false);
  useEffect(() => {
    if (adopted.current || !settings) return;
    adopted.current = true;
    if (settings.active_workspace_id) setActiveIdLocal(settings.active_workspace_id);
  }, [settings]);

  const setActiveId = useCallback((id) => {
    setActiveIdLocal(id);            // optimistic: the chip presses immediately
    updateSettings({ active_workspace_id: id }).catch(() => {
      // A failed write costs the memory of the choice, not the choice itself.
      // Reverting the chip the user just pressed would be the worse outcome.
    });
  }, [updateSettings]);

  const categoriesFor = useCallback(
    (workspaceId) => categoriesForWorkspace(categories, workspaceId),
    [categories]
  );

  // If the active workspace is deleted, fall back to "Όλα" rather than
  // filtering against an id nothing matches, which would render every screen
  // empty with no way to tell why.
  const resolvedActiveId = useMemo(
    () => (workspaces.some((w) => w.record_id === activeId) ? activeId : null),
    [workspaces, activeId]
  );

  const value = useMemo(
    () => ({ workspaces, categories, activeId: resolvedActiveId, setActiveId, reload, categoriesFor }),
    [workspaces, categories, resolvedActiveId, setActiveId, reload, categoriesFor]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export default WorkspaceProvider;
```

- [ ] **Step 3: Check the app-settings hook's real shape before wiring it**

Run: `cat frontend/src/hooks/useAppSettings.js`
Run: `grep -n "updateSettings\|settings" frontend/src/components/AppSettingsProvider.jsx | head -20`

`useAppSettings()`'s returned names are whatever those files say. If it exposes something
other than `{ settings, updateSettings }`, adjust the two references in Step 2 to match —
do not add an adapter.

- [ ] **Step 4: Mount the provider in `App.jsx`**

Import it, and wrap INSIDE `AppSettingsProvider` (it reads settings) and outside
`RecurrenceProvider`:

```jsx
    <AppSettingsProvider>
    <WorkspaceProvider onShowToast={handleShowToast}>
    <RecurrenceProvider onShowToast={handleShowToast} onTasksChanged={refreshTasks}>
```

with the matching closing tag. The nesting order matters: `WorkspaceProvider` calls
`useAppSettings`, so it must be below that provider, and it must sit inside the session
check for the reason already commented there — a bearer token is required, so mounting it
above `LoginScreen` fires a guaranteed 401 on every logged-out visit.

- [ ] **Step 5: Verify nothing regressed**

Run: `cd frontend && npm run check && npm run lint 2>&1 | tail -3`
Expected: all suites PASS; `✖ 12 problems`, no new one naming `WorkspaceProvider` or `App`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/useWorkspaces.js frontend/src/components/WorkspaceProvider.jsx frontend/src/App.jsx
git commit -m "One copy of the workspaces, reachable from anywhere"
```

---

## Task 4: The chip row, and the filter it drives

**Files:**
- Create: `frontend/src/components/WorkspaceBar.jsx`
- Modify: `frontend/src/App.jsx`

**Interfaces:**
- Consumes: Task 3's `useWorkspaces`; Task 2's `filterTasksByWorkspace`.
- Produces: the bar renders under `AppBar`; `viewProps.tasks` is already filtered, so no
  view is edited.

- [ ] **Step 1: Create `frontend/src/components/WorkspaceBar.jsx`**

```jsx
import { useTranslation } from 'react-i18next';
import { useWorkspaces } from '../hooks/useWorkspaces';

/**
 * The workspace switcher: a row of chips under the AppBar, "Όλα" first.
 *
 * A row rather than a dropdown in the title, chosen by the owner: switching is
 * one tap and the current position is always visible. It costs ~40px of height
 * on every screen, which is the trade he accepted.
 *
 * Renders NOTHING until there are at least two workspaces. A single chip
 * reading "Όλα" is a control that cannot do anything, and it would take that
 * 40px from every user who never organises anything.
 */
function WorkspaceBar() {
  const { t } = useTranslation();
  const { workspaces, activeId, setActiveId } = useWorkspaces();

  if (workspaces.length < 2) return null;

  const chips = [{ record_id: null, name: t('workspace.all'), color: null }, ...workspaces];

  return (
    // overflow-x-auto so four or five workspaces scroll sideways instead of
    // wrapping into a second row and pushing the list further down.
    <div className="sticky top-14 z-20 bg-[var(--bg-card)] border-b border-[var(--border-subtle)]">
      <div
        className="max-w-3xl mx-auto flex gap-2 px-4 py-2 overflow-x-auto"
        role="tablist"
        aria-label={t('workspace.label')}
      >
        {chips.map((workspace) => {
          const selected = activeId === workspace.record_id;
          return (
            <button
              key={workspace.record_id || 'all'}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActiveId(workspace.record_id)}
              // The colour is per-workspace data, so it cannot be a Tailwind
              // class — those are compiled ahead of time and a runtime hex has
              // no class to match. Inline style is the only option here.
              style={selected && workspace.color
                ? { backgroundColor: workspace.color, borderColor: workspace.color }
                : undefined}
              className={`flex-shrink-0 px-3 py-1 rounded-full border text-sm font-medium transition-colors ${
                selected
                  ? 'text-white border-[var(--brand-primary)] bg-[var(--brand-primary)]'
                  : 'text-[var(--text-secondary)] border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              {workspace.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default WorkspaceBar;
```

- [ ] **Step 2: Render it and filter once, in `App.jsx`**

Import `WorkspaceBar` and `filterTasksByWorkspace` and `useWorkspaces`. Render the bar
directly after `<AppBar ... />`.

Then filter the list ONCE, where `viewProps` is built:

```jsx
  // Filtered here, in one place, rather than in each view: viewProps feeds
  // Inbox, Today, Calendar and Browse, so every screen obeys the switcher
  // without any of them being edited. Client-side over the already-fetched
  // list — the switcher changes what you LOOK AT, never what the system does,
  // so reminders, calendar sync and Hostaway are untouched by it.
  const visibleTasks = filterTasksByWorkspace(tasks, activeId);
```

and use `visibleTasks` in `viewProps` in place of `tasks`.

**Read `App.jsx` around where `viewProps` is defined before editing** — the exact variable
name and shape are whatever that file says.

`useWorkspaces()` cannot be called in `App` itself: `App` RENDERS the provider, so it sits
above the context. Either read `activeId` in a small inner component, or move the filtering
into the piece of the tree that is inside the provider. Prefer the second — no new
component for one value.

- [ ] **Step 3: Verify**

Run: `cd frontend && npm run check && npm run lint 2>&1 | tail -3`
Expected: all suites PASS; `✖ 12 problems`, no new entry.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/WorkspaceBar.jsx frontend/src/App.jsx
git commit -m "The switcher, and one filter that every screen obeys"
```

---

## Task 5: The management screen

**Files:**
- Create: `frontend/src/components/WorkspacesView.jsx`
- Modify: `frontend/src/components/SettingsModal.jsx`

**Interfaces:**
- Consumes: Task 1's CRUD calls; Task 3's `useWorkspaces`; Task 2's `nextPosition`.
- Produces: a settings sub-view. `SettingsModal` gets one row that opens it, modelled on
  the existing `RecurrencesView` row.

- [ ] **Step 1: Read the pattern before writing**

Run: `sed -n '1,80p' frontend/src/components/RecurrencesView.jsx`
Run: `grep -n "RecurrencesView\|SettingsRow" frontend/src/components/SettingsModal.jsx | head`

`WorkspacesView` follows that file's structure exactly: same card shape, same loading
placeholder, same toast calls. Match it rather than inventing a second settings idiom.

- [ ] **Step 2: Create `frontend/src/components/WorkspacesView.jsx`**

```jsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  createWorkspace, updateWorkspace, deleteWorkspace,
  createCategory, updateCategory, deleteCategory,
} from '../api';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { nextPosition } from '../utils/workspaces';

/**
 * Create, rename and delete workspaces and the categories inside them.
 *
 * Two levels in one screen rather than a drill-down: a workspace with three
 * categories is a four-line block, and hiding those three behind another tap
 * makes the one question the user actually has — "what have I got?" — take a
 * tap per workspace to answer.
 *
 * The Hostaway category renders with no rename field and no delete button. The
 * backend refuses both with a 422 either way; not offering the action is the
 * point, because an offered button that always fails is worse than no button.
 */
function WorkspacesView({ onShowToast }) {
  const { t } = useTranslation();
  const { workspaces, categories, reload, categoriesFor } = useWorkspaces();
  const [busy, setBusy] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [newCategoryFor, setNewCategoryFor] = useState(null); // workspace_id
  const [newCategoryName, setNewCategoryName] = useState('');

  // Every write goes through here: one place that reports failure, reloads the
  // shared copy, and cannot leave `busy` stuck on if the call throws.
  async function run(action, successKey) {
    setBusy(true);
    try {
      await action();
      await reload();
      if (successKey) onShowToast?.(t(successKey), 'success');
    } catch (err) {
      // 409 is the one failure the user can act on, so it gets its own words
      // instead of the raw server sentence.
      const message = String(err.message || '').includes('409')
        ? t('workspace.name_taken')
        : err.message;
      onShowToast?.(message, 'error');
    } finally {
      setBusy(false);
    }
  }

  function handleDeleteWorkspace(workspace) {
    // The count comes back FROM the delete, so the confirmation cannot quote
    // it. It says what will happen instead — that tasks survive — which is the
    // part the user needs before clicking, not the number.
    const message = t('workspace.delete_workspace_confirm', { name: workspace.name, count: '' });
    if (!window.confirm(message)) return;
    run(() => deleteWorkspace(workspace.record_id), 'workspace.deleted');
  }

  function handleDeleteCategory(category) {
    const message = t('workspace.delete_category_confirm', { name: category.name, count: '' });
    if (!window.confirm(message)) return;
    run(() => deleteCategory(category.record_id), 'workspace.deleted');
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--text-secondary)]">{t('workspace.manage_hint')}</p>

      {workspaces.map((workspace) => (
        <div
          key={workspace.record_id}
          className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-input)] p-3 space-y-2"
        >
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={workspace.color || '#888888'}
              disabled={busy}
              onChange={(e) => run(() => updateWorkspace(workspace.record_id, { color: e.target.value }))}
              className="w-7 h-7 rounded border-0 bg-transparent flex-shrink-0"
              aria-label={`${workspace.name} — ${t('workspace.label')}`}
            />
            <input
              type="text"
              defaultValue={workspace.name}
              disabled={busy}
              // onBlur, not onChange: a PATCH per keystroke would be one
              // request per letter, and each one can 409 on a half-typed name.
              onBlur={(e) => {
                const name = e.target.value.trim();
                if (name && name !== workspace.name) {
                  run(() => updateWorkspace(workspace.record_id, { name }), 'workspace.saved');
                }
              }}
              className="flex-1 min-w-0 bg-transparent text-[var(--text-primary)] font-medium focus:outline-none"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => handleDeleteWorkspace(workspace)}
              className="tap-44 px-2 text-sm text-[var(--danger-text)] hover:underline flex-shrink-0"
            >
              {t('calendar.disconnect')}
            </button>
          </div>

          <div className="pl-9 space-y-1">
            {categoriesFor(workspace.record_id).length === 0 && (
              <p className="text-xs text-[var(--text-muted)]">{t('workspace.no_categories')}</p>
            )}

            {categoriesFor(workspace.record_id).map((category) => (
              <div key={category.record_id} className="flex items-center gap-2">
                <input
                  type="color"
                  value={category.color || '#888888'}
                  disabled={busy}
                  onChange={(e) => run(() => updateCategory(category.record_id, { color: e.target.value }))}
                  className="w-5 h-5 rounded border-0 bg-transparent flex-shrink-0"
                  aria-label={`${category.name} — ${t('workspace.category_label')}`}
                />
                {category.system_key ? (
                  <span
                    className="flex-1 min-w-0 truncate text-sm text-[var(--text-secondary)]"
                    title={t('workspace.system_locked')}
                  >
                    {category.name} 🔒
                  </span>
                ) : (
                  <>
                    <input
                      type="text"
                      defaultValue={category.name}
                      disabled={busy}
                      onBlur={(e) => {
                        const name = e.target.value.trim();
                        if (name && name !== category.name) {
                          run(() => updateCategory(category.record_id, { name }), 'workspace.saved');
                        }
                      }}
                      className="flex-1 min-w-0 bg-transparent text-sm text-[var(--text-primary)] focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleDeleteCategory(category)}
                      className="tap-44 px-2 text-xs text-[var(--danger-text)] hover:underline flex-shrink-0"
                    >
                      ✕
                    </button>
                  </>
                )}
              </div>
            ))}

            {newCategoryFor === workspace.record_id ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = newCategoryName.trim();
                  if (!name) return;
                  setNewCategoryName('');
                  setNewCategoryFor(null);
                  run(() => createCategory({
                    workspace_id: workspace.record_id,
                    name,
                    position: nextPosition(categoriesFor(workspace.record_id)),
                  }), 'workspace.saved');
                }}
              >
                <input
                  autoFocus
                  type="text"
                  value={newCategoryName}
                  placeholder={t('workspace.name_placeholder')}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  onBlur={() => { if (!newCategoryName.trim()) setNewCategoryFor(null); }}
                  className="w-full bg-[var(--bg-card)] rounded px-2 py-1 text-sm border border-[var(--border-subtle)] focus:outline-none"
                />
              </form>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => setNewCategoryFor(workspace.record_id)}
                className="tap-44 text-xs text-[var(--brand-primary)] hover:underline"
              >
                + {t('workspace.new_category')}
              </button>
            )}
          </div>
        </div>
      ))}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const name = newWorkspaceName.trim();
          if (!name) return;
          setNewWorkspaceName('');
          run(() => createWorkspace({ name, position: nextPosition(workspaces) }), 'workspace.saved');
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          value={newWorkspaceName}
          placeholder={t('workspace.new_workspace')}
          onChange={(e) => setNewWorkspaceName(e.target.value)}
          className="flex-1 min-w-0 bg-[var(--bg-input)] rounded-lg px-3 py-2 text-sm border border-[var(--border-subtle)] focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !newWorkspaceName.trim()}
          className="tap-44 px-4 rounded-lg bg-[var(--brand-primary)] text-white text-sm font-medium disabled:opacity-50"
        >
          +
        </button>
      </form>
    </div>
  );
}

export default WorkspacesView;
```

- [ ] **Step 3: Add the row to `SettingsModal.jsx`**

Following exactly how the Recurrences row opens its sub-view in that file, add a row
labelled `t('workspace.manage')` that renders `<WorkspacesView onShowToast={onShowToast} />`.

- [ ] **Step 4: Verify**

Run: `cd frontend && npm run check && npm run lint 2>&1 | tail -3`
Expected: all suites PASS; `✖ 12 problems`, no new entry.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/WorkspacesView.jsx frontend/src/components/SettingsModal.jsx
git commit -m "A screen for making your own boxes"
```

---

## Task 6: Putting a task in a box

**Files:**
- Modify: `frontend/src/components/TaskDetailSheet.jsx`

**Interfaces:**
- Consumes: Task 3's `useWorkspaces`; the existing task-update path in that file.
- Produces: two rows on the detail sheet. Nothing else depends on them.

Without this, the user can create categories and has no way to use one. It is the half that
makes Task 5 worth having.

- [ ] **Step 1: Read the existing rows before writing**

Run: `grep -n "Repeat\|recurrence\|CustomSelect\|onTaskUpdate\|handleFieldChange" frontend/src/components/TaskDetailSheet.jsx | head -20`

The "Repeat — Never / Mon-Fri at 09:00" row and the reminder/calendar switches are the
pattern. Match their markup and their update call; do not introduce a third idiom.

- [ ] **Step 2: Add the two rows**

Two `CustomSelect`s, in this order and with this coupling:

```jsx
  const { workspaces, categoriesFor } = useWorkspaces();

  const workspaceOptions = [
    { value: '', label: t('workspace.unfiled') },
    ...workspaces.map((w) => ({ value: w.record_id, label: w.name })),
  ];

  // The category list depends on the workspace above it. Changing the
  // workspace CLEARS the category in the same update — the backend refuses a
  // category from another workspace with a 422 (services.validate_workspace_
  // placement), so sending the old one would fail the whole write and lose the
  // workspace change too.
  const categoryOptions = [
    { value: '', label: t('workspace.unfiled') },
    ...categoriesFor(task.workspace_id).map((c) => ({ value: c.record_id, label: c.name })),
  ];
```

with handlers that send `null`, not `''`, for the cleared case — an empty string is not a
uuid and the column is nullable:

```jsx
  function handleWorkspaceChange(value) {
    // Both fields in ONE update: the pair must stay coherent, and two separate
    // PATCHes leave a window where the task points at a category in a workspace
    // it no longer belongs to.
    onFieldChange({ workspace_id: value || null, category_id: null });
  }

  function handleCategoryChange(value) {
    onFieldChange({ category_id: value || null });
  }
```

`onFieldChange` is whatever that file already calls to PATCH a task — use its real name
from Step 1.

- [ ] **Step 3: Verify**

Run: `cd frontend && npm run check && npm run lint 2>&1 | tail -3`
Expected: all suites PASS; `✖ 12 problems`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/TaskDetailSheet.jsx
git commit -m "A task can be put in a box"
```

---

## Task 7: The chip on the row

**Files:**
- Modify: `frontend/src/components/TaskRow.jsx`

**Interfaces:**
- Consumes: Task 2's `describePlacement`; Task 3's `useWorkspaces`.

- [ ] **Step 1: Read where the recurrence badge renders**

Run: `grep -n "describeRecurrencePattern\|useRecurrence\|badge" frontend/src/components/TaskRow.jsx | head`

The placement chip sits in the same meta line, before the recurrence badge.

- [ ] **Step 2: Add the chip**

```jsx
  const { workspaces, categories } = useWorkspaces();
  const placement = describePlacement(task, workspaces, categories, t);
```

Render it only when the task is actually filed — an "Unfiled" chip on every task in an app
where nobody has made a workspace yet is noise on every row:

```jsx
  {task.workspace_id && (
    <span className="text-xs text-[var(--text-muted)] truncate">{placement}</span>
  )}
```

`describePlacement` still returns the "Unfiled" string for an unknown workspace, and that
is deliberate — this guard is about not showing the chip at all, while the function's own
fallback is about never printing `undefined` if it is shown.

- [ ] **Step 3: Verify**

Run: `cd frontend && npm run check && npm run lint 2>&1 | tail -3`
Expected: all suites PASS; `✖ 12 problems`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/TaskRow.jsx
git commit -m "A row says which box it is in"
```

---

## Slice 2 completion checklist

Automated:

- [ ] `cd frontend && npm run check` — every suite PASS, including the new `workspaces` one
      and `ui-check: OK` (which proves the new keys are in **both** locale files)
- [ ] `cd frontend && npm run lint 2>&1 | tail -3` — **12 problems**, not 13
- [ ] `./venv/Scripts/python.exe -m pytest tests/ -q` — **267 passed**, untouched by this slice

**The browser walkthrough the owner runs himself.** No test in this project can render a
component, so every item below is the only evidence that exists for it:

- [ ] The app opens and looks **exactly as before**, except a chip row reading
      **Όλα · Business · Personal**.
- [ ] Tapping **Business** narrows Today, Upcoming, Calendar and Browse — all four.
- [ ] Tapping **Όλα** brings everything back, **including the 12 unfiled tasks**.
- [ ] The choice survives a full page reload, and shows the same on a second device.
- [ ] Settings → Workspaces: create **Επενδύσεις**, add **μετοχές** and **crypto** to it.
- [ ] The new workspace appears in the chip row **without a reload**.
- [ ] Open a task → set workspace **Επενδύσεις**, category **μετοχές** → the row shows
      "Επενδύσεις · μετοχές".
- [ ] Change that task's workspace to **Personal** → **the category clears itself** rather
      than erroring.
- [ ] The **Hostaway** category shows a 🔒, cannot be renamed, and offers no ✕.
- [ ] Delete **Επενδύσεις** → its tasks are **still there**, now with no chip.
- [ ] **A real Hostaway guest task still arrives and still escalates** — the switcher must
      not have touched anything the system does on its own.

## What Slice 2 deliberately leaves undone

- **The "Κατηγορία" filter dropdown still filters the old four words.** See Global
  Constraints — repointing it before the AI fills `category_id` would show empty results
  for 163 of 301 tasks. Slice 3.
- The AI and the chat agent still know only `Business/Personal/Unknown/Hostaway`. Slice 3.
- Recurrence rules cannot be given a workspace. Slice 4.
- `tasks.category` still exists. Slice 5, and only after Slice 3 stops writing it.
- No drag-to-reorder. `position` exists and is respected on read; nothing sets it but
  creation order. Deliberate — a reorder gesture is its own piece of work and nobody has
  asked for it.
