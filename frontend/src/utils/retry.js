/**
 * When the app may quietly try a request again.
 *
 * WHY THIS IS ITS OWN FILE: the rule is a safety decision, not a convenience.
 * Retrying the wrong thing creates a second task out of one tap, and that
 * failure is INVISIBLE — the user sees a task list, not an error, and nothing
 * in it says one of the rows should not be there. A rule like that has to be
 * readable and testable on its own, away from fetch and away from auth.
 *
 * The problem it solves is real and was met by a real person: the backend
 * sleeps when nobody is using it, and the first requests after that fail. On
 * her first morning with the app a colleague saw a red «503 Failed to retrieve
 * tasks» three times before it worked. She was doing by hand exactly what this
 * does — try again, wait a bit longer.
 */

/**
 * Milliseconds to wait before each retry. Roughly fourteen seconds in total:
 * long enough to cover a wake-up, short enough that a genuinely dead backend
 * still says so while somebody is looking at the screen.
 */
export const RETRY_DELAYS_MS = [1500, 4000, 8000];

/**
 * The statuses a backend that is starting up answers with. 503 is also what
 * this app's own handlers return when their call to the database fails, which
 * is the same transient thing seen from inside.
 *
 * Nothing else belongs here. A 4xx is a real answer — asking a second time
 * cannot turn a 404 into something else, and retrying a 403 is just a slower
 * refusal.
 */
export const TRANSIENT_STATUSES = [502, 503, 504];

/**
 * `status` is null for a network-level failure, where no answer arrived at all.
 *
 * READS RETRY, WRITES DO NOT. A 503 from a sleeping backend usually means the
 * request never arrived — but "usually" is not "always", and a retried
 * POST /tasks whose first attempt actually succeeded creates the task twice. A
 * duplicate task is worse than an error message: the error is visible and the
 * duplicate is not.
 */
export function shouldRetryRequest({ attempt, isRead, status }) {
  if (!isRead) return false;
  if (attempt >= RETRY_DELAYS_MS.length) return false;
  if (status === null || status === undefined) return true;
  return TRANSIENT_STATUSES.includes(status);
}
