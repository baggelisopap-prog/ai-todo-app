ACTIVE TASK — Close out the agent tools overhaul: three known gaps
_Overwrite this whole file when a new task starts. Keep the "ACTIVE TASK —" first line exact (cold-start anchor)._

## Context
The 2026-08-06/07 agent overhaul is merged and live (`fb29be5`, `5fe6e81`; rollback tag `pre-agent-overhaul`, branch `AGENT-OVERHAUL-tools-not-prompt` retained). It is measured and working — see PROJECT_STATUS.md's "Agent tools overhaul" entry for the full before/after, and DECISIONS.md for why each rule moved from the instruction into the code. Three things are genuinely unfinished, listed below in the order they matter.

The overhaul's real lesson, worth keeping in view while doing anything below: **a rule the model has to remember is weaker than a tool that cannot be used wrongly.** The one prose change that DID work stated the required output shape (write every parameter, nulls included) rather than forbidding a wrong one.

## Gap 1 — the SearchTrace UI has never been seen running
`AgentChatModal.jsx` renders a muted "Έψαξα: … · N βρέθηκαν" line under every assistant reply from the `searches` array on `/agent/query`. The backend data is confirmed correct (checked in a live response), the frontend builds clean, ESLint passes, and the translations exist in both locales — but nobody has opened the chat and looked at it. Unknown: whether it reads as noise on mobile, whether long filter lists wrap badly, whether it should be collapsed by default.
**To verify**: open the chat logged in, ask "τι έχω αύριο;" (one search, dates only), "τα επαγγελματικά μου" (category only) and "τι έχω σήμερα;" (NO search at all — the trace should be absent, not empty). Check both EN and EL.

## Gap 2 — `relaxed_matches` has never fired in a live run
When a multi-filter `search_tasks` returns 0, `over_filtered_hint` now also returns `relaxed_matches`: the rows the same search finds with filters relaxed, so "you have none" cannot be reported over a self-narrowed result. It is verified by local tests only. It never triggered in 29 live questions **because the explicit-null FILTERS examples stopped the over-filtering that would trigger it** — good news for the product, but it means the fallback is untested against a real model.
**To verify**: force it. Ask something whose filters genuinely conflict with the data (e.g. ask for a Business task on a day that only has Personal ones) and confirm the agent answers from `relaxed_matches` in the SAME round rather than searching again.

## Gap 3 — an English question is answered in Greek
Reproduced twice ("What do I have today?" → Greek answer), in both the before and after suites, so it is stable and not a fluke. Untouched so far. The "Always answer in the SAME LANGUAGE as the question" rule is the LAST line of a ~7.8k-character instruction, which is the most likely cause.
**Candidate fix**: move it up next to the agent's identity in the opening lines, where the model's persona is set, rather than leaving it as a trailing afterthought. Cheap to try; re-test with `#label`-tagged English questions and read the rows back from `agent_runs`.

## How to verify anything here (reusable method)
Ask the question prefixed with a tag (`#g3a What do I have today?`). The tag is stripped before the model sees it and never appears in the answer. Then pull the row back out of `agent_runs` by `test_label` and read `first_turn_text`, `rounds_detail` (every tool call's name/args/result), `history_messages`, `refs`, `outcome`. This works whether the question was asked through the real UI or by calling `ask_agent()` in-process; only UI-specific behaviour (Gap 1, modal lifecycle) actually requires being logged in.
For a full regression pass, the 29-question suite and its 20-task dataset are described in PROJECT_STATUS.md; the previous runs are in `agent_runs` under `test_label` starting `u` (before) and `w` (after), so a third run can be compared against both.

## Still open from before this overhaul (unchanged)
- **Day view + conversation memory were never verified through the real logged-in UI.** The mechanisms are confirmed working in-process, but the original `#dv1`..`#dv13` and `#m1`..`#m8` checklists (two-account isolation, stale-state, refs-over-5, prompt injection, modal lifecycle) were never run logged in. The checklists are preserved in PROJECT_STATUS.md.
- **`get_tasks_for_user` loads every task ever** — measured 109 rows fetched to use 8 open ones. Not a token cost (filtering is in Python) but unbounded DB egress + latency on every agent call. This got slightly more relevant: `search_tasks` now scans the list up to three times per call (exact → word-level → stems, plus a completed retry), all in memory and microseconds, but on a much larger list it would stop being free.
- **Retry accounting gap**: if an attempt fails *after* the model generated, Google billed but `token_usage_log` never counted it. No overall request timeout either (backoff up to 3s/round × 4 rounds).
- **`no_matches_hint` only fires when a date filter is present** — a keyword-only search that finds nothing gets no hint. Partly mitigated now (`over_filtered_hint` covers multi-filter cases, and the word/stem fallbacks mean a keyword miss is more likely to be genuine), but the gap itself is unchanged.
- Agent writes Phase 2 (delete + calendar ops) — see BACKLOG.md. Note a bulk-delete tool would want ONE proposal covering many tasks, not one card per task.
- Older diagnostics: rows where `thinking_tokens` and implied thinking disagree; whether four `agent_query` calls within 8 seconds on 2026-07-25 were manual tests or duplicate frontend requests.
