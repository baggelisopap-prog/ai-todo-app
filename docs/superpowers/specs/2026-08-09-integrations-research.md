# Integrations — research, ranking, and where the money is

**Date**: 2026-08-09 · **Status**: research, nothing started · **Scope**: candidates for future work

This is not a plan and not a commitment. It ranks every integration worth considering, goes deep on the four that survive the ranking, and says plainly which ones to refuse. The last section is the one to read if you only read one: **§8, where the paid line goes** — because integrations are only commercially interesting in relation to what people will pay for.

Prices and API terms below were checked on 2026-08-09 and are the kind of fact that rots. Re-check before committing money to any of them.

---

## 1. Decisions taken before researching

**Two audiences, chosen deliberately: the general productivity user AND small businesses / freelancers.** Not property managers. This matters more than it sounds: the app's one existing third-party integration (Hostaway) serves a market that has now been ruled out as the product direction. It stays as the owner's own tooling — §7 keeps that separate rather than letting it quietly steer the roadmap.

**Commercial value means both things at once**: what strengthens the owner's own rental business, and what would make a stranger pay. Where those pull apart, this document says which is which instead of pretending one answer serves both.

**Shape**: a ranked catalogue of everything, then depth on the few at the top.

---

## 2. What the research says

### 2.1 The competition already charges for what this app gives away
The single most useful finding, and it is about pricing rather than integrations.

- **Todoist Pro** is $5/month billed annually. Behind that line: **reminders**, file attachments, 300 projects instead of 5, advanced filters, and **email-to-task forwarding**, which is explicitly not available on the free tier.
- **TickTick Premium** is $35.99/year (~$3/month). Behind that line: **two-way calendar sync** with Google, Outlook and Apple, unlimited calendar subscriptions, and more than 9 lists.

This app currently gives away, for nothing: per-task reminders, a daily summary, and two-way Google Calendar sync. Two different competitors have independently concluded those are the features people pay for.

That is not an argument to start charging tomorrow. It is an argument that **the free tier is already more generous than the market's**, and that any pricing conversation should start from that fact rather than from a blank page.

### 2.2 Email is where work arrives, and forwarding is the standard bridge
Todoist's own documentation describes forwarding to a per-project address, subject becoming the task name, body becoming an attachment. It is described as one of the most used features inherited from Wunderlist and OmniFocus. Secondary sources citing a McKinsey figure put professionals at roughly **28% of the working week inside email** — treat the number as indicative rather than precise, but the direction is not controversial.

The relevance here is specific: this app's whole identity is *capture by any means* — text, voice, photo — passed through AI extraction. Email is the one capture channel it does not have, and it is the one where work actually shows up for the small-business audience.

### 2.3 WhatsApp is far cheaper than its reputation, for this use
Meta moved from per-conversation to **per-message billing on 1 July 2025**. The parts that matter for a task app:

- When **the user messages the business first**, a 24-hour window opens in which replies are free.
- Meta provides **1,000 free service conversations per month** per WhatsApp Business Account.
- The expensive category is *marketing* (~$0.025/message on the January 2026 rate card, plus a provider markup of roughly $0.003–$0.010). Utility and authentication templates run roughly 80–90% below that.

Capture is user-initiated by definition: someone sends a voice note or a message *to* the app. That is the free direction. The cost only appears if the app starts pushing reminders out over WhatsApp, which is a different feature and should be priced separately in the head before it is built.

The real cost of WhatsApp is not per message. It is the **Business Solution Provider, the business verification and the dedicated number** — setup, not usage.

### 2.4 Native for the few, Zapier for the tail
The consistent industry advice is an 80/20 split: build native integrations for the handful of mission-critical systems, and let Zapier cover the long tail. A Zapier connector is quoted at roughly **two months** of work.

The argument against leading with Zapier is worth recording: many users have never heard of it, and those who have must pay for it themselves — so the integration you "have" is one a portion of your users cannot actually use.

### 2.5 The share sheet is nearly free, on Android only
The **Web Share Target API** lets an installed PWA register itself in the operating system's share menu via a `share_target` entry in the manifest. It works on **Android through Chrome** and **does not work on iOS**. It is a manifest change plus a handler route.

---

## 3. What this app already has, and what that makes cheap

Verified against `main.py` and the frontend on 2026-08-09.

