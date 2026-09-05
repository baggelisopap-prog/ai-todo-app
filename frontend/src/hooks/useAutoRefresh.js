import { useEffect, useRef } from 'react';

/**
 * One minute. Deliberately shorter than the server's own ~2-minute pull from
 * Google: the two waits add up, so a 2-minute screen refresh on top of a
 * 2-minute pull could make a calendar event take four minutes to appear.
 */
const DEFAULT_INTERVAL_MS = 60000;

/**
 * Re-runs `refresh` when the user comes back to the app, and on a timer while
 * they are actually looking at it.
 *
 * WHY THIS EXISTS (2026-09-05): every screen in this app fetched once and then
 * never asked again. The owner created an event in Google Calendar and it did
 * not show up — the sync was innocent (the event was in our database 1 m 55 s
 * later, measured against the live account), the screen simply never asked a
 * second time. Turning the "show Google events" switch off and on was the only
 * thing on that screen that forced a fetch, which is why it looked like the
 * switch was the broken part. Tasks had the same hole: a Hostaway message or a
 * recurrence generated at midnight appeared only after a reload.
 *
 * Two rules, and both matter:
 *
 * - **Nothing fires while the screen is hidden.** A phone in a pocket must not
 *   spend requests, and the return-to-foreground refresh below already covers
 *   everything missed while it was away.
 * - **The newest `refresh` runs, never the one the timer was created with.**
 *   These callbacks close over what is on screen (the visible month, today's
 *   date), so a timer holding the original would put September's events back
 *   on an October screen. Hence the ref: the interval is created once and
 *   always reaches for the current function.
 *
 * `refresh` must swallow its own failures. This runs unasked, so a phone
 * coming out of a tunnel must not greet the user with an error about something
 * they never requested.
 *
 * Tested in scripts/auto-refresh.test.mjs — as a simulation of the rule, since
 * plain node cannot mount a hook. If the rule changes, change that too.
 */
export function useAutoRefresh(refresh, intervalMs = DEFAULT_INTERVAL_MS) {
  const latestRefresh = useRef(refresh);

  useEffect(() => {
    latestRefresh.current = refresh;
  });

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') latestRefresh.current();
    }
    function tick() {
      if (document.visibilityState === 'hidden') return;
      latestRefresh.current();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    const timer = setInterval(tick, intervalMs);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(timer);
    };
  }, [intervalMs]);
}
