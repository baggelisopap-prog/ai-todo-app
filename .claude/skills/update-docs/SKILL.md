---
name: update-docs
description: Update this project's docs after work ships - which file gets what, the house rules for correcting a doc the code disagrees with, and the requirement to write down what is NOT verified. Use after a push, when the owner asks for the docs, or before handing work over.
---

# Updating the docs on this project

The owner runs a real short-let business on this app and is not a programmer.
In two months these files are the only thing that will remember **why** we did
something a particular way. Write for that reader.

Triggered automatically after a push by `.claude/hooks/docs-after-push.mjs`, and
usable any time with `/update-docs`.

## First, find out what actually shipped

```
git log --oneline <last-docs-commit>..HEAD
git diff --stat <last-docs-commit>..HEAD
```

Read the commits. Do not document from memory of the conversation — the
conversation contains options that were rejected, and the commits contain what
was actually built.

## Which file gets what

**`docs/CURRENT_TASK.md`** — the active piece of work. Its own first line says
to overwrite the whole file when a new task starts; obey that, and keep the
`ACTIVE TASK — ` prefix exactly (it is a cold-start anchor). It carries: what was
asked (**the owner's own words, verbatim, in Greek**), which decisions were his,
what changed where, the measured baselines, and two lists — what a person has
actually SEEN, and what nobody has.

**`docs/PROJECT_STATUS.md`** — one bullet at the top of `## Shipped and live ✅`,
newest first. Self-contained: someone reading only that bullet should know what
changed and what is not proven. Point at DECISIONS.md for the reasoning.

**`docs/DECISIONS.md`** — append `### Decision: ...` **only when a real choice
was made** between options that both could have worked. WHY before WHAT. Name
what was rejected and what it would have cost. A decision that got corrected
later keeps both halves: what we did first, why it was wrong, what replaced it.

**`docs/BACKLOG.md`** — only when something was deliberately parked. Say why it
was parked, not just that it exists.

## The house rules

1. **The code is right, the doc is corrected — out loud.** When they disagree,
   fix the doc and write what it used to say. A silent correction is how these
   files started lying in the first place.
2. **Write down what is NOT verified.** Tests passing is not the same as a
   person seeing it work. If nobody has watched it, say so, in its own line, and
   say what would settle it.
3. **Evidence, quoted.** Baselines go in as the command's actual output —
   `npm run check` exit code and its `ui-check:` line, `npm run lint`'s problem
   count, whether `vite build` was clean. Never a number recalled from earlier
   in the session: re-run it or leave it out.
4. **The owner's words stay in Greek**, verbatim, where they drove a decision.
   Everything else in these files is English, matching what is already there.
5. **No new file** unless the work genuinely was a large design (`docs/superpowers/`),
   and only if he asked for one.

## Finish the job

Commit the docs and push them — the trigger was a push, so leaving the docs
sitting uncommitted recreates exactly the gap this exists to close. One commit,
message in the house style: a plain sentence about what the docs now say.

## When to do nothing

A typo, a comment, a docs-only commit. Say in one line that the change needed no
doc entry, and stop. An invented entry is worse than a missing one: it makes the
whole file less trustworthy, and these files have already lied to him before.
