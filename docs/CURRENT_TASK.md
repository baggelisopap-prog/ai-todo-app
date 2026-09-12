ACTIVE TASK — Filters: one memory, and a screen that stops lying about being empty
_Overwrite this whole file when a new task starts. Keep the "ACTIVE TASK —" first line exact (cold-start anchor)._

> The previous task's HANDOVER section is CARRIED FORWARD at the bottom of this file,
> unchanged. Nothing in it is done: it needs a second person in the room and one migration
> run by hand. `PROJECT_STATUS.md` points at it by name, so it stays until it is closed.
> What was dropped from this file is only the multi-user task's slice-by-slice history —
> that lives in git (`823e824` and its parents) and in summary in `PROJECT_STATUS.md`.

## What was asked

The owner, 2026-09-12, opening the session by declaring the day's subject: «σημερα θελω να
δουλεψουμε το ui and ux οποτε θελω να είσαι expert σε αυτο τον τομέα». Then the actual
request:

> «επιδει εχουμε πολλα πλεον workplaces gategorys φιλτρο μεσα στο φιλτρο θελω να γινει λιγο
> ποιο εξυπνο λειτουργικο και ευχρηστο ταυτοχρονα για ανηδεους χρήστες.»

Six things were found in the code before anything was proposed, and he was shown all six:
the vertical cost (~190px of controls above the first task on a phone, ~30% of the screen),
two different memory rules sitting 30px apart, the category control vanishing on «Όλα», no
sign anywhere that a filter was on, two different habits for one job (Browse had counts and
a sort, Today had neither), and chips that scroll off the right edge with no way back to
the selected one.

## The decisions, and they were his

1. **Which two of the six actually hurt.** Asked to pick, he chose «2 και 3» — *«χάνομαι:
   δεν ξέρω τι φίλτρο είναι ανοιχτό»* and *«τα φίλτρα δεν θυμούνται»*. The height complaint
   he did NOT pick, which is why the pickers were left where they are.
2. **The shape follows the number, not his own account**: «αναλογα με τον αριθμο να γινεται
   γτ δεν ξερω ο καθε χρηστης ποσα θα εχει». This is why `switcherShape()` is a tested rule
   with stated thresholds instead of a layout tuned to his two workspaces.
3. **Slices 1 and 2 now, slice 3 by discussion**: «κανε τα 2 και ελα για σκεψη
   καταιγιδισμο ιδεων για το 3».
4. **Push before the talk**, so he could look at it: «κανε πρωτα ενα push να δω τι εχεις
   κανει μεχρι τωρα».

## What shipped — `e8cb35a`, pushed to `main`

**One shared copy of the filters.** Category, priority and whose lived in three `useState`s
PER SCREEN. `components/TaskFilterProvider.jsx` now holds one copy, mounted inside
`TaskViews` — below the workspace scoping, because that is the first line where both things
it needs are known: the active room, and the task list the counts come from. `FilterBar`
consequently takes **no props at all**, where it used to take six.

**It deliberately does not persist.** A P1 left on from Tuesday is work hidden on Thursday.
The filters live as long as the app is open; the workspace remains the only thing that
survives a restart (it is in `app_settings`, so phone and laptop agree). See DECISIONS.md.

**The rule that carries the whole change**, in `utils/taskFilters.js`: *a filter must never
apply while the control that set it is off screen.* Two ways that used to happen, both
producing an empty list with nothing on screen to explain it:

- A category id belongs to ONE workspace. Filtering by κήπος and switching to Γραφείο left
  the id in place: **zero tasks, and a category control rendering a blank label** because
  nothing in its options matched. This was a live bug, not a theory.
- «Δικά μου» hides its own control on a solo workspace, while the value it had set stayed
  behind and kept filtering.

So the STORED value and the value IN FORCE are not the same thing. The category is stored
**per workspace**, which makes the stale id unrepresentable rather than merely fixed — and
has the side effect that coming back to a room finds the filter where it was left. Derived
with `useMemo`, never copied into state by an effect, so nothing has to clean up after a
switch.

**The row that says what is hidden.** `components/ActiveFilters.jsx`: one pill per active
filter with an ×, a funnel in front, and «Καθάρισε τα φίλτρα» from two filters up. It
renders **nothing at all** when nothing is filtered, so the common case costs no height —
it appears only in the state that needs explaining. Used by Today, the Calendar and both
Browse tabs, in the same place with the same gesture.

**The empty screens stopped lying.** Where a list is empty BECAUSE of a filter, the message
is «Κρυμμένες από τα φίλτρα: 12» with a clear button, instead of «Τίποτα για σήμερα 🎉»
over a day that has work in it. The count is measured against the unfiltered list only in
that one case. On the history tab it is counted in the same pass as the rows: asking
`historyCounts.all` instead would count every KIND of event in the range, so a filter
hiding three completions would have claimed to hide forty.

