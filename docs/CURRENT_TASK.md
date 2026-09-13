ACTIVE TASK — Settings rebuilt in four slices, pushed one at a time. ALL FOUR ARE LIVE; what remains is looking at them
_Overwrite this whole file when a new task starts. Keep the "ACTIVE TASK —" first line exact (cold-start anchor)._

> **This file was written BEFORE the code, at the owner's explicit request** — «εγραφη στα
> ντοκς οι αποφασεις ωστε αν δεν τα τελιωσω σημερα να ξερω τι εχω κανει και που ειμαστε».
>
> **CORRECTED twice the same day**: it first said "everything below the Slice 1 heading is a
> PLAN, not a report. Nothing has been built yet." Then it said slices 2–4 were still plans.
> **All four slices are built, pushed and live**: 1 `db307da`, 2 `183f32a`+`4d98297`+`b3e1a4a`,
> 3 `9145afb`, 4 `61f5e8b`. Nothing below is a plan any more. What is left is the two tables
> of things nobody has watched — which is now the whole of the remaining work.
>
> The previous task's "Still open, deliberately" and its HANDOVER section are CARRIED
> FORWARD at the bottom of this file, unchanged. Nothing in them is closed: the handover
> still needs a second person in the room and one migration run by hand, and
> `PROJECT_STATUS.md` points at it by name. What was dropped is only the filters task's
> slice-by-slice history — that lives in git (`e8cb35a`, `e4abf4f` and their parents) and in
> summary in `PROJECT_STATUS.md`.

## What was asked

The owner, 2026-09-13, opening the session:

> «θελω λιγο να βελτιωσουμε το ux ui τις καρτελας με τις ρυθμίσεις πχ για τους χωρους
> εργασίας για τα προσθετα μέλοι κτλ κάνε ερευνα πως τα εχουμε πως έχουν οι μεγαλες
> πλατφορμες ελα να κανουμε brainstorm να πειραματιστουμε και να αποφασισω πως θα
> προσωρησουμε ρωτα πριν τρεξεις κατι αμα χρειαζεσαι περισσοτερες πληροφοιρες»

Three instructions in one sentence, and all three were followed: research first, then
mockups to experiment on, then **he** decides. No code before that.

## The eight findings, shown to him before anything was proposed

Read out of the running code (`SettingsModal.jsx`, `WorkspacesView.jsx`, `MembersPanel.jsx`,
`InvitePanel.jsx`), not from memory:

1. **Three taps to see who is in a workspace** — avatar → Χώροι εργασίας → Μέλη. A fourth
   for the activity log. No face is visible before any of them.
2. **One workspace is ONE card doing six jobs** — name, colour, categories, members,
   invites, activity, archiving. Five levels of nesting: modal → screen → card →
   disclosure → disclosure.
3. **The fields do not look like fields** — the workspace name is a borderless `<input>`
   that saves `onBlur`, with nothing on screen saying either thing.
4. **Destructive actions are permanently visible** — a red «Αρχειοθέτηση» on every
   workspace row, a ✕ beside every category and every member.
5. **The confirmations are the browser's** — `window.confirm` in 8 places across the
   frontend. It cannot say what will be lost and does not carry the app's styling.
6. **Invite means "press a button, get a link"** — no role, and pending invites are visible
   only three levels deep.
7. **On desktop, Settings is still a phone** — a 448px modal capped at 85vh, while the rest
   of the app has had a sidebar shell since 1024px.
8. **Colour opens the OS colour dialog** — `<input type="color">`, a spectrum and hex codes
   for a choice that wants eight swatches.

## What the research changed, and this is the part worth keeping

Five platforms were read for their member-management screens (Notion, Slack, Linear, Trello,
Todoist). Six patterns recur. **Two of them cannot be built here today, and that was found
by reading `main.py` and `sharing.py` BEFORE drawing anything** — a button that always fails
is worse than no button, the same rule the locked Hostaway category already follows:

- **Invite by email is impossible.** There is no mail-sending service in this app; the
  verification emails are sent by Supabase on its own behalf, not by us. Drawn faded in the
  mockup with a «δεν υπάρχει» badge rather than drawn working.