| Already built | What it gives the next integration |
| --- | --- |
| **Google Calendar**, two-way, with our own OAuth token refresh (`google_calendar.py`) | A working model for "connect an account, keep a refresh token, sync both directions". A second calendar provider is a re-implementation, not an invention. |
| **Hostaway webhook** — inbound third-party messages classified into tasks | The exact shape of "text arrives from outside → AI decides if it is a task → it becomes one, pending approval". Email and WhatsApp are the same pattern with a different door. |
| **`/extract`, `/extract-voice`, `/extract-image`** | Any new channel that produces text, audio or an image already has its AI pipeline. This is why email-to-task is small. |
| **Web Push (VAPID)**, per-user | Outbound notification exists; a messaging integration does not need to reinvent delivery. |
| **Approval queue** (`approval_status`, the Inbox) | Every inbound integration has a safe landing place. Nothing from outside becomes a live task unattended — which is also the injection defence. |
| **Token accounting** (`token_tracker.py`, `/dev/token-usage`) | Per-user AI cost is already measurable. That is the prerequisite for pricing anything on AI volume (§8). |
| **PWA + service worker**, no `share_target` yet | The share-sheet integration is a manifest entry away. |

The pattern to notice: **the expensive parts are built.** What remains for most inbound integrations is a door.

---

## 4. The catalogue

Value is commercial pull, not personal preference. Cost is engineering plus operations. Risk is what can go wrong that money cannot fix.

| # | Integration | Value | Cost | Risk | Verdict |
| --- | --- | --- | --- | --- | --- |
| 1 | **Email → task** (forward to a unique address) | High — both audiences; a paid feature at Todoist | Low-Med — inbound-mail provider + one endpoint; reuses `/extract` | Spam/abuse to a public address | **Build first** |
| 2 | **Android share sheet** (`share_target`) | Med-High — capture from any app | Very low — manifest + one route | Android/Chrome only | **Build** |
| 3 | **WhatsApp → task** | High — enormous in Greece; fits voice capture | Med — BSP, verified number, webhook; usage near free | Meta policy, verification friction | **Build third** |
| 4 | **Outlook / Microsoft 365 calendar** | Med-High — the other half of the market; small business skews Microsoft | Med — `google_calendar.py` is Google-shaped; needs an abstraction first | OAuth review | **Build fourth** |
| 5 | **Zapier connector** | Med — long tail in one move | High — ~2 months | Users must pay for Zapier themselves | Later |
| 6 | **Slack / Teams** | Med for teams, ~zero today | Med | The app is single-user; this presumes a team product | Not yet |
| 7 | **Apple Calendar / CalDAV** | Med | Med-High | Apple ecosystem quirks | Only after #4 |
| 8 | **Siri Shortcuts / Google Assistant** | Med — voice is already the identity | High — needs the native wrapper | Blocked on Android/iOS packaging | Revisit after packaging |
| 9 | **Notion / Google Sheets export** | Low-Med | Low | Low | Cheap filler, no pull |
| 10 | **Telegram bot** | Low-Med — trivial API, small audience here | Low | Low | Good prototype for #3 |
| 11 | **CRM (HubSpot, Pipedrive)** | Low | Med | Wrong audience — most freelancers have no CRM | No |
| 12 | **Accounting (QuickBooks, Xero)** | Low | High | Wrong job | No |
| 13 | **myDATA / e-invoicing** | Looks enormous — see §7 | Very high | Regulated financial infrastructure | **No** |

---

## 5. Depth on the four

### 5.1 Email → task
**What it is.** Every user gets an address like `u-<token>@in.<domain>`. Anything sent there lands in the Inbox as a pending task, extracted by the same AI that handles typed capture.

**Why it is first.** It is the only candidate that is simultaneously (a) wanted by both audiences, (b) proven as a *paid* feature by a competitor, and (c) nearly free to build here because `/extract` and the approval queue already exist. The new code is an inbound-mail webhook that turns a parsed email into the same call the text box already makes.

**How.** An inbound-parse provider — Postmark, Mailgun and SendGrid all do this — posts the parsed message to a new endpoint. Subject and body become the extraction input. Attachments are the obvious extension and should be left out of the first version.

