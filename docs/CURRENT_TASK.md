ACTIVE TASK — The agent moved out of the top bar and became a standing field above the tabs. Pushed, NOT yet seen on a phone
_Overwrite this whole file when a new task starts. Keep the "ACTIVE TASK —" first line exact (cold-start anchor)._

> **ONE COMMIT PUSHED TO MAIN, `10e2b5d`, AUTO-DEPLOYED.**
> 11 files, +226 −31. New file: `frontend/src/components/AskBar.jsx`.
> Phone layout only — the desktop layout is byte-for-byte unchanged in behaviour.
>
> The previous task (the Hostaway audit, `a591050` → `9c73a69`) is **finished** and lives in
> git and in PROJECT_STATUS.md. Nothing here supersedes it. Its five unwatched items are
> still unwatched; they were not touched by this work.

## What was asked

2026-09-21, opening words:

> «ελα να κανουμε ένα Γρήγορο Θέλω στο Κινητό Ui να αλλαξουμε κάτι. Πρώτα θα κανουμε ενα
> μικρο brainstrom μετα θα το φτιάηεις σε html να το δω και να διαλεξω και τελος προχωράμε»

Asked which part of the phone screen, he named two:

> «θελω την κατω μπάρα και επίσης το που ειναι το συνεφακι του agend που γραφεις ask»

Asked what actually bothered him — the WHY, not the fix — he chose one of four offered
reasons, and it is the sentence the whole change is built on:

> **«Δεν ξεχωρίζει — είναι το κύριο πράγμα»**

Not "I can't find it". The agent is the reason this app exists and it was drawn as the
least important control on the screen.

## His decisions, in his words

**Do the UX research rather than be asked to choose blind.** Offered three options for
what happens to the «+» button, he refused all three and asked for a recommendation:

> «κανε ερευνα σε ux και προτεινε»

**He rejected the entire first round** — a fifth centre tab, the docked field, an extended
labelled pill — and proposed a fourth placement himself:

> «κανενα δε μου αρεσε ισως να παει αριστερα απεναντι απο το + ??»

**The «+» keeps its size and its colour**, asked while the corner layouts were on screen:

> «Μένει όπως είναι»

**Then he came back to the docked field he had rejected, with one change.** He quoted the
whole section back and ended it:

> «αυτο τελικα μου αρεσε απλα λιγο ποιο διακριτικο και λεπτο»

**Of the three weights drawn for "thinner", he took the middle one:**

> «β2»

**The microphone must do what it says**, choosing the larger of three scopes — which is
what added dictation to the agent chat, a thing that did not exist at all:

> «Μπες και στη συνομιλία»

**Hide-on-scroll: not now, and not forgotten.**

> «το 1 και βλεπουμε κρατα ανοιχτη την αποφαση σασν να δουμε στο μελλον τι θα το
> κανου,ε καντα ανεβασε τα και τα docs να κλεισω»

Parked deliberately, written into BACKLOG.md rather than dropped.

## What changed, where

**`components/AskBar.jsx` (new)** — the standing field. 36px tall, hairline border, the
page's own background behind it, a brand-red chat glyph, the placeholder «Ρώτα με ό,τι
θες…», and a microphone. 49px in total. It is **not an `<input>`**: tapping it opens
`AgentChatModal`, which owns the real conversation. Two live text fields for one
conversation would mean two drafts to keep in sync.

**`App.jsx`** — the phone's bottom is now **one fixed dock with two floors**: `AskBar`
sitting on `BottomNav`. `openAgent({dictate})` / `closeAgent()` replace the two bare
`setIsAgentOpen` calls, so the microphone's request to start listening cannot leak into a
later opening that nobody asked to be voice. `<main>` clearance `pb-48` → `pb-56`.

**`components/BottomNav.jsx`** — gave up its own `fixed bottom-0`; it is the dock's lower
floor now. `pb-safe` stays on it, because it is still the element touching the bottom edge.

**`components/AppBar.jsx`** — new `showAgent` prop, passed `isDesktop`. The Ask button
survives ONLY on the desktop layout, where it is the only door to the agent.