- **A role dropdown has nothing to select.** There are exactly two roles (`owner`,
  `member`) and **no route that changes an existing member's role** — `PATCH
  /workspaces/{id}/members/me` only carries `notify_all`. So the role is a LABEL in the
  mockup, not a control. Making it a control needs a third role AND a new endpoint.
- **Two things come free.** `GET /workspaces/{id}/members` already returns `email` and
  `joined_at` for every member and **nothing displays either**. `sharing.create_invite`
  already takes a `role` argument the HTTP route does not expose.

## The decisions, and they were his

1. **All eight, not a subset** — «ολα θα τα φτιαξουμε». Deliberately different from
   2026-09-12, where he was shown six findings and picked two. The reason it is safe to say
   yes to all eight here is decision 3.
2. **The shape is approved** — «για αρχη ναι με πειθει». A list of workspaces that shows the
   faces without opening anything, and inside each workspace three tabs: Γενικά /
   Κατηγορίες / Μέλη. Desktop is the same structure opened out, not a second design.
3. **One push per slice, and the slice is looked at first** — «θα κανουμε πουσκ ενα ενα οχι
   ολα μαζι το 1 αν μας αρεσει πουσ αν οχι συνεχεια μεχρι να μας αρεσει και ουτο
   κααθεξεις». This is the decision that makes "all eight" affordable: nothing accumulates
   unseen, and each slice is iterated until he likes it **before** it is pushed.
4. **The order is 1 → 2 → 3 → 4** as proposed — «παμε με την σειρα».
5. **The docs are written before the code**, not after — see the note at the top.

## The four slices

| # | What | Findings | Touches |
|---|---|---|---|
| 1 | ~~The workspace gets its own screen~~ — **SHIPPED `db307da`, live** | 1, 2 | frontend only, no schema change |
| 2 | ~~Actions that do not frighten~~ — **SHIPPED `183f32a`, live** | 3, 4, 5, 8 | frontend only, reached the task ⋯ menu too |
| 3 | ~~Members and invites in the open~~ — **SHIPPED `9145afb`, live** | 6 | frontend only, needs a second person to check |
| 4 | ~~Desktop gets its page~~ — **SHIPPED `61f5e8b`, live** | 7 | frontend only, the largest slice |

**Why 2 before 3**: slice 2 builds the PARTS — the ⋯ menu, the confirm dialog, the labelled
field — that slice 3 then uses. Reversed, the members screen gets written twice.

## The two questions that were open, and how they closed

Both were answered by events rather than by being asked again:

- **Does he use the desktop enough to justify slice 4?** Yes — he was looking at Settings on
  a desktop when he asked why nothing had changed there, which is what moved slice 4 from
  "maybe drop it" to "build it".
- **Do we go looking for a mail service?** Never answered, and slice 3 shipped without one.
  The invite stays link-only, which already works, and the disabled email field was kept OUT
  of the UI rather than going in dead. Still open if he ever wants it.

## Slice 1 — SHIPPED `db307da`, pushed to `main` and live

`WorkspacesView.jsx` (323 lines) rendered every workspace, its categories, its members
panel, its invite panel, its activity panel and the archive section in one scrolling
column. It is now two screens:

- **The list.** One row per workspace: colour, name, a subtitle counting its categories and
  saying whether it is the default, and an avatar stack of its members on the right —
  **the faces move to where they answer the question without a tap**. Below it, «Νέος χώρος»
  and an «Αρχειοθετημένοι» row carrying its count.
- **The workspace.** Header with the colour, the name and a ⋯, then three tabs. Γενικά holds
  the name, the colour and the default switch. Κατηγορίες holds the rows. Μέλη holds what
  `MembersPanel` holds today, no longer collapsed inside a card.

What slice 1 does NOT do, on purpose: the ⋯ menu, the confirm dialogs, the colour palette
and the invite dialog are slice 2 and 3. Slice 1 moves things; it does not restyle the
controls. **One exception**, taken deliberately: the workspace name got its label and
border, because a tab holding a borderless input would have read as unfinished while that
markup was being written anyway.

**The avatar stack's cost, which was flagged as an open question, turned out to be zero.**
`MembersPanel` fetches only when opened, precisely so a list of workspaces does not become
one members request per workspace. But `MembersProvider` ALREADY holds the members of every
shared workspace — fetched once for the avatars on task rows — and `member_count` already
rides along with the workspaces themselves. So the list reads what was on hand: no new
request, and a solo account (where `member_count` is 1) fetches nothing and draws nothing,
the same rule every other piece of people-UI in this app follows.

**One behaviour change rode along**: the default workspace moved from a `CustomSelect` at
the top of the list to a `Switch` on the workspace itself, with a badge on the list row. Its
two positions are the picker's own two answers — this workspace, or `null`, which has always
meant «Ακατάτακτες». Nothing new is representable; what changed is that setting it now
happens where the workspace lives.

**`SettingsModal` went two levels deep**, and the comment saying it never would was
corrected in place rather than deleted: it claimed "two screens deep is already more than
this amount of settings justifies". The reason it went deeper was never the amount of
settings — it is that one workspace holds three unrelated jobs. It is still not a general
navigation stack (exactly one screen may have a child, addressed by id, and Back is two
explicit cases), which is the part that comment was right about.

## What a person has actually SEEN of slice 1

**The owner opened it, on a desktop, against a local backend and his real Supabase data**
(`npm run dev` + `uvicorn main:app --port 8000`), and then authorised the push. So it
renders, it does not crash, and he was satisfied enough to ship it.

**That is the whole of it, and it is less than the checklist below asked for.** He did not
report the items one by one; what he reported was a question about the DESKTOP — «εκανες
και τις αλλαγες και στο περιβαλλον για ταμπλετ υπολογιστη γτ δεν βλεπω κατι εδω» — which
was answered rather than fixed, because two different things are called «Χώροι εργασίας» on
a wide screen: the SideNav section (the FILTER — which room am I looking at, untouched by
this slice and correctly so) and Settings → Χώροι εργασίας (the MANAGEMENT, which is what
changed). The full-page desktop Settings is slice 4 and he chose to leave it there:
«οχι αστο για οτανειναι».

## What nobody has confirmed, and what would settle each

| Not confirmed | What would settle it |
|---|---|
| The list showing faces | Open Settings → Χώροι εργασίας. Business must show two avatars without any tap. **Needs a shared room** — a solo account draws none by design |
| That it did not become N requests | Network panel: opening the list must fire NO members call at all. The claim is that MembersProvider had already fetched them |
| The three tabs | Open Business, move between Γενικά / Κατηγορίες / Μέλη |
| That nothing was lost in the move | Rename, colour, add and delete a category, remove a member, invite, leave, archive + the UNDO toast, restore |
| The Hostaway category still locked | It must still show 🔒 and offer no delete |
| The default switch | Turn it on for Personal: Business must stop showing the «προεπιλογή» badge, and a task added from «Όλα» must land in Personal |

## Baselines, as the commands printed them

Before:
```
ui-check: OK — 86 files, 50 tokens, 486 translation keys
```

After slice 1:
```
npm run check   → exit 0
ui-check: OK — 87 files, 50 tokens, 497 translation keys

