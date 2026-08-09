# Integrations — research, ranking, and where the money is

**Date**: 2026-08-09 · **Status**: research, nothing started · **Scope**: candidates for future work

> **Revised the same day, after the audience decision changed.** The first version of this document recorded "general users and small businesses, explicitly NOT property managers", and on that basis put Hostaway and everything near it into a side section as the owner's private tooling. That was overturned: property managers are now a **first-class audience**, alongside the other two. §1.1 keeps the original reasoning visible because the change is the interesting part — a whole ranking moved on one decision, and it is worth being able to see how far.

This is not a plan and not a commitment. It ranks every integration worth considering, goes deep on the ones that survive, and says plainly which to refuse. Two sections carry most of the value: **§5, the property-manager segment**, and **§8, where the paid line goes**.

Prices and API terms were checked on 2026-08-09 and are the kind of fact that rots. Re-check before committing money.

---

## 1. Decisions taken before researching

### 1.1 Three audiences, and one of them was nearly thrown away
The app now targets **general productivity users, small businesses and freelancers, and property managers** — with the third treated as a serious market rather than a hobby.

The first version of this research ruled property managers out. The reasoning was not stupid: a niche audience narrows the market, and the app's Hostaway integration existed to serve one business — the owner's. On that reading, Hostaway was an accident of who built the app rather than a direction.

**What that reading missed** is that it is the only place the app has *already won something*. It has a working inbound integration with a real PMS, in a market whose defining complaint (§5.1) is precisely the problem this app is shaped like. Ruling it out meant discarding the one segment where the product is not another to-do list.

The consequence for everything below: **the ranking is now split.** Horizontal integrations (§4) serve all three audiences. Vertical ones (§5) serve property managers and are, per unit of work, worth considerably more money.

### 1.2 Commercial value means two things
What strengthens the owner's own rental business, and what a stranger would pay for. Where they diverge, this says which is which. For the property-manager segment they now largely converge, which is exactly why the segment is attractive.

---

## 2. What the horizontal research says

### 2.1 The competition already charges for what this app gives away
The most useful finding, and it is about pricing rather than integrations.

- **Todoist Pro** — $5/month billed annually. Behind that line: **reminders**, attachments, 300 projects instead of 5, advanced filters, and **email-to-task forwarding**, explicitly unavailable on free.
- **TickTick Premium** — $35.99/year (~$3/month). Behind that line: **two-way calendar sync** with Google, Outlook and Apple, and more than 9 lists.

This app gives away, free: per-task reminders, a daily summary, and two-way Google Calendar sync. Two competitors independently concluded those are what people pay for. The free tier is already more generous than the market's — that is headroom, and any pricing conversation should start from it.

### 2.2 Email is where work arrives
Todoist's own docs describe forwarding to a per-project address — subject becomes the task, body becomes an attachment — and call it one of the most used features inherited from Wunderlist and OmniFocus. Secondary sources citing McKinsey put professionals at roughly **28% of the working week in email**; treat the figure as indicative, not precise.

The app's identity is *capture by any means* — text, voice, photo, all through AI extraction. Email is the one channel it lacks and the one where work actually arrives.

### 2.3 WhatsApp is far cheaper than its reputation, for this use
Meta moved to **per-message billing on 1 July 2025**.

- When **the user messages first**, a 24-hour window opens in which replies are free.
- Meta gives **1,000 free service conversations per month** per Business Account.
- The expensive category is *marketing* (~$0.025/message on the January 2026 card, plus a provider markup of ~$0.003–$0.010). Utility and authentication run roughly 80–90% lower.

Capture is user-initiated by definition, which is the free direction. Cost appears only if the app starts *pushing* reminders over WhatsApp — a different feature that should be priced separately in the head before it is built. The real cost is the **provider, business verification and dedicated number**: setup, not usage.

### 2.4 Native for the few, Zapier for the tail
The consistent advice is 80/20: native for the mission-critical handful, Zapier for the long tail. A Zapier connector is quoted at roughly **two months**. The argument against leading with it: many users have never heard of it, and those who have must pay for it themselves — so it is an integration a portion of your users cannot actually use.

