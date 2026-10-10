#!/usr/bin/env node
/**
 * public/sw.js — a tapped notification opens the task it is about (2026-10-10).
 *
 * The owner tapped a reminder for a guest message and landed on a screen the
 * task was not on. The server now puts `task_id` in the push
 * (tests/test_awaiting_reply.py); this checks the service worker carries it to
 * the app on both roads a tap can take — a closed app opens a URL, an open one
 * gets a message — and that a push about no task (the daily summary) still
 * opens exactly as before.
 *
 * sw.js is a classic worker script, not a module, so it is run in a vm with
 * the few worker globals it touches.
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
};

const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

/** One push, then one tap on what it showed. Returns what the tap did. */
async function pushThenTap(payload, { appIsOpen }) {
  const handlers = {};
  let shown = null;
  const did = { opened: null, posted: null };
  const windowClient = { focus() {}, postMessage(message) { did.posted = message; } };
  const context = {
    self: {
      addEventListener: (type, fn) => { handlers[type] = fn; },
      skipWaiting() {},
      registration: { showNotification: async (title, options) => { shown = { title, options }; } },
    },
    clients: {
      claim: async () => {},
      matchAll: async () => (appIsOpen ? [windowClient] : []),
      openWindow: async (url) => { did.opened = url; },
    },
    console,
  };
  vm.runInNewContext(source, context);

  const pending = [];
  const waitUntil = (p) => pending.push(p);
  handlers.push({ data: { json: () => payload, text: () => '' }, waitUntil });
  await Promise.all(pending.splice(0));
  handlers.notificationclick({ notification: { close() {}, data: shown.options.data }, waitUntil });
  await Promise.all(pending.splice(0));
  return did;
}

const escalation = { title: '⏰ Hostaway: GEORGIOS', body: 'Ακόμα δεν έχει απαντηθεί.', task_id: 'invoice' };

let did = await pushThenTap(escalation, { appIsOpen: false });
check('app closed: the tap opens the task by URL', did.opened, '/?view=today&task=invoice');

did = await pushThenTap(escalation, { appIsOpen: true });
check('app open: the tap tells it which task', did.posted, { type: 'NAVIGATE', view: 'today', taskId: 'invoice' });

const summary = { title: 'Το πρόγραμμα της ημέρας', body: '3 εργασίες', view: 'today' };
did = await pushThenTap(summary, { appIsOpen: false });
check('a push about no task opens as it always did', did.opened, '/?view=today');

did = await pushThenTap(summary, { appIsOpen: true });
check('…and names no task when the app is open', did.posted, { type: 'NAVIGATE', view: 'today', taskId: null });

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