**`components/AgentChatModal.jsx`** — gained dictation, which it had never had, and an
`autoDictate` prop. The transcript lands in the input and is **never sent on its own**.

**`components/DictateButton.jsx`** — new `autoStart` prop, guarded by a ref so a re-render
can never reopen the recogniser under someone who has deliberately stopped it.

**`components/FloatingActionButtons.jsx`** and **`components/VoiceButton.jsx`** — both
climbed to clear the taller dock, via two named offsets in `index.css` so they cannot drift
apart. At the old offset the «+» sat directly on the ask field.

**`index.css`** — `.bottom-safe-dock` and `.bottom-safe-rec`, both commented with what they
are measuring.

**`locales/el.json` / `en.json`** — `agent.bar_placeholder`, `agent.ask_by_voice`.

## A bug fixed on the way past

`VoiceButton`'s recording indicator was pinned with a bare `bottom-44`, ignoring the
home-indicator inset (`env(safe-area-inset-bottom)`) that every other pinned element on
that screen respects — and that `index.css` says in so many words must be used. It had to
move anyway; it now moves to a class that handles the inset.

## Baselines — actual command output, 2026-09-21, after the push

```
npm run check   → EXIT=0
                  ui-check: OK — 94 files, 46 tokens, 546 translation keys
                  all passed (18 suites)
npm run build   → ✓ 339 modules transformed, built in 492ms, no warnings
npm run lint    → ✖ 12 problems (12 errors, 0 warnings)
```

**The 12 lint errors are pre-existing and none are in the files touched here.** That is not
an assumption: the working tree was stashed, `npm run lint` re-run on the unchanged tree,
and it produced **the same 12**. They live in `App.jsx:250`, `SettingsModal.jsx:603`,
`TodayView.jsx:69` (setState-in-effect), `api.js` (three `preserve-caught-error`), and
`sw.js` (`clients` undefined, unused vars). Cleaning them is separate work nobody has asked
for.

**`npm run check` alone is not proof for this task.** It does not compile JSX — a broken
component passes it silently — which is why `npm run build` is quoted above beside it.

## What a person has actually SEEN

- Nothing of this, in the real app.
- The four HTML mock-ups were seen and judged by the owner, on his own phone, and that is
  what drove every choice above. **A mock-up is not the app**: it used the real tokens from
  `index.css` at the real sizes, but it had no Suspense boundary, no lazy chunk, no keyboard
  opening over it, and no microphone permission prompt.

## What NOBODY has watched — the whole of it

1. **The ask bar on a real phone.** Whether 49px is what it looked like in the mock-up, and
   whether the hairline border holds up in dark mode on a real screen — the owner was
   explicitly warned about that one and chose Β2 anyway. Settles it: open the app on his
   phone in both themes.
2. **The microphone path, end to end.** Tap the mic on the bar → the agent chat opens →
   it is already listening. This is the highest-risk item here, for a mechanical reason:
   `AgentChatModal` is lazily loaded, so the first ever tap fetches a 129 kB chunk before
   the component mounts and `start()` runs. Chrome's `SpeechRecognition` does not require a
   transient user gesture, so this SHOULD be fine — but "should" is the word, and nobody has
   watched it. Settles it: tap the mic, twice (cold chunk, then warm).
3. **Dictation inside the agent chat at all.** It is new. The transcript anchoring
   (speaking adds to a half-typed question instead of wiping it) is copied from
   `TaskDetailSheet`, where it works, but it has not been run here.
4. **The two climbed controls.** That the «+» and the recording indicator clear the dock
   and each other on a real device with a home indicator. Arithmetic says 13px and 16px of
   gap; arithmetic is not a screenshot.
5. **Whether losing 49px of list is actually felt.** The mock-up showed five identical tasks
   in every variant so the cost was visible. On his real list, with his real task lengths,
   it may read differently.
6. **The desktop layout.** It should be unchanged — `showAgent={isDesktop}` keeps the Ask
   button there and no dock is rendered above 1024px — but "should be unchanged" is exactly
   the claim that deserves one look at a wide window.