**The switcher's shape follows the count** (`switcherShape`, tested): under two workspaces
nothing is drawn; two to five keep the chips he chose, **plus the selected one scrolled into
view** — the active workspace is restored from `app_settings`, so the app could open already
filtered by a chip off the right edge with every visible chip looking unselected; six and up
become one menu; past eight options the menu gains a find box that folds Greek accents the
same way the task search does («κηπος» finds «Κήπος»). `SideNav` gets the same
scroll-into-view for the same failure in the vertical direction.

**Counts everywhere.** «Κήπος (7)» now appears on every screen, not only in Browse, counted
over live work in the whole workspace rather than over what is already narrowed. An empty
category is dimmed but stays in the user's own order — a list that rearranges itself by how
full each row is makes his own ordering unreliable.

### Three behaviour changes worth naming

1. **A task with no priority now counts as P3**, which is what its own row has always
   printed. Today compared the raw value and Browse compared the defaulted one; only one of
   them agreed with the badge beside it.
2. **«Δικά μου» now applies in Browse**, where it had never been wired despite being the
   same question.
3. **The category menu's resting label is the axis** («Κατηγορία»), not «Όλα». Two closed
   controls both reading «Όλα» say neither what they filter nor that they are idle. Browse
   loses the total it used to print there; the per-category counts carry it instead.

### One old bug fixed in passing, because the find box could not work without it

A capturing `scroll` listener on `window` closed `CustomSelect`'s menu when you scrolled the
menu's OWN list — scroll reaches capturing listeners even though it does not bubble. So
reaching the bottom of a long list closed the thing you were reading. And a phone fires
`resize` the instant the keyboard opens, which would have closed a searchable menu before a
single character arrived; it re-measures instead.

## Changed

```
new   frontend/src/utils/taskFilters.js          the rules, pure and tested
new   frontend/src/hooks/useTaskFilters.js       the context
new   frontend/src/components/TaskFilterProvider.jsx
new   frontend/src/components/ActiveFilters.jsx  the row with the ×s
new   frontend/scripts/task-filters.test.mjs     65 checks, wired into npm run check
edit  FilterBar.jsx (six props → none), WorkspaceBar.jsx (three shapes), CustomSelect.jsx
      (find box, dimmed options, the two listener fixes), EmptyState.jsx (an action button),
      TodayView.jsx, CalendarView.jsx, BrowseView.jsx, UpcomingList.jsx, SideNav.jsx,
      icons.jsx (FunnelIcon), App.jsx (mounts the provider), el.json + en.json (6 keys)
```

## Baselines, as the commands printed them

```
node scripts/task-filters.test.mjs   65 PASS, 0 FAIL — "All filter checks passed."
npm run check                        ui-check: OK — 85 files, 49 tokens, 483 translation keys   (exit 0)
npm run lint                         ✖ 12 problems (12 errors, 0 warnings)   — unchanged baseline
npm run build                        ✓ built in 446ms
pytest tests/ -q                     505 passed in 4.75s   (untouched; this is frontend-only)
```

`npm run check` does not compile JSX, so `npm run build` was run separately and on purpose:
without it a broken component passes the gate and fails on his phone.

## What a person has actually SEEN

**Nothing.** Not one of these screens has been looked at in a browser, by anyone. The logic
is covered by 65 pure-function checks against the real locale files — which is what catches
the failure mode that matters for a chip, a MISSING TRANSLATION KEY, since i18next renders
the key itself and the build stays green. That is not the same as seeing it.

## What nobody has watched, and what would settle it

| Not watched | What would settle it |
|---|---|
| The chip row itself: does it read as "filters", is the × big enough for a thumb | Turn on a category and a priority on Today, look at the row, tap one × |
| «Κρυμμένες από τα φίλτρα: 12» + its button | Set P1 on a day with no P1 work; the old text would say «Τίποτα για σήμερα 🎉» |
| The filters following you between screens | Set κήπος on Today, go to Ημερολόγιο and Όλα — the chip must still be there |
| The stale-category fix | With κήπος on, switch workspace: the list must fill, not empty, and the chip must vanish |
| The find box (needs 8+ categories or 6+ workspaces) | Nobody has an account that big — **this is the least proven part of the change** |
| The auto-scroll to the selected chip | Needs 4-5 workspaces so the row actually overflows |
| Greek accent folding in the find box | Type «κηπος» without the accent and see «Κήπος» |

## Still open, deliberately

- **Slice 3 — the pickers behind one «Φίλτρα» button** (~60px back on every screen). Not
  built, because it **reverses a decision he made himself**: the chip row is a row precisely
  so the current position is always visible. He asked to brainstorm it rather than have it
  proposed as a finished thing.