### 2.5 The share sheet is nearly free, on Android only
The **Web Share Target API** registers an installed PWA in the OS share menu via a `share_target` manifest entry. **Android through Chrome; not iOS.** A manifest change plus a handler route.

---

## 3. What this app already has, and what that makes cheap

Verified against `main.py` and the frontend on 2026-08-09.

| Already built | What it gives the next integration |
| --- | --- |
| **Google Calendar**, two-way, own OAuth refresh (`google_calendar.py`) | A working model for "connect an account, hold a refresh token, sync both ways". A second calendar is a re-implementation, not an invention. |
| **Hostaway webhook** — inbound third-party messages classified into tasks | The exact shape every integration in §4 and §5 needs: text arrives from outside → AI decides if it is work → it becomes a pending task. |
| **`/extract`, `/extract-voice`, `/extract-image`** | Any channel producing text, audio or an image already has its AI pipeline. |
| **Web Push (VAPID)**, per user | Outbound delivery exists. |
| **Approval queue** (`approval_status`, the Inbox) | Every inbound integration has a safe landing place. Nothing external becomes a live task unattended — which is also the injection defence. |
| **Token accounting** (`token_tracker.py`, `/dev/token-usage`) | Per-user AI cost is measurable, which is the prerequisite for pricing on AI volume (§8). |
| **PWA + service worker**, no `share_target` yet | The share sheet is a manifest entry away. |

**The expensive parts are built. What most integrations still need is a door.**

---

## 4. Horizontal catalogue — serves all three audiences

| # | Integration | Value | Cost | Risk | Verdict |
| --- | --- | --- | --- | --- | --- |
| H1 | **Email → task** (forward to a unique address) | High — every audience; a paid feature at Todoist | Low-Med — inbound-mail provider + one endpoint; reuses `/extract` | Spam to a semi-public address | **Build** |
| H2 | **Android share sheet** (`share_target`) | Med-High — capture from any app | Very low | Android/Chrome only | **Build** |
| H3 | **WhatsApp → task** | High — huge in Greece; suits voice capture | Med — provider, verified number, webhook; usage near free | Meta policy, verification friction | **Build, after a Telegram rehearsal** |
| H4 | **Outlook / Microsoft 365 calendar** | Med-High — small business skews Microsoft | Med — needs a calendar abstraction first | OAuth review | Later |
| H5 | **Telegram bot** | Low-Med on its own | Low — an afternoon | Low | **Build as the rehearsal for H3** |
| H6 | **Zapier connector** | Med — long tail in one move | High — ~2 months | Users pay for Zapier themselves | Later |
| H7 | **Slack / Teams** | Med for teams, ~zero today | Med | Presumes a team product | Not yet |
| H8 | **Apple Calendar / CalDAV** | Med | Med-High | Ecosystem quirks | After H4 |
| H9 | **Siri Shortcuts / Assistant** | Med — voice is already the identity | High — needs the native wrapper | Blocked on packaging | After packaging |
| H10 | **Notion / Sheets export** | Low-Med | Low | Low | Cheap filler, no pull |
| H11 | **CRM (HubSpot, Pipedrive)** | Low | Med | Most of this audience has no CRM | No |
| H12 | **Accounting (QuickBooks, Xero)** | Low | High | Wrong job | No |

### 4.1 Depth: Email → task
Every user gets an address like `u-<token>@in.<domain>`. Anything sent there lands in the Inbox as a pending task, extracted by the same AI that handles typed capture. An inbound-parse provider (Postmark, Mailgun, SendGrid all do this) posts the parsed message to a new endpoint.

**The parts that will bite.** The address is effectively public once used, so it needs a **non-guessable per-user token**, revocable from Settings, and a rate limit. **Sender allow-listing** should default to the account's own address, with an explicit "accept from anyone" switch. Email bodies carry quoted history, signatures and legal footers — the extraction prompt must be told to ignore them or every task acquires a disclaimer. And untrusted text reaching an LLM is the injection surface the project already reasoned about for Hostaway: **the rule is unchanged** — data, not instructions; lands pending; a human approves.

### 4.2 Depth: Android share sheet
The cheapest item in this document. It converts the app from "somewhere you type tasks" into "somewhere you send things", and compounds with everything else: any app that can share can now feed this one. **Android with Chrome only** — iOS needs the native wrapper already parked in BACKLOG.md. Ship it as an Android capability, not an announcement.

