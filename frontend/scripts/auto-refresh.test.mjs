#!/usr/bin/env node
/**
 * The refresh rule in src/hooks/useAutoRefresh.js, against the three ways it
 * can be got wrong.
 *
 * Follows settings-store.test.mjs: a pure simulation of the rule rather than
 * the React hook itself, because plain node cannot mount a hook and the thing
 * being tested is not React — it is "when may a background refresh fire, and
 * WHICH refresh fires". If the hook's rule changes, change this to match.
 *
 * What it is guarding, in the owner's words: a Google Calendar event he had
 * just created did not appear until he turned the "show Google events" switch
 * off and on again. Nothing was wrong with the sync — the event was in the
 * database 1 m 55 s after he made it (measured 2026-09-05). The screen simply
 * never asked a second time, and flipping the switch was the only thing on
 * that screen that made it ask.
 *
 * Each model is run against the SAME scenario, and the broken ones must fail
 * the assertions the current one passes — a test that only exercised the fix
 * would pass just as happily against a hook that never refreshed anything.
 */

let failures = 0;
const check = (name, got, want) => {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
};

// The browser, reduced to the two things the hook actually touches: a
// visibility state with its event, and a timer we fire by hand instead of
// waiting a real minute.
function makeBrowser() {
  let visibility = 'visible';
  const visibilityListeners = [];
  const timers = [];
  return {
    document: {
      get visibilityState() { return visibility; },
      addEventListener(type, fn) { if (type === 'visibilitychange') visibilityListeners.push(fn); },
      removeEventListener(type, fn) {
        const i = visibilityListeners.indexOf(fn);
        if (i >= 0) visibilityListeners.splice(i, 1);
      },
    },
    setInterval(fn) { timers.push(fn); return timers.length; },
    // The phone locks, or the user switches to Google Calendar.
    goToBackground() { visibility = 'hidden'; visibilityListeners.forEach((fn) => fn()); },
    // ...and comes back.
    returnToForeground() { visibility = 'visible'; visibilityListeners.forEach((fn) => fn()); },
    tick() { timers.forEach((fn) => fn()); },
  };
}

// THE CURRENT RULE — useAutoRefresh: refresh on return to the foreground,
// refresh on the timer but only while the screen is actually being looked at,
// and always call the NEWEST refresh function, never the one captured when the
// timer was created.
function currentModel(browser, refresh) {
  const latest = { current: refresh };
  browser.document.addEventListener('visibilitychange', () => {
    if (browser.document.visibilityState === 'visible') latest.current();
  });
  browser.setInterval(() => {
    if (browser.document.visibilityState === 'hidden') return;
    latest.current();
  });
  // What the hook's effect does after every render.
  return { rerenderWith: (fn) => { latest.current = fn; } };
}

// WRONG #1 — a plain interval. No visibility listener, no hidden guard: it
// burns requests on a phone in a pocket and still makes the user wait for the
// next tick when they come back.
function timerOnlyModel(browser, refresh) {
  const latest = { current: refresh };
  browser.setInterval(() => latest.current());
  return { rerenderWith: (fn) => { latest.current = fn; } };
}

// WRONG #2 — the timer keeps the function it was created with. The classic
// React stale closure: it goes on fetching whatever month was on screen when
// the interval started, and overwrites the month the user has since moved to.
function capturedCallbackModel(browser, refresh) {
  browser.document.addEventListener('visibilitychange', () => {
    if (browser.document.visibilityState === 'visible') refresh();
  });
  browser.setInterval(() => {
    if (browser.document.visibilityState === 'hidden') return;
    refresh();
  });
  return { rerenderWith: () => {} }; // a re-render cannot reach it
}

// --- Scenario 1: the phone is in the owner's pocket -----------------------
// Three timer ticks with the app in the background. A request here buys
// nothing: nobody is looking, and the screen refetches on return anyway.
function runInBackground(model) {
  const browser = makeBrowser();
  const requests = [];
  model(browser, () => requests.push('tasks'));
  browser.goToBackground();
  browser.tick();
  browser.tick();
  browser.tick();
  return requests.length;
}

check('OLD timer-only model fetches with nobody looking (this is the waste)', runInBackground(timerOnlyModel), 3);
check('hidden screen makes no requests', runInBackground(currentModel), 0);

// --- Scenario 2: he comes back to the app --------------------------------
// The reported workaround was flipping a switch to force one fetch. Returning
// to the app must do that on its own, WITHOUT waiting for the next tick.
function runReturn(model) {
  const browser = makeBrowser();
  const requests = [];
  model(browser, () => requests.push('events'));
  browser.goToBackground();
  browser.returnToForeground();
  return requests.length; // counted before any tick
}

check('OLD timer-only model shows nothing until the next tick', runReturn(timerOnlyModel), 0);
check('returning to the app refreshes immediately', runReturn(currentModel), 1);

// --- Scenario 3: he moves from September to October -----------------------
// The refresh function is rebuilt on every render because it closes over the
// visible month. A timer holding the old one would quietly put September's
// events back on an October screen.
function runAfterNavigating(model) {
  const browser = makeBrowser();
  const fetched = [];
  const handle = model(browser, () => fetched.push('September'));
  handle.rerenderWith(() => fetched.push('October'));
  browser.tick();
  return fetched[fetched.length - 1];
}

check('OLD captured-callback model refetches the month he left', runAfterNavigating(capturedCallbackModel), 'September');
check('the timer calls the newest refresh, not the one it started with', runAfterNavigating(currentModel), 'October');

// A background tick must not be silently skipped while the screen IS visible —
// the opposite failure, and the one that would make the whole hook decorative.
function runVisibleTicks(model) {
  const browser = makeBrowser();
  const requests = [];
  model(browser, () => requests.push('tasks'));
  browser.tick();
  browser.tick();
  return requests.length;
}

check('two ticks while looking = two refreshes', runVisibleTicks(currentModel), 2);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
