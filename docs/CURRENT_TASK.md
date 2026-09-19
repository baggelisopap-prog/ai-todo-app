ACTIVE TASK — A completion by somebody else is a handover. Migration APPLIED, code deployed, NOBODY HAS LOOKED AT IT
_Overwrite this whole file when a new task starts. Keep the "ACTIVE TASK —" first line exact (cold-start anchor)._

> **THE MIGRATION IS APPLIED (2026-09-18, by the owner) AND THE CODE IS PUSHED.** Read back
> from the live database the same day: **total 459, completed 376, closed_by_a_person 0,
> acknowledged 0, completion_seen_by NULL 0.** All three zeros were required — every task
> already finished carries a NULL `completed_by` and therefore stays gone from every list.
> The numbers are recorded in the migration file itself.
>
> The order mattered and was kept: migration first, deploy second. Reversed, it rejects
> **every task write in the app** (PGRST204 on an unknown column) — the failure
> `category_name` caused on 2026-09-01 — and the guard test
> `test_the_write_path_sends_only_real_columns` names both new columns so it cannot be
> forgotten quietly next time.
>
> The previous task (the task row rebuilt tighter, `b306a1e` and before) is finished and lives
> in git and PROJECT_STATUS.md.

## What was asked

The owner opened it as a bug, 2026-09-17:

> «εχω bug προς επιλυση. στο κοινω workspace έβαλε ο αλλος χρήστης ένα task. χωρίς να μου το
> κανει asiign μπόρεσα και το έκλεισα εγω.»

**It was not a bug.** `access.can_write` has said "you may write to what you can see" since
2026-09-11, deliberately and with his agreement — see the DECISIONS.md entry from that date,
where his own instinct («να μην μπορεί να πειράξει όλα τα task στο workspace») was put aside
after reading what Trello and Todoist do. The boundary is the container, not the card.

**What WAS broken is the half of that bargain that was never delivered.** The loose write rule
was made safe by three things, one of them being "`workspace_activity` records who did what" —
and the log knew about assignment and nothing else. Closing a task, the one act that ends it,
was recorded **nowhere**: not in the log, and not on the row, which keeps `completed_at` (when)
and `completed_source` (through which channel) but never who.

Told that, he did not ask for the lock. He asked for something better:

> «όταν ένα task το κλείσει κάποιος αλλος πχ εχω κάνει εγω αναθεση σε κάποιον αλλο αυτος το
> κλείνει. (ετσι πρέπει) όμως θέλω να φευγει τελειος σε αυτών αλλά αυτός που το έκανε asign να
> βλεπει ένα μύνημα. ο τάδε έχει κλείσει το τάδε task και όταν πατάς οκ να κλείνει και σε
> μένα. αλλά κάπως να διαφοροποείτε οταν έχει κλείσει από κάποιον άλλον»

and, asked how he pictured the message:

> «όχι απλά βλέπει όταν πάει στα task ότι αυτος το ολοκλήρωσε φαντάζομαι κάτι σε να φαινεται
> μια γραμμη διαγραμμενο απλα να μην έχει φύγει.»

and, separately, a rule of his own:

> «πρώτον οποιος φτιάχνει ένα task ειναι αυτο που εχει ανατεθει το task εκτος αν το στείλει σε
> κάποιον άλλο μονο δλδ αν πατηση assign to. αλλιως ασσιγν ston eayto toy.»

He approved the design with «νιαιι» (both the handover and the display half of that last rule).

## The decisions that were his

1. **No per-task lock.** Offered explicitly — «μέλος αλλάζει μόνο ό,τι του έχει ανατεθεί», one
   `if` in `access.py`, the tightening `access.py` was written to accept. He chose the handover
   instead. Nothing in `access.py` changed.
2. **A strip inside the row, not a popup.** The alternative — a dialog on app open listing what
   others closed — was rejected with him: dismissed in a hurry it is gone, and what it was
   telling you is gone with it.
3. **"Creator = assignee" is a DISPLAY rule.** See the DECISIONS.md entry; the system already
   behaved that way everywhere that acts.

## Two facts found while building, both his to know

**The task he closed was unassigned** (his answer: «Σε κανέναν (αδέσποτο)»). Worth recording
because the lock he originally imagined **would not have stopped him**: its natural form leaves
untaken work open to every member, or nobody could ever pick anything up.