### 4.3 Depth: WhatsApp, rehearsed on Telegram
A business number; you send it a message or a voice note; it becomes a pending task. Voice is the point — the app already transcribes audio and a voice note is the fastest capture a phone offers.

**Build the Telegram bot first.** A token, a webhook, no verification, an afternoon. It exercises the entire path — inbound message → extraction → pending task → confirmation reply — against a real messaging platform. If the path is wrong, better to learn it before spending days on Meta's business verification. **Do not put reminders on WhatsApp in v1**: outbound is the billed direction and turns a free integration into a per-user running cost.

---

## 5. The property-manager segment

### 5.1 The pain is specific, and it is the shape of this app
From the operations research, in their own terms:

- A property in an active market runs **15–25 guest turnovers a month**, each one an inspection, a cleaning verification and a readiness deadline — often with four hours between one guest leaving and the next arriving.
- **Cleaners cancel two hours before checkout.** This is described as routine, not exceptional.
- Managers "coordinate everything through a **group text and a shared Google Sheet**".
- And the sentence that matters most: *a single reservation can trigger work in four disconnected tools — the lock app issues the code, the cleaning app assigns the turnover, a screening tool verifies the guest, a spreadsheet tracks the upsell — each with its own owner and* **no shared record connecting them**.

That last one is a description of a missing product. Not a missing PMS — they have one — a missing **personal work list that spans the tools**. Which is what this app is.

### 5.2 What this app must NOT try to be
The temptation, having read the above, is to build cleaning scheduling. **Do not.** Turno already integrates with 40+ PMSs; Breezeway syncs properties and reservations from Hostaway and is an official Airbnb software partner. Those are mature products with staff and marketplaces.

The defensible position is narrow and unoccupied: **the manager's own task list, fed by everything else.** A reservation, a guest message, a cancelled cleaning and an owner's email all become items in one list, prioritised, on a phone, in Greek or English. The app is not the system of record for any of them. It is the place the human looks.

### 5.3 The landscape, and who is worth connecting to

| Platform | Who it serves | Pricing signal | API | Why it matters here |
| --- | --- | --- | --- | --- |
| **Hostaway** | Professional managers; 200+ OTAs, deepest automation | Quote-based, expensive for small portfolios | Yes, plus a public **Marketplace** | **Already integrated.** Distribution channel via the marketplace. |
| **Hosthub** | Independent hosts and small managers | Mid | **Open API** — users, rentals, bookings | **Founded in Athens in 2017** (formerly Syncbnb). Greek company, Greek developer, Greek-speaking app. The partnership case writes itself. |
| **Smoobu** | European hosts under ~30 properties | ~$29/month | Yes | The European small-manager segment, which is this app's actual neighbourhood. |
| **Guesty** | The largest; enterprise reporting | Guesty Lite from $9/month | Yes, with a marketplace | Reach. Heaviest to satisfy; do it when there is something to show. |
| **Lodgify** | Under 10 properties, direct-booking focus | From $14/month | Yes | Third tier. |
| **OwnerRez** | US-heavy | ~$35–40/month | Yes | Wrong geography for now. |
| **Beds24** | Technical hosts | Low | Very API-friendly | Cheap to add later; small audience. |
| **Turno / Breezeway** | Cleaning and inspection ops | — | Yes | Not competitors — **sources**. "Cleaner cancelled" is a task. |

### 5.4 Vertical catalogue

| # | Integration | Value | Cost | Verdict |
| --- | --- | --- | --- | --- |
| V1 | **Reservation events → tasks** (check-in, check-out, turnover) from the PMS already connected | Very high — this is the segment's core loop | Med | **Build first in this track** |
| V2 | **Hosthub** connector | High — Greek, open API, partnership and distribution | Med | **Build second** |
| V3 | **Smoobu** connector | Med-High — European small managers | Med | Third |
| V4 | **Guesty** connector + marketplace listing | Med-High — reach | Med-High | Fourth |
| V5 | **Turno / Breezeway events** (cleaning assigned, cancelled, completed) | High — the cancelled cleaner is the emergency | Med | With or just after V1 |
| V6 | **Hostaway Marketplace listing** | Distribution, not engineering | Low-Med | As soon as V1 is real |
| V7 | **Smart locks** (Nuki, August) | Low — the lock apps handle codes | Med | No |
| V8 | **Pricing tools** (PriceLabs, Wheelhouse) | Low — pricing is not task work | Med | No |

