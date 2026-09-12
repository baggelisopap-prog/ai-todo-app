#!/usr/bin/env node
/**
 * src/utils/retry.js — when the app may quietly try a request again.
 *
 * This one is a SAFETY rule, not a convenience, which is why it has a test of
 * its own. Retrying the wrong thing turns one tap into two tasks, and that
 * failure is invisible: the user sees a task list, not an error, and nothing
 * on screen says one of the rows should not be there.
 *
 * The case it exists for is real. The backend sleeps when nobody is using it,
 * and on her first morning with the app a colleague saw a red «503 Failed to
 * retrieve tasks» three times before it worked — doing by hand what this does.
 */
import {
  shouldRetryRequest,
  RETRY_DELAYS_MS,
  TRANSIENT_STATUSES,
} from '../src/utils/retry.js';

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
};

const read = (status, attempt = 0) => shouldRetryRequest({ attempt, isRead: true, status });
const write = (status, attempt = 0) => shouldRetryRequest({ attempt, isRead: false, status });

// --- the whole point: a write is NEVER retried ----------------------------
check('a write is not retried on 503', write(503), false);
check('a write is not retried on a dead network', write(null), false);
check('a write is not retried on 502 either', write(502), false);

// --- a read retries exactly the transient answers -------------------------
TRANSIENT_STATUSES.forEach((status) => {
  check(`a read retries on ${status}`, read(status), true);
});
check('a read retries when nothing answered at all', read(null), true);
check('a read retries when status is undefined', read(undefined), true);

// --- and nothing else -----------------------------------------------------
check('200 is not a failure', read(200), false);
check('404 is a real answer, not a blip', read(404), false);
check('403 is a refusal — asking again is a slower no', read(403), false);
check('401 is not retried', read(401), false);
check('422 is the user data being wrong', read(422), false);
check('500 is a real fault, not a wake-up', read(500), false);

// --- it gives up --------------------------------------------------------
check('the last allowed attempt still retries', read(503, RETRY_DELAYS_MS.length - 1), true);
check('one past the end gives up', read(503, RETRY_DELAYS_MS.length), false);
check('well past the end gives up', read(503, 99), false);

// --- the waiting adds up to something a person will sit through -----------
const total = RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);
check('the delays grow rather than repeat', RETRY_DELAYS_MS.every((d, i) => i === 0 || d > RETRY_DELAYS_MS[i - 1]), true);
check('total wait stays under 20 seconds', total < 20000, true);

console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