npm run lint    → ✖ 12 problems (12 errors, 0 warnings)     (the standing baseline, unchanged;
                  the one error inside a file this slice touched is pre-existing —
                  SettingsModal.jsx's ProfileSection effect, already in the 12)

vite build      → ✓ built in 357ms

vite dev        → all four changed modules transformed and served HTTP 200
                  (WorkspaceDetail, WorkspacesView, MembersPanel, SettingsModal)
```

After slice 2:
```
npm run check   → exit 0
ui-check: OK — 92 files, 50 tokens, 517 translation keys

npm run lint    → ✖ 12 problems (12 errors, 0 warnings)     (still the standing baseline,
                  and ZERO in any of the ten files slice 2 touched)

vite build      → clean

vite dev        → all eleven changed modules transformed and served HTTP 200
```

After slice 3:
```
npm run check   → exit 0
ui-check: OK — 92 files, 50 tokens, 522 translation keys

npm run lint    → ✖ 12 problems (12 errors, 0 warnings)     (the standing baseline, none in
                  either file slice 3 touched)

vite build      → clean
```

Backend not run: this slice touches no Python. The last backend number on record is
`505 passed in 4.79s`, from the handover below.

## Slice 2 — SHIPPED `183f32a` + `4d98297`, pushed to `main` and live

Findings 3, 4, 5 and 8. Nothing moved this time; the controls changed.

**The ⋯ menu was not written twice, and that was the decision worth making.**
`TaskMenu` already had one, and its comments are a record of two rounds of bugs — an
absolutely-positioned dropdown silently clipped by the task row's `overflow-hidden`, then a
menu opening off the bottom of the screen. The mechanism is now `KebabMenu.jsx`; `TaskMenu`
supplies only a list of items and **not one of its items changed**. Settings turned out to be
exactly the "next time something upstream gets an overflow rule" that comment predicted: the
modal body is a fixed-height scrolling box. One thing was added that the task row never
needed — Escape closes the menu, captured and stopped, so it does not travel on and close
the whole Settings modal with a menu still hanging over it.

**`window.confirm` is gone from 7 of its 8 places**, all of them in Settings: workspace
archive, category delete, member remove, leave, invite revoke, recurrence delete, delete
account. Each now has a title, the old sentence as its body, and a button that names the
action instead of saying OK. Cancel takes the focus, not the confirm button — every one of
these guards something destructive and a focused confirm turns a stray Enter into a
deletion.

**The eighth is deliberately still there**, and the owner chose it after asking the right
question — «παίζει να χαλάσει κάτι στο πρόγραμμά μας;». Deleting a task sits on four call
sites including the agent, and `window.confirm` BLOCKS, which the code around it was written
to expect. Converting it is its own change so that if it breaks, what broke it is known.

**`useConfirm` keeps the call site's shape** — `if (!(await ask({...}))) return;` — because
the alternative was seven handlers each split into a piece of state, a callback, and the
real work somewhere else. The pending `resolve` lives in a ref and is settled outside the
state updater: resolving a promise inside `setState` is a side effect in a place React runs
twice in development.

**Eight swatches replace the OS colour dialog** (`ColorSwatches.jsx` + `utils/palette.js`,
split because a module exporting a component may export nothing else without tripping
react-refresh). A colour already saved that is not one of the eight keeps its own swatch at
the front, already selected — every workspace in the live database was coloured through the
old picker, and a palette showing nothing selected reads as "no colour set" and invites a
change nobody asked for.

**Archiving became a bordered danger block** rather than a red word beside the name: the
SHAPE says "this one is different" before the colour does, which is what keeps it legible to
somebody who cannot tell red from grey — the same reasoning as the room pill's frame.

**One thing came back from him and was fixed before the push** (`4d98297`): «όταν πατάς στο
κατηγορίες, επειδή δεν έχει τίποτα, όλο το παράθυρο είναι πιο μικρό, έτσι φαίνεται άσχημο.
Θέλω να είναι όπως όλα, για ομοιομορφία». The modal is sized by its content, so a shorter
tab shrank the dialog and it jumped under the finger that had just tapped it. The panels now
have a 340px floor — a floor, not a fixed height, so fifteen categories still grow it — and
the empty categories panel took the centred shape `RecurrencesView` already uses.

**A second thing came back from him and was fixed after the push** (`b3e1a4a`). He read the
danger block and still had to ask what archiving does: «αυτο που γραφεις επικυνδυνη ζωνη
αρχειοθετηση καμια εργασια δεν χανεται και μπορεις να την επαναφερεις τι ειναι?». Two
failures in one sentence — it said what is NOT lost without ever saying what HAPPENS (the
room disappears for every member), and it sat on screen permanently, which he called «χύμα».
The block is now a title and a button with a **(!)** beside it that opens the answer: «σε
θαυμαστικό που θα ανοίγη όταν το πατάει ο χρήστης». The text was rewritten against
`sharing.archive_workspace` rather than from memory, and it now carries the one consequence
no version of it ever mentioned: **if the archived room was the default, the default moves
back to Business — for every member who had it selected.**

### What a person has actually SEEN of slice 2

He was asked to check the task ⋯ menu FIRST, because it is the one control in this slice
that was already working and therefore the only one that could have been broken. He came
back with «ολα καλα» plus the tab-height complaint above, which is itself evidence he was
inside the workspace screen moving between tabs.

**What that does and does not establish**: it is a real look by a real person at the screens
that changed, which slice 1 never got. It is NOT an itemised pass — he did not say which
menu he opened, and the height fix that followed it has not been looked at by anyone at all.

### Not confirmed for slice 2

| Not confirmed | What would settle it |
|---|---|
| The 340px floor, and the new empty panel | Open a workspace and move Γενικά → Κατηγορίες → Μέλη. The window must not change size |
| Any confirm dialog actually completing its action | Delete a category and answer the dialog. The category must go — the dialog was only ever cancelled during the look |
| Escape closing a ⋯ menu without closing Settings | Open a category's ⋯, press Escape. The menu closes, the modal stays |
| The task ⋯ menu in its harder positions | Open one on the LAST row of a long list: it must flip above the button, not open off the bottom |
| A palette choice reaching the database | Pick a colour, close Settings, reopen. It must still be that colour |
| The custom-colour swatch | Needs a workspace whose colour is not one of the eight — likely most of his |
| The (!) disclosure on the danger block | Open Γενικά, tap the (!). The explanation opens and closes, and the block does not change size enough to move the button |

## Slice 3 — SHIPPED `9145afb`, pushed to `main` and live

Finding 6. Smaller than the other two, because slice 1 had already moved the members out of
their disclosure and slice 2 had already built the dialog this one needed.

**Two fields that have been arriving since sharing shipped and were never shown.**
`GET /workspaces/{id}/members` returns `email` and `joined_at` on every row, and nothing in
the app displayed either — noted as free during the research, now spent. They are the second
line of a member row. The email is skipped when it is already the NAME: `personName` falls
back to it for somebody who never set a display name, and a row printing the same address
twice says nothing twice.

**The role moved onto a pill.** It is a property of the person, not a description of them,
and on the second line it was competing with the email for the same space. Both pills share
a background and differ only by weight, so the WORD separates them — the row still reads for
somebody who cannot tell two greys apart, the same rule the room pill's frame follows.

**A live bug fixed in passing, and it was on the owner's own row.** `members.owner` was
«· ιδιοκτήτης» — leading middle dot, lower case — while `members.member` was «Μέλος», and
the code adds its own « · » before `members.you`, which was itself «· εσύ». So the owner
looking at himself read **«· ιδιοκτήτης · · εσύ»**. The dots belonged to an older call site
where a name came first. They are out of the keys now; the separator stays in the code,
which is the only place that knows whether there is anything to separate. Both keys had
exactly one call site, so nothing else moved.

**Πρόσκληση asks before it mints.** Pressing it used to create a key on the spot — a working
seven-day pass to the whole workspace, from a tap whose label said only «Πρόσκληση». It now
opens a dialog saying what it is about to make: one use, seven days, revocable, shown once
and never readable again. It reuses slice 2's `ConfirmDialog` with `danger: false`, which is
the "why 2 before 3" ordering paying for itself exactly as predicted.

**Deliberately NOT built, although the approved mockup showed it**: the greyed-out «ή με
email» field. It earned its place in a mockup, where a faded control explains a gap. In the
real app it is a permanently dead input, and this codebase already has the rule — a control
that always fails is worse than no control, the same one the locked Hostaway category and
the missing remove-the-owner button follow. The gap stays recorded in DECISIONS.md. **The
owner was told this was a deviation from what he approved** and did not object.

### What a person has actually SEEN of slice 3

He was given three things to check — the colleague's email on her row, one middle dot rather
than three on his own, and that Πρόσκληση opens a dialog he should then cancel — and came
back with «ολα καλα». Same standing as slice 2: a real look, not an itemised report.

**Most of this slice cannot be seen alone.** A solo workspace has one member, no email worth
confirming, and no pending invitation.

### Not confirmed for slice 3

| Not confirmed | What would settle it |
|---|---|
| The second line on a REAL colleague's row | Open Business → Μέλη with Evi in it. Her email and «Μπήκε 12 Σεπ» must both be there |
| A member with no display name | Their row must show the email ONCE, as the name, with no second line repeating it |
| That the invite dialog still mints | Say yes to it. A link must appear, and the pending list must gain a row |
| The pending row's new shape | Needs a live invitation in flight |
| `joined_at` being present at all | It has never been rendered; if the server sends null for older rows the line simply will not draw, which is correct but untested |

## Slice 4 — SHIPPED `61f5e8b`, pushed to `main` and live

Finding 7, and the last one. From 1024px up Settings was still a 448px window capped at
85vh, floating in the middle of a 1920px screen, while the rest of the app has had a sidebar
shell since it shipped. It is now a page: a nav column on the left, the section on the right.

**Only the CHROME branches.** Every section is rendered by one `renderSection()` and does not
know which shape it is inside. A second Settings screen was the obvious alternative, and the
phone one would have been the half that quietly fell behind — which is the exact failure
this whole rebuild started from. The branch is `useMediaQuery(DESKTOP_QUERY)` rather than CSS
classes, for the same reason `App.jsx` branches rather than hiding: two trees rendered with
one hidden would mount every section twice, and these sections own notification permissions
and network fetches.

**Two things follow from there being no root list on a wide screen.** Language, appearance
and dictation had nowhere to live — on a phone they are rows on the root that open sheets —
so they became an «Εμφάνιση & γλώσσα» section built from the SAME rows the phone root
renders, not a second copy. And Back exists on desktop only inside a workspace, because
everywhere else the nav is already on screen.

**The owner chose the shape after it was built, and chose the one already written.** He
asked whether Settings should move into the app's own left sidebar «σαν dashboard». Shown
three options with sketches — a full-screen takeover with a Back (the Linear shape), the
centred card as built, or settings as permanent rows in the app's sidebar — he picked the
centred card. So nothing changed. The argument that decided it is in DECISIONS.md.

**Deliberately NOT built, and it was in the approved mockup**: the workspace switcher at the
top of the nav, with Γενικά / Κατηγορίες / Μέλη as workspace-scoped nav items. It is nicer
and it is a bigger change — the nav would become stateful about which room it describes, and
`WorkspaceDetail` would have to hand its tab state upward. What shipped reaches the same
screens in one more click, through the two-level navigation slice 1 already built. **He was
told it was a deviation** and left it.

### Not confirmed for slice 4 — and the phone shape is the one at risk

| Not confirmed | What would settle it |
|---|---|
| The desktop shape at all | Open Settings on a wide window. Nav on the left, section on the right |
| **The PHONE shape still working** | Narrow the window under 1024px. It must become the old drill-down list. This is the dangerous one: the phone screen was rearranged to share code with a screen it never had before |
| «Εμφάνιση & γλώσσα», which exists only on desktop | Open it, change the theme, watch it take |
| Back inside a workspace on desktop | Χώροι εργασίας → Business → ‹. The title must read «Business» and then go back to the list |
| Resizing across 1024px mid-session | The section you were on must survive the switch — `screen === 'root'` is mapped to 'profile' for exactly this |

## The mockups he approved

Read before the code, and the reason the shape above is not a guess:
claude.ai/code/artifact/32fde3e5-5b6a-4b2c-b5df-d518805a333f

The example member in them is named «Μαρία Κ.» and is **not** a real person — the real
second account is Evi, named in the handover below.

---
---

## Still open, deliberately

- **The grouped «Business › Hostaway» picker.** Promoted in BACKLOG.md the same day: with
  «Όλα» as the permanent default, the category filter is unavailable until you pick a room,
  so filtering by category costs two steps. It no longer reverses anything — the chip row it
  would have replaced is gone — but it still needs an answer to "what does a cross-workspace
  category list do when two rooms have a category with the same name?".
- **«Θα μπει στα: Business» in the add sheet.** Promised in conversation, not built, kept
  out on purpose so this slice stayed one thing. It matters more than it did: the
  destination of a new task is now a setting rather than the room you are standing in.

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

## ~~THE ONE THING WAITING ON THE OWNER'S HANDS~~ — DONE 2026-09-13

**CLOSED.** `docs/migrations/2026-09-12-lock-ai-snapshot-columns.sql` was run by the owner in
the Supabase SQL Editor on 2026-09-13, and the confirmation was read back rather than
assumed:

```
ai_suggested_category   is_nullable = NO
ai_suggested_priority   is_nullable = NO
```

It took two passes, and the reason is worth keeping: the first run executed only the count
block, because steps 2 and 3 are shipped commented out (deliberately — the ALTER must not
run before the count returns 0). Supabase skipped them as text and the owner reasonably read
`0 0 407` as success. **A migration whose later steps are commented out needs its
confirmation read, not its exit assumed** — which is why step 3 exists in the file at all.

The precondition was measured twice before the lock went on, independently: 407 tasks, 0
nulls in either column, once by the agent read-only and once by the owner.

**Verified after the lock, against the stricter schema**: `505 passed in 4.55s`, and
`tests/test_task_insert_paths.py` — the tripwire that fails the moment a third
task-creation path appears without these columns — `2 passed`.

The original note follows.

---

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
