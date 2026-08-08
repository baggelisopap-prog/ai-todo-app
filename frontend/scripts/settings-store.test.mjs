#!/usr/bin/env node
/**
 * The settings store in src/hooks/useAppSettings.jsx, against the sequence that
 * used to lose data.
 *
 * Follows modal-lock.test.mjs: a pure simulation of the store's rule rather
 * than the React module itself, because the thing being tested is not React —
 * it is "where does the base object for a write come from". If the hook's rule
 * changes, change this to match.
 *
 * What makes this test self-verifying is that it runs the SAME scenario against
 * both models. The old one (a snapshot per component) must fail; the new one
 * (one copy, merge into the latest) must pass. A test that only exercised the
 * fix would pass just as happily against a store that never worked.
 */

// The server: PATCH /settings takes a whole AppSettings and writes every field.
// That is the real contract (main.py update_settings) and it is why a stale
// base object is destructive rather than merely useless.
function makeServer() {
  let stored = {
    notifications_enabled: true,
    send_all_enabled: true,
    daily_summary_enabled: false,
    calendar_sync_all_enabled: true,
    calendar_show_events: true,
  };
  return {
    get: () => ({ ...stored }),
    patch: (whole) => {
      stored = { ...whole };
      return { ...stored };
    },
  };
}

// BEFORE: each component fetched on mount and kept its own copy. Both sections
// of SettingsModal are mounted at once (CollapsibleSection hides, it does not
// unmount), so both snapshots are taken at open and both go stale.
function legacyModel(server) {
  const componentA = server.get();
  const componentB = server.get();
  return {
    writeFromA: (patch) => server.patch({ ...componentA, ...patch }),
    writeFromB: (patch) => server.patch({ ...componentB, ...patch }),
  };
}

// AFTER: one copy behind the provider. Both callers merge into the same latest
// value, so there is no second base object to overwrite from.
function currentModel(server) {
  let current = server.get();
  const write = (patch) => {
    current = server.patch({ ...current, ...patch });
    return current;
  };
  return { writeFromA: write, writeFromB: write };
}

let failures = 0;
const check = (name, got, want) => {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
};

// The reported sequence: turn notifications off in one section, then touch a
// setting in another section of the same open modal.
function runScenario(model) {
  const server = makeServer();
  const { writeFromA, writeFromB } = model(server);
  writeFromA({ notifications_enabled: false });   // Notifications section
  writeFromB({ calendar_show_events: false });    // Google Calendar section
  return server.get();
}

const legacy = runScenario(legacyModel);
check('OLD model loses the first write (this is the bug)', legacy.notifications_enabled, true);
check('OLD model does keep the second write', legacy.calendar_show_events, false);

const current = runScenario(currentModel);
check('one copy: notifications stay off', current.notifications_enabled, false);
check('one copy: calendar events stay off', current.calendar_show_events, false);

// The reverse order must hold too — the bug is symmetric, and fixing only the
// direction that was reported is how half a fix ships.
function runReverse(model) {
  const server = makeServer();
  const { writeFromA, writeFromB } = model(server);
  writeFromB({ calendar_show_events: false });
  writeFromA({ notifications_enabled: false });
  return server.get();
}
const reverse = runReverse(currentModel);
check('reverse order: both writes survive (calendar)', reverse.calendar_show_events, false);
check('reverse order: both writes survive (notifications)', reverse.notifications_enabled, false);

// A field nobody touched must not be invented or dropped by the whole-object write.
check('untouched field preserved', reverse.send_all_enabled, true);

// A failed write reverts to the value from before it, not to the value from
// whenever the component mounted.
const server = makeServer();
let current2 = server.get();
current2 = server.patch({ ...current2, notifications_enabled: false });
const beforeFailed = { ...current2 };
try {
  const attempted = { ...current2, daily_summary_enabled: true };
  throw Object.assign(new Error('network'), { attempted });
} catch {
  current2 = beforeFailed; // what updateSettings does in its catch
}
check('failed write reverts to the latest, not to mount state', current2.notifications_enabled, false);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