**`is_open_task` was left alone on purpose.** A task awaiting someone's OK is finished work, so
it does not ring a phone, does not enter the daily summary and does not appear in the agent's
day view. The consequence, stated rather than discovered later: ask the agent «τι έχω σήμερα»
while a handover is on screen and it will answer one lower than the rows you can count. The row
is struck through, so it does not read as open work — but the numbers do differ, and that is a
choice, not an oversight. Reminding somebody about a task a colleague already finished would be
the worse failure.

## What changed, and where

**Database — one migration, two columns, APPLIED 2026-09-18**
`docs/migrations/2026-09-17-completion-handover.sql`
- `tasks.completed_by uuid` — who closed it. NULL means no human did (Hostaway reply poller,
  missed occurrences) **and every task completed before today**, which is what keeps several
  hundred finished tasks from reappearing on a list. There is no backfill and must not be.
- `tasks.completion_seen_by uuid[] not null default '{}'` — who has pressed OK. An array, not
  a boolean, because two people can be owed the same handover (creator and assignee) and one
  flag would let whoever read it first clear it for the other — exactly how
  `tasks.notification_sent` broke reminders when sharing arrived.

**Backend**
- `services.update_task` stamps `completed_by` on every completion (UI **and agent** — telling
  the agent to close a task is closing it) and clears both columns on reopen. It now keeps the
  write gate's return value instead of discarding it, because the row it already read carries
  the workspace the log needs.
- `services.update_task` writes `task_completed` / `task_reopened` to `workspace_activity`.
  **This is the gap that started the whole thing.**
- `services.acknowledge_completion` / `repository.acknowledge_completion` — read-modify-write on
  the array, narrowed by `scope_to_visible`. Deliberately **not** behind `access.require_write`:
  the only value written is the caller's own id, so "may I see this" is the whole question.
- `POST /tasks/{id}/acknowledge-completion`, 404 (not 403) when the task is not visible.

**Frontend**
- `taskDisplay.awaitsMyAcknowledgement` / `isClosedForMe` — the rule, in one place. Four list
  sites moved off `!task.is_completed`: Today, Upcoming, Browse's Ενεργά, and the category
  counts in `TaskFilterProvider` (which must match Browse exactly or the number beside a
  category disagrees with the list it opens). **The Inbox was left alone** — it is about
  approving AI suggestions, not about finished work.
- `TaskRow` draws **a notice instead of a row** for a handover (2026-09-19, redesigned with
  him from three rendered options): no circle, no priority ring, no bell or calendar, no swipe
  tray — «Ο/Η Μαρία ολοκλήρωσε ~~Έλεγχος θέρμανσης Β4~~», the timestamp, and two buttons,
  **Ξανάνοιγμα** and **ΟΚ**. The first version put a strip inside the card and he rejected it
  on sight; see DECISIONS.md.
- **The bug that rejection exposed, fixed at the root**: `isCompleted` faded the whole
  `<article>` to 70%, which fades the card's own BACKGROUND, so the permanently-mounted swipe
  tray read through the text — «πεφτει το ένα γραμμα πανω στο αλλο». The fade now sits on the
  content block inside the card. **This was never only about handovers**: the Calendar lists
  completed rows permanently and had the same bleed all along.
- `assignment.effectiveAssignee` — the avatar names the creator when nobody has taken the task.
- `formatDate.formatStamp` — `stampOf` moved out of HistoryList so the row and the History
  screen print an instant the same way. No behaviour change to History.
- **Tapping a History row opens the task, read-only** (2026-09-19). `TaskDetailSheet` gains a
  `readOnly` flag rather than gaining a twin: no Edit button, no ⋯ menu, no completion circle
  to press, no reminder/calendar switches, no recurrence editor, **no inline AI editor** (that
  one was missed on the first pass and caught by the owner on sight), and the checklist prints
  its marks instead of offering them. The footer keeps the row's own way back — Επαναφορά /
  Ξανάνοιγμα — passed in from HistoryList so it is the same handler, not a second one. The
  sheet also shows the one line the live sheet cannot: how the task ended.

**Two pre-existing bugs fixed on the way, neither of them asked for**
- `TaskRecord` never carried `completed_at`, so `response_model` stripped it and
  `taskHistory.js` — which has read it since 2026-09-04 — saw `undefined` on every row. **Every
  completed task in the History screen has been dated by its CREATION time** and flagged as a
  completion from before the column existed. Both columns are now on the model.
- Same shape, same screen: `completed_source` never reached the browser either, so
  HistoryList's «· από το AI» suffix has never once rendered.