**The parts that will bite.**
- The address is effectively public once used. It needs a **non-guessable per-user token**, revocable from Settings, and a rate limit. A leaked address means a stranger can fill your Inbox.
- **Sender allow-listing**: the safe default is to accept only mail from the address the account was registered with, with an explicit "accept from anyone" switch for people forwarding from several accounts.
- Email bodies carry quoted history, signatures and legal footers. The extraction prompt will need to be told to ignore them, or every task acquires a five-line disclaimer.
- Untrusted text reaching an LLM is the injection surface the project has already reasoned about for Hostaway. **The same rule applies unchanged**: it is data, it lands as pending, a human approves it.

### 5.2 Android share sheet
**What it is.** A `share_target` entry in the manifest, so the app appears in Android's Share menu. Share a message, a link, a photo → it opens the app with the content pre-loaded for capture.

**Why.** It is the cheapest item in this document by a wide margin, and it converts the app from "somewhere you type tasks" into "somewhere you send things". It also compounds with everything else: any app that can share can now feed this one.

**The honest limit.** **Android with Chrome only.** iOS does not support it, and no amount of work changes that from the web side — it needs the native wrapper already parked in BACKLOG.md. Ship it as an Android capability, not as a feature announcement.

### 5.3 WhatsApp → task
**What it is.** A business number. You send it a message or a voice note; it becomes a pending task. Voice is the point — the app already transcribes audio, and a voice note is the fastest capture a phone offers.

**Why third rather than first.** The per-use economics are excellent (§2.3) but the **setup is the cost**: a Business Solution Provider, business verification with Meta, a dedicated number that cannot be the one already on WhatsApp. That is days of paperwork before a line of code matters, and it is not reversible on a whim.

**Build Telegram first as a rehearsal.** A Telegram bot is an afternoon: a token, a webhook, no verification. It exercises the whole path — inbound message → extraction → pending task → confirmation reply — against a real messaging platform. If that path is wrong, better to learn it for free.

**Do not put reminders on WhatsApp in the first version.** Outbound business-initiated messages are the billed direction, and it turns a free integration into a per-user running cost.

### 5.4 Outlook / Microsoft 365 calendar
**What it is.** What Google Calendar already does, for the other half of the world.

**Why it is fourth despite obvious demand.** `google_calendar.py` is written against Google: its own token refresh, Google's sync tokens, Google's event shape. Adding Microsoft properly means **extracting a calendar interface first** and re-expressing the Google integration through it. That refactor is most of the work and none of the visible progress, which is exactly why it should be planned as its own piece rather than smuggled into a feature.

**Sequencing note.** Do not do this at the same time as anything else that touches calendar sync. The delete/complete/origin rules already documented in DECISIONS.md are subtle, and re-deriving them for a second provider while changing them for the first is how both end up wrong.

---

## 6. What serves the owner's business, separately

Kept apart on purpose: the audience decision rules these out as *product* direction, and mixing them into the roadmap is how a product quietly becomes a bespoke tool.

- **Hostaway** — already built, already load-bearing. Multi-tenancy is deferred to "year 2" and nothing here changes that.
- **Airbnb / Booking.com direct** — Hostaway already aggregates both. Direct integrations would duplicate what a channel manager exists to do.
- **Cleaning-team assignment / shared task lists** — real operational value for a rental business, and it is a *collaboration* feature, not an integration. If it is ever wanted, it should be argued for on its own terms.

The useful question to ask of any of these: *would a stranger pay for it?* If the answer is no, it belongs here rather than in §4.

---

## 7. Refused, and why

**myDATA / Greek e-invoicing.** The market timing is genuinely striking. Greece's B2B e-invoicing mandate reaches **every business including sole proprietors**, with the second phase dated 1 October 2026 and an adjustment window to the end of that year; large businesses (>€1M revenue in 2023) were captured from February 2026. Note that at least one advisory source reports the implementation being **postponed** — the dates are moving, and anyone acting on this must confirm them directly with AADE rather than with this document.

It is still a no. Compliance requires either a certified provider or AADE's own tools, and issuing invoices is regulated financial infrastructure with audit obligations. A to-do app that touches it inherits every one of those obligations for a feature none of its users chose it for. The nearest defensible version — *remind me about invoicing deadlines* — is a task with a due date, which the app already does without any integration at all.

