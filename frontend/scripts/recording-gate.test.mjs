#!/usr/bin/env node
/**
 * src/utils/recordingGate.js — what is allowed to reach the AI.
 *
 * This is a SAFETY rule, like retry.js, and it has a test for the same reason:
 * its failure is invisible. The owner recorded a task with a YouTube video
 * playing, the screen showed a normal recording throughout, and the model
 * returned a task that came from neither him nor the video. Nothing on screen
 * said anything had gone wrong — he got a task, it just was not his.
 *
 * The two gates are deliberately PROOFS rather than estimates, and that is what
 * most of these cases check: that a good recording can never be refused by
 * either of them. A safety rule that sometimes eats real work stops being used.
 */
import {
  shouldSendRecording,
  STOP_USER,
  STOP_TIMEOUT,
  STOP_INTERRUPTED,
  MIN_BLOB_BYTES,
} from '../src/utils/recordingGate.js';

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
};

// A recording that is fine in every way, to vary one thing at a time from.
const good = { stopReason: STOP_USER, sizeBytes: 40000, peak: 0.42 };
const gate = (overrides) => shouldSendRecording({ ...good, ...overrides });

// --- the case that started this ------------------------------------------
// Stop was pressed perfectly normally. The microphone gave nothing.
check('a silent recording does not reach the AI',
  gate({ peak: 0 }), { ok: false, reason: 'silent' });

// --- only the user ends a recording ---------------------------------------
check('the 30-second cap does not reach the AI',
  gate({ stopReason: STOP_TIMEOUT }), { ok: false, reason: 'timed_out' });
check('an interruption does not reach the AI',
  gate({ stopReason: STOP_INTERRUPTED }), { ok: false, reason: 'interrupted' });
check('an unknown stop reason is not treated as the user',
  gate({ stopReason: undefined }), { ok: false, reason: 'interrupted' });

// The cause is reported, not the symptom: an interrupted recording is usually
// silent too, and "interrupted" is the more useful thing to read.
check('an interrupted AND silent recording reports the interruption',
  gate({ stopReason: STOP_INTERRUPTED, peak: 0 }), { ok: false, reason: 'interrupted' });

// --- the pre-existing too-short guard, unchanged ---------------------------
check('a tap that never became a recording says so',
  gate({ sizeBytes: MIN_BLOB_BYTES - 1 }), { ok: false, reason: 'too_short' });
check('exactly the minimum is not too short',
  gate({ sizeBytes: MIN_BLOB_BYTES }), { ok: true, reason: 'ok' });

// --- WHAT MUST NEVER BE REFUSED -------------------------------------------
// Short is not the same as cut off. "ψώνια" and "ραντεβού Γιάννη" are whole
// tasks, and the gates must not reach for length as a proxy for completeness.
check('a one-word task is sent', gate({ sizeBytes: 4200, peak: 0.3 }), { ok: true, reason: 'ok' });
check('a quiet but real recording is sent', gate({ peak: 0.004 }), { ok: true, reason: 'ok' });
check('the faintest possible non-zero sample is still sound',
  gate({ peak: Number.MIN_VALUE }), { ok: true, reason: 'ok' });
check('a long recording the user ended himself is sent',
  gate({ sizeBytes: 900000 }), { ok: true, reason: 'ok' });

// --- unmeasurable level fails OPEN ----------------------------------------
// A browser without Web Audio must still be able to use voice input; refusing
// what we cannot measure would break the feature rather than protect it.
check('an unmeasured level is sent', gate({ peak: null }), { ok: true, reason: 'ok' });
check('an absent level is sent', gate({ peak: undefined }), { ok: true, reason: 'ok' });

console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