### 5.5 The architectural decision this segment forces
Do **not** write N bespoke PMS integrations. Every one of these platforms exposes the same handful of nouns: properties, reservations, guests, messages. Write **one internal reservation-event model with a thin adapter per PMS**, exactly as §4's Outlook entry argues for a calendar abstraction.

The existing Hostaway code is the first adapter, and it should be refactored into that shape *while there is only one*, because doing it with three in place is three times the work and three times the risk. This is the single most consequential engineering call in the document, and it is invisible from the outside — which is why it needs to be a decision rather than a discovery.

### 5.6 Distribution, which matters more than the code
Hostaway and Guesty both run **marketplaces**. A listing puts the app in front of exactly the audience described in §5.1, at zero acquisition cost, with the PMS's own credibility attached. Hosthub, being Greek and smaller, is the most likely to say yes to a real partnership rather than a directory entry.

**Ranking integrations by engineering cost alone would get this backwards.** V6 is cheap and might be worth more than V3 and V4 combined.

---

## 6. Refused, and why

**myDATA / Greek e-invoicing.** The market timing is striking: Greece's B2B mandate reaches **every business including sole proprietors**, second phase dated 1 October 2026 with an adjustment window to year end; large businesses (>€1M 2023 revenue) were captured from February 2026. At least one advisory source reports the implementation being **postponed** — the dates are moving, and anyone acting on this must confirm with AADE, not with this document.

Still a no. Compliance means a certified provider or AADE's own tools, and issuing invoices is regulated financial infrastructure with audit obligations that a to-do app would inherit wholesale for a feature nobody chose it for. The defensible version — *remind me about invoicing deadlines* — is a task with a due date, which already works.

**CRM and accounting.** Both assume the user already runs one. Most of this audience does not; those who do are served by their existing tools.

**Slack / Teams.** Not bad, premature. It means something for a team product; this is single-user. Note that §5 may change this — a manager with cleaners is a team — but that is a product decision, not an integration.

**Cleaning scheduling, smart locks, dynamic pricing.** Occupied by mature products. See §5.2.

---

## 7. Sequencing

The two tracks are independent and compete only for time. A defensible order, cheapest-first within each:

1. **H2** Android share sheet — days, and it makes every other capture channel more valuable.
2. **H1** Email → task — the strongest horizontal candidate.
3. **V1** Reservation events → tasks — opens the vertical using the PMS already connected.
4. **V6** Hostaway Marketplace listing — distribution, as soon as V1 is demonstrable.
5. **H5 → H3** Telegram, then WhatsApp.
6. **V2** Hosthub — and the §5.5 adapter refactor lands here, whether or not anyone asks for it.
7. Everything else, re-ranked with whatever the first six taught.

**The one non-negotiable ordering constraint** is that the §5.5 refactor happens at V2, not later. It is the point where the cost of not having done it starts compounding.

---

## 8. Where the paid line goes

The most valuable output of this research is not an integration.

**This app's costs are not shaped like a to-do app's.** Todoist and TickTick have near-zero marginal cost per user, so they gate *features* — reminders, calendar sync, email forwarding — because it is the only lever they have. This app spends real money per use: every capture and every agent question is a Gemini call, already measured per user by `token_tracker.py`.

That points somewhere different:

- **Gating integrations would be copying a pricing model built for a different cost structure.** Integrations are fixed cost: build once, run for nothing. Email-to-task costs the same for ten users or ten thousand.
- **AI volume is the honest meter.** It scales with usage, it is already instrumented, and a limit on it is explicable in one sentence.
- **The free tier is already ahead of the market** (§2.1) — deliberate wedge, or the obvious first thing to move.

**The property-manager segment changes the arithmetic more than any of that.** A manager with fifteen properties running 15–25 turnovers each generates a genuinely different volume of AI work than someone tracking their shopping — and has a budget, already spending $9–40/month on a PMS before this app appears. That is the segment where **per-property or per-portfolio pricing** is normal and expected, and it is why §5 is worth more per unit of engineering than §4.