**And the tail that fixing them exposed, 2026-09-19.** Surfacing `completed_source` made a
four-week-old label visible for the first time — and in a shared room it was a lie. The owner
found it within a day: «στην ιστορια λεει by you οχι ο χ εκλεισε». That suffix reads the
CHANNEL, not the person, and «από εσένα» was written when the app had one user.
`utils/taskHistory.completionCredit` now names the PERSON where `completed_by` has one (over
`agent` too — telling the agent to close a task is a person closing it) and the CHANNEL where
it does not: «από την εφαρμογή», never a guessed "you". It lives in `utils/` because
`scripts/*.test.mjs` cannot import a `.jsx`, which is exactly how the old one went four weeks
without anybody noticing it had stopped being true. A departed member gets «από πρώην μέλος»
rather than a name-shaped hole, on the task row too.

## Baselines, as the commands actually printed them today

```
./venv/Scripts/python.exe -m pytest tests/ -q     → 545 passed in 4.91s   (exit 0)
                                                    was 522 before this work
cd frontend && npm run check                      → exit 0, 334 PASS, 0 FAIL
cd frontend && npm run build                      → exit 0, 338 modules, built in 407ms
cd frontend && npx eslint .                       → exit 1, 12 errors
```

**The 12 lint errors are all pre-existing and none is in code written today**: `public/sw.js`
(6), `App.jsx:213`, `api.js:82/167/205`, `SettingsModal.jsx:603`, `TodayView.jsx:69` — the last
three files' errors are `set-state-in-effect` in effects that were not touched. `npm run lint`
is not part of `npm run check`, which is this project's declared gate.

`npm run build` was run **because `npm run check` does not compile the components** — the
`scripts/*.test.mjs` suite imports `src/utils/*` only, so a broken `.jsx` would pass it
silently. That is the only reason there is evidence the screen still builds.

## What a person has actually SEEN

**The migration landing, and nothing else.** Its effect was read back out of the live database
(the numbers above) — so the columns exist, carry their defaults, and touched no existing row.
That is a real measurement and it is the only one. **Not one line of the FEATURE has been
looked at in a browser**, by anybody, in any account.

## What nobody has watched, and what would settle it

1. **The whole feature, end to end.** Two accounts, a shared workspace, one closes the other's
   task. Settles: does the strip appear, does OK remove the row, does the other person's list
   clear immediately.
2. ~~The migration itself.~~ **DONE 2026-09-18** — numbers above.
3. **That no old task comes back.** The first list load after the deploy is the test: all 376
   already-completed tasks carry `completed_by = NULL` and must stay gone. The counts say they
   should; nobody has opened the app to confirm the list looks the same as yesterday.
4. **The History screen's dates.** They CHANGE with this deploy: **219 of the 376 completed
   tasks** have a real `completed_at` and will move from their creation date to their true
   completion date, and the «· από την εφαρμογή / από το AI» suffix starts appearing. The other
   157 were completed before 2026-08-13, have no timestamp, and correctly keep showing the
   creation date under the flag that says so. This is the fix, but it will look like a change
   he did not ask for.
5. **The activity log's two new lines** («ο Χ ολοκλήρωσε το Υ»). These are in the OTHER
   «Ιστορικό» — the activity list inside a workspace's **Μέλη** panel, not Browse's History
   tab. Both screens WERE literally called «Ιστορικό»
   (`activity.title` and `browse.tab_history`), which is what made the owner read one claim
   about the other; on his word («ναι κανε το Δραστηριότητα») the workspace panel is now
   **«Δραστηριότητα»** and Browse keeps «Ιστορικό». Note the log is NOT retroactive: only
   completions made after the 2026-09-18 deploy appear there.
6. **The corrected History credit line** — «από τον/την Μαρία» on a task a colleague closed,
   «από την εφαρμογή» on the older ones.
7. **The avatar now showing on untaken tasks** in a shared room — a face appears on rows that
   had none.
8. **The notice itself**, and both its buttons. The DESIGN was seen and chosen by the owner as
   a rendered page; the React version of it has never been on a screen. Ξανάνοιγμα in
   particular has no test of its own — it reuses the existing uncomplete action, which is
   covered, but nothing proves the button is wired to it.
9. **Completed rows in the Calendar**, which should stop showing the swipe tray through
   themselves. That bleed predates all of this work.
10. **The read-only sheet, in every one of its four kinds** — completed, deleted, missed,
    rejected. A missed occurrence is the one with no footer button, and nothing has confirmed
    the sheet looks right with an empty footer bar.

## Carried forward, still unwatched from earlier work

- A real Hostaway guest message arriving since escalation was rekeyed onto `system_key`.
- The 2026-09-13 task-row rebuild: nobody has looked at it on a phone.
