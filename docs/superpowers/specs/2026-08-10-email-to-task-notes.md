# Email → task — brainstorm notes, parked

**Date**: 2026-08-10 · **Status**: unfinished brainstorm, nothing started, nothing committed to · **Follows**: `2026-08-09-integrations-research.md` §4.1 (H1)

This is not a design and not a plan. It is the part of the conversation worth not losing: three things the research doc got wrong or left out, one design idea that changes the feature's shape, and the questions we stopped at. Anyone picking this up should read §4.1 of the research doc first — it still holds; this corrects and extends it.

---

## 1. The mechanism: forwarding, and why the nicer options lose

The research doc assumed forwarding without arguing for it. It is the right answer, but the reasoning matters, because two alternatives look better and both hit a wall that is not obvious until you check.

| Option | Why it looks good | Why not v1 |
|---|---|---|
| **Forward to a unique address** | Works from mobile Gmail, desktop, Outlook, any client; needs nothing from Google; works from a notification without opening a browser | Needs a domain + inbound-parse provider (§3) |
| **Gmail add-on** (button in the Gmail sidebar) | One click, no forwarding, no address to remember | Apps Script project = a second codebase in a language this project does not use, plus Google review before anyone but the owner can install it |
| **App reads Gmail** (label an email `→ Tasks`, the app pulls it) | The best UX of the three, and the app already does Google OAuth for Calendar | `gmail.readonly` is a Google **restricted** scope: fine for the owner in testing mode, but shipping it to strangers requires a third-party security assessment (CASA). Real money, real delay. **Re-check before dismissing** — scope classifications change |

**Decision, provisional**: forwarding for v1. The label-based pull is a plausible later addition for power users, not a replacement.

**The flow, concretely** (the owner's own morning, used as the test case): email arrives → read it → ⋮ → Forward → Gmail autocompletes the address, saved as a contact named *Tasks* → send. ~4 taps. A push notification confirms. The task waits in the Inbox for approval.

---

## 2. The idea worth keeping: the note above the forward

When you forward, the client gives you an empty box above the quoted original. **What the user types there is worth more than the entire email underneath it.**

Forward the accountant's mail and type *"πλήρωσε μέχρι την Παρασκευή, P1"* — that line is a human stating the task in their own words, which is exactly the input `ai_engine.extract_tasks` was built for and is good at. The email below is context and paper trail.

Two consequences:

- **It maps onto a rule the project already enforces.** The typed line is an **instruction**; the forwarded body is **data**. Same split as a Hostaway guest message, same reason, no new security thinking required. A phishing body saying "ignore previous instructions" sits in the untrusted half where it belongs.
- **It is also the cost fix.** If the user typed something, the model mostly reads that. If they typed nothing, it falls back to subject + cleaned body. The expensive path is the exception, not the default.

Splitting the two halves reliably is real work — the boundary is a client-specific quoted-reply marker, not a standard — and it should be done in code, not asked of the model.

---

## 3. The prerequisite the research doc missed: there is no domain

Inbound email needs MX records on a domain the project controls. Vercel and Render cannot receive mail; `ai-todo-app-mauve.vercel.app` cannot either.

**This feature is blocked on the "Custom domain" item already sitting in BACKLOG.md**, which was written as a cosmetic nice-to-have. It is not, for this: it is a hard dependency and the first real recurring money the project spends (a domain is small — roughly €10–15/year — but it is infrastructure now owned and renewed). Provider choice (Postmark / Mailgun / SendGrid / CloudMailin all do inbound parse) was not researched; prices and free tiers rot, so check at the time.

---

## 4. The cost shape, which is not Todoist's

The single most important thing on this page. **Todoist's marginal cost per forwarded email is ~zero, so it can afford to be dumb about what arrives. This app's is a Gemini call** — on `gemini-3.5-flash`, the more expensive of the two models in use, not the flash-lite the chat agent runs on.

Two multipliers, and they stack:

- **Call count** — every email is a call, including the nine in ten that turn out not to be tasks.
- **Call size** — a Booking.com or Airbnb email is HTML: tables, inline styles, tracking pixels, a footer in six languages. Thousands of tokens carrying one useful line. The extractor has only ever been fed short typed text, voice notes, and photos. Nothing has measured it against a real email.

**The free filters, in the order they should run — all before the model:**

1. **Headers.** Bulk and machine mail announces itself: `List-Unsubscribe`, `Precedence: bulk`, `Auto-Submitted`. Newsletters and no-reply blasts can be dropped deterministically, for nothing.
2. **Sender allow-list.** Defaults to the account's own address, with an explicit "accept from anyone" switch. Costs nothing, and it is the same mechanism that protects a semi-public address from spam.
3. **Strip HTML, quoted history and signature — in code.** The research doc proposed telling the extraction prompt to ignore them. **That is the wrong layer**, and this project has learned it four times (see DECISIONS.md, "a rule the code can enforce does not belong in the system instruction"). Stripping is also the real cost lever: same email, roughly a tenth the tokens.
4. **The human.** Manual forwarding means the user already decided it was a task before it arrived. It is the best filter available and it is free — which is why manual-vs-automatic is not a UX preference but a decision about who does the deciding.

---

## 5. Pending vs pre-approved — a divergence to make on purpose

Hostaway messages land **pre-approved**: `main.py`'s webhook calls `service.create_task_manual(...)`, whose `approval_status` defaults to `True`, so a guest message goes straight to the task list (and into the escalation loop).

The research doc says email should land **pending**. That is the right call — a webhook from an authenticated integration is not an open mail address anyone can write to — but it means the app's two inbound channels behave differently. Worth stating in the design rather than discovering later.

---

## 6. Where we stopped

**The open question, asked and not answered:** when an email is forwarded **with no note** — just forward and send — what should it become?

- **(a)** One task, named from the subject line, near-verbatim. Cheap, predictable, boring, never surprising.
- **(b)** Full extraction over the cleaned body, which may yield two or three tasks, because one email from a property owner genuinely can contain three separate jobs.

The typed-note design in §2 means this is the *fallback* path, not the main one — which argues for (a) on cost grounds. Undecided.

**Never reached at all:**

- What confirms back to the user — a push notification (free, already built) or a reply email (costs an outbound send, but lands where the user already is)?
- Address format: unguessable is required, memorable is desirable, and "saved as a Gmail contact" may make memorability moot. Revocation/rotation from Settings is assumed but unspecified.
- Attachments. Todoist attaches the body as a file; this app has no file storage at all. Likely: ignore them in v1, say so out loud.
- Rate limiting per address.
- Automatic forwarding (a Gmail rule pointed at the address) — deliberately set aside to design the human path first. The filters in §4 are what would make it survivable.