**A defensible shape:** a free tier with a monthly AI-capture allowance and every integration included; a paid personal tier that raises it; and a **separate professional tier priced per property** for the §5 segment, where the value is measured against a cancelled cleaning rather than against Todoist.

**What must exist first:** the billing and quota work already in BACKLOG.md (`profiles.monthly_token_quota` + Stripe against summed `token_usage_log`). Nothing in §4 or §5 needs it; §8 does.

---

## 9. Risks across all of it

- **Every inbound integration is an injection surface.** Email bodies, WhatsApp messages, guest messages and shared text are untrusted third-party content reaching an LLM. The existing rule covers it and must not be relaxed per-integration: data, never instructions; everything lands pending; a human approves.
- **Every inbound integration is an abuse surface.** Rate limits and revocable tokens belong in the first version.
- **Each connected account is a support obligation.** Tokens expire, providers change terms, verification lapses. Six integrations is six things that can break on a Monday for reasons unrelated to any code change.
- **The vertical segment brings real-world consequences.** A missed horizontal task is an annoyance. A missed turnover is a guest arriving at an uncleaned property and a public review. Reliability expectations are higher in §5 than anywhere else in this app's history, and that should inform how much automation is trusted to run unattended.
- **Prices and API terms rot.** Everything in §2 and §5.3 was read on 2026-08-09.

---

## Sources

- [Todoist Pricing (Morgen)](https://www.morgen.so/blog-posts/todoist-pricing) · [Todoist Pricing 2026 (alfred_)](https://get-alfred.ai/blog/todoist-pricing) · [Forward emails to Todoist (official)](https://www.todoist.com/help/articles/forward-emails-to-todoist-JPJ1V339)
- [TickTick Pricing 2026](https://checkthat.ai/brands/ticktick/pricing) · [TickTick vs Todoist 2026 (Temporal)](https://temporal.day/blog/ticktick-vs-todoist-2026)
- [WhatsApp Business API Pricing 2026 (Blueticks)](https://blueticks.co/blog/whatsapp-business-api-pricing-2026) · [Per-message costs (Uptail)](https://www.uptail.ai/blog/whatsapp-business-api-pricing-2026-what-it-costs-and-how-billing-works)
- [Zapier vs native integrations (Endgrate)](https://endgrate.com/blog/zapier-connector-or-native-integrations-a-clear-winner-for-b2b-saas-products) · [Integration strategy (McCary Group)](https://mccarygroup.com/native-zapier-custom-api-integration-strategy/)
- [Web Share Target (MDN)](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/share_target)
- [Hosthub Open API](https://www.hosthub.com/features/hosthub-api/) · [Hosthub API docs](https://www.hosthub.com/docs/api/) · [Hosthub (formerly Syncbnb) company profile](https://www.crunchbase.com/organization/syncbnb)
- [Hostaway Marketplace](https://www.hostaway.com/marketplace/) · [Guesty vs Hostaway vs Lodgify](https://www.guesty.com/blog/guesty-vs-hostaway-vs-lodgify/) · [Best STR software 2026 (Guesty)](https://www.guesty.com/blog/best-str-software-in-2026/)
- [Turno integrations](https://turno.com/integrations/) · [Connect Turno with Hostaway](https://support.hostaway.com/hc/en-us/articles/1260802680490-How-to-connect-to-Turno) · [Breezeway + Hostaway](https://www.breezeway.io/integrations/breezeway-hostaway-integrations)
- [STR maintenance and turnover operations 2026 (Oxmaint)](https://oxmaint.com/industries/property-management/short-term-rental-property-maintenance-airbnb-vacation-rental-2026) · [PM automation tools 2026 (SuiteOp)](https://suiteop.com/blog/best-property-management-automation-tools-2026)
- [Greece mandatory B2B e-invoicing (EDICOM)](https://edicomgroup.com/blog/greece-mandatory-electronic-invoice) · [Greece e-invoicing postponed (KPMG)](https://kpmg.com/us/en/taxnewsflash/news/2026/02/greece-implementation-mandatory-e-invoicing-postponed.html)