- **The category control still disappears on «Όλα».** Left alone on purpose in slices 1-2:
  fixing it properly means a cross-workspace, grouped «Ακίνητα › Κήπος» picker, which is
  slice 3's territory. Today the coarse filtering is done by the chips instead. See BACKLOG.

---
---

# HANDOVER, 2026-09-12

_Written because the owner had to stop: «δεν μπορω να δοκιμασω τωρα ειμαι μονος». Nothing
below can be checked by one person on one account, which is exactly why it is written down
rather than remembered._

_CARRIED FORWARD 2026-09-12 into the filters task above: none of it is closed._

## Live right now

Seven pushes, `f860456..64c806e`. Vercel and Render deploy themselves from `main`.

| | State |
|---|---|
| Sharing: invite, join, members, archive, activity log | live, **and a second person really joined** |
| Assignee badge on rows, «Όλα / Δικά μου / Αδιάθετα» | live, **never seen by anyone** — renders nothing on a solo account by design |
| Task sheet: icon rows, press-and-hold labels, pills | live, **confirmed by the owner on his phone** |
| Agent on one line | live, **confirmed** |
| Member-can-write fixes + the six latent bugs | live, **none verified by a person** |
| Read-retry on 5xx, «Ο διακομιστής ξυπνάει…» | live, unverified |
| Activity log stops inventing assignments | live, unverified |

## THE ONE THING WAITING ON THE OWNER'S HANDS

`docs/migrations/2026-09-12-lock-ai-snapshot-columns.sql`, in the Supabase SQL Editor.

**Not urgent, and nothing is broken without it.** It locks a door that is currently
unlocked: `ai_suggested_category` / `ai_suggested_priority` are required by the code and
still nullable in the table, because a Postgres CHECK passes on NULL. Three steps, in the
file: count (both must read 0 — measured 398 tasks, 0 null on 2026-09-12), uncomment the
two ALTERs, uncomment the confirmation. If the count is ever non-zero, STOP — the ALTER
refuses rather than damages, and those rows need deciding about first.

The reason it is safe to leave undone: `tests/test_task_insert_paths.py` already fails on a
developer's machine if a third task-creation path appears. The lock is a second net under
the first.

## WHAT NOBODY HAS SEEN, AND IT NEEDS EVI

**None of this can be checked alone.** The assignee badge and the «Δικά μου» filter draw
nothing at all on a solo account — opening the app by yourself proves only that they do not
crash.

Hand Evi a task, then have HER try, in this order — the first is the reported bug and the
next four were broken by the same cause and had never been hit:

1. **Close it.** The bug she found. Everything else is a bonus.
2. **Rename it.**
3. **Change its date** — then check the reminder actually fires. This one failed SILENTLY:
   the flag that re-arms a reminder was never cleared, so the task simply stayed quiet.
4. **Change its category.** It used to refuse with the wrong reason.
5. **Re-assign it back to him.** It used to refuse with «this task has no workspace», about
   a task that has one.
6. **Ask the agent, from her account, about one of his tasks.** It used to answer «Task not
   found» for a task it was showing her in the list.

Then the three that are his to watch:

- **A Hostaway task assigned to her.** The worst of the latent bugs: her tick processes it,
  and before the fix the "answered" stamp was never written, so **the escalation re-sent
  every two minutes forever on her phone.** The way to see it is that her phone does NOT
  buzz repeatedly.
- **«Δικά μου» against the agent.** Ask «τι έχω σήμερα» and count the list beside it. They
  must agree — they share one definition on purpose, and two answers would mean the screen
  and the agent disagree about whose work it is.
- **The activity screen.** It should stop growing a row per save.

## The pattern behind all seven bugs, worth keeping

Sharing split one question into two: **"may I change this?"** and **"is it mine?"**.
`access.py` answers the first. Everywhere the code still asked the second while meaning the
first, something broke — and five of the seven broke **silently**. If a member ever
"cannot" do something, or something quietly does not happen for them, that is the first
suspicion, and `repository.scope_to_visible` is the shape of the answer.

## Where the numbers stood at the close

```
505 passed in 4.79s                                    (backend)
ui-check: OK — 81 files, 49 tokens, 477 translation keys
✖ 12 problems (12 errors, 0 warnings)                  (lint baseline, unchanged)
✓ built in 455ms                                       (vite build)
```

Design mockups he approved along the way, still readable:
the task sheet — claude.ai/code/artifact/8785d076-bf46-496f-9d52-e97cb682567c
the agent's three options — claude.ai/code/artifact/1378a12f-1fb2-4191-894d-f75558ac53ab