**CRM and accounting integrations.** Both assume the user already runs a CRM or a ledger. The chosen audience — general users and small operators — largely does not, and the ones who do are served by their existing tools' own task features.

**Slack / Teams.** Not a bad integration; a premature one. It only means something for a team product, and this is a single-user app. Building it now would be building for a customer that does not exist yet.

---

## 8. Where the paid line goes

The most valuable output of this research is not an integration. It is this.

**This app's costs are not shaped like a normal to-do app's.** Todoist and TickTick have near-zero marginal cost per user, so they gate *features* — reminders, calendar sync, email forwarding — because that is the only lever they have. This app spends **real money per use**: every capture and every agent question is a Gemini call, already measured per user by `token_tracker.py`.

That points somewhere different:

- **Gating integrations here would be copying a pricing model built for a different cost structure.** Integrations are mostly fixed cost — build once, run for nothing. Email-to-task and the share sheet cost the same whether ten people or ten thousand use them.
- **AI volume is the honest meter.** It is the thing that actually scales with usage, it is already instrumented, and a limit on it is explicable to a user in one sentence.
- **The existing free tier is already ahead of the market** (§2.1). Reminders and two-way calendar sync are paid features at both competitors. That is headroom: it can stay free as a deliberate wedge, or it is the obvious first thing to move.

**A defensible shape, if this is ever charged for:** a free tier with a monthly AI-capture allowance and every integration included; a paid tier that raises the allowance. Integrations become the reason to arrive rather than the toll gate — which suits a product whose whole pitch is *send it anything and it becomes a task*.

**What has to exist before any of that is real:** the billing and quota work already parked in BACKLOG.md (`profiles.monthly_token_quota` + Stripe, checked against summed `token_usage_log`). Nothing in §4 requires it, but §8 does.

---

## 9. Risks that apply across all of it

- **Every inbound integration is an injection surface.** Email bodies, WhatsApp messages and shared text are all untrusted third-party content reaching an LLM. The project's existing rule already covers it and must not be relaxed per-integration: data, never instructions; everything lands pending; a human approves.
- **Every inbound integration is an abuse surface.** A public address or a bot number can be flooded. Rate limits and revocable tokens are part of the first version, not a follow-up.
- **Each connected account is a support obligation.** OAuth tokens expire, providers change terms, verification lapses. Four integrations is four things that can be broken on a Monday morning for reasons unrelated to any code change.
- **The prices and API terms in §2 rot.** Meta's rate card, Todoist's and TickTick's pricing, and the Greek mandate dates were all read on 2026-08-09.

---

## Sources

- [Todoist Pricing, Features & Limits (Morgen)](https://www.morgen.so/blog-posts/todoist-pricing) · [Todoist Pricing 2026 (alfred_)](https://get-alfred.ai/blog/todoist-pricing)
- [TickTick Pricing 2026](https://checkthat.ai/brands/ticktick/pricing) · [TickTick vs Todoist 2026 (Temporal)](https://temporal.day/blog/ticktick-vs-todoist-2026)
- [Forward emails to Todoist (official docs)](https://www.todoist.com/help/articles/forward-emails-to-todoist-JPJ1V339)
- [WhatsApp Business API Pricing 2026 (Blueticks)](https://blueticks.co/blog/whatsapp-business-api-pricing-2026) · [Per-message costs & billing (Uptail)](https://www.uptail.ai/blog/whatsapp-business-api-pricing-2026-what-it-costs-and-how-billing-works)
- [Zapier Connector or Native Integrations (Endgrate)](https://endgrate.com/blog/zapier-connector-or-native-integrations-a-clear-winner-for-b2b-saas-products) · [Native vs Zapier vs APIs (McCary Group)](https://mccarygroup.com/native-zapier-custom-api-integration-strategy/)
- [Web Share Target (MDN)](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/share_target)
- [Greece: Mandatory B2B e-Invoicing via myDATA (EDICOM)](https://edicomgroup.com/blog/greece-mandatory-electronic-invoice) · [Greece e-invoicing postponed (KPMG)](https://kpmg.com/us/en/taxnewsflash/news/2026/02/greece-implementation-mandatory-e-invoicing-postponed.html)
- [Best Task Management Software (Slack blog)](https://slack.com/blog/productivity/best-task-management-software) — source of the second-hand McKinsey email-time figure
