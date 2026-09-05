#!/usr/bin/env node
/**
 * After a push, ask for the docs — automatically, so nobody has to remember.
 *
 * The owner's instruction, 2026-09-05: «μολις ολοκληρωθει ενα πθση να
 * ενημερωνεις τα ντοκς παντα να μην χρειάζεται να σου λεω εγω». So this runs as
 * a PostToolUse hook on the Bash tool, filtered to `git push`, and injects a
 * standing instruction back into the conversation.
 *
 * It is deliberately a REMINDER and not a gate. A hook cannot write "what we
 * built, why, and what is still unverified" — that needs judgement. What it can
 * do is make sure the question is always asked, at the one moment it is never
 * asked by itself.
 *
 * When it stays silent, and that matters as much as when it speaks:
 *   - the command was not a push
 *   - the push did not land (commits are still ahead of the remote)
 *   - every commit since the last docs commit is itself docs-only
 * The last rule is what stops it looping: the docs commit this hook asks for
 * is the very thing that silences it next time.
 *
 * Test it without pushing anything:
 *   echo '{"tool_name":"Bash","tool_input":{"command":"git push"}}' | node .claude/hooks/docs-after-push.mjs
 * and force the "docs are stale" branch with an older baseline:
 *   DOCS_BASE=<older-sha> echo ... | node .claude/hooks/docs-after-push.mjs
 */
import { execSync } from 'node:child_process';

const DOCS_PATH = 'docs/';

function git(args) {
  return execSync(`git ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function quiet() {
  process.exit(0); // say nothing, disturb nobody
}

let raw = '';
for await (const chunk of process.stdin) raw += chunk;

let payload;
try {
  payload = JSON.parse(raw || '{}');
} catch {
  quiet();
}

const command = payload?.tool_input?.command ?? '';
if (!/(^|\s|&&|;|\|)git\s+push\b/.test(command)) quiet();

try {
  // Did it actually land? Anything still ahead of the remote means the push
  // failed, or was never one — either way there is nothing to document yet.
  if (git('rev-list --count @{u}..HEAD') !== '0') quiet();

  // The baseline: the newest commit that touched docs/. Everything after it is
  // work the docs have not seen.
  const base = process.env.DOCS_BASE || git(`log -1 --format=%H -- ${DOCS_PATH}`);
  if (!base) quiet(); // no docs commit ever — nothing sensible to compare against

  // Commits since the baseline that changed something OUTSIDE docs/. A
  // docs-only commit is not a reason to write more docs.
  // The quotes around the format are load-bearing: unquoted, the shell hands
  // `%s` to git as a second revision and the whole command dies with "bad
  // revision" — which the catch below would have turned into silence. That is
  // the exact shape of failure this project has been bitten by before.
  const stale = git(`log --format="%h %s" ${base}..HEAD -- . ":(exclude)${DOCS_PATH}"`)
    .split('\n')
    .filter(Boolean);
  if (stale.length === 0) quiet();

  const list = stale.map((line) => `  - ${line}`).join('\n');
  const context = [
    `A push just landed with ${stale.length} commit(s) the docs have not seen:`,
    list,
    '',
    'The owner asked (2026-09-05) that this never wait to be requested: update the',
    'project docs NOW, then commit and push them. Invoke the `update-docs` skill',
    '(.claude/skills/update-docs/SKILL.md) and follow it — it holds which file gets',
    'what, and the house rules about correcting a doc that disagrees with the code',
    'and writing down what is still unverified.',
    '',
    'If the pushed work genuinely needs no doc change (a typo, a comment), say so in',
    'one line and stop — do not invent an entry to satisfy this reminder.',
  ].join('\n');

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context },
    })
  );
} catch (err) {
  // A hook that breaks a push is worse than a hook that misses one — so this
  // never throws. But it does not go quiet either: a check that fails silently
  // reports "all clear" forever, which is the failure this project has already
  // been burned by. It says so instead, and keeps saying so until it is fixed.
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext:
          `The after-push docs check could not run: ${err.message.split('\n')[0]}. ` +
          'Tell the owner it is broken, fix .claude/hooks/docs-after-push.mjs, and ' +
          'meanwhile decide by hand whether this push needs a docs entry.',
      },
    })
  );
  process.exit(0);
}
