/**
 * Whether a finished recording is allowed to reach the AI.
 *
 * WHY THIS IS CODE AND NOT A PROMPT. The owner recorded a task while a YouTube
 * video was playing. The microphone gave nothing, the screen showed a normal
 * recording the whole time, and on stop the model produced a task that matched
 * neither what he said nor the video — most likely assembled out of the quoted
 * examples in the extraction instruction, which are the only task-shaped text
 * in the prompt.
 *
 * A model cannot catch this. It receives a sound file, and a file that captured
 * nothing sounds to it exactly like a file that ends; the information "something
 * is missing here" never reaches it. Worse, completing an unfinished utterance
 * is the thing these models are built to do — an instruction not to is a
 * probability, not a rule. So the decision moved to where it can be a rule:
 *
 *   code decides whether a recording is COMPLETE;
 *   the AI only ever decides what a complete recording MEANS.
 *
 * Both gates below are proofs, not estimates — neither has a threshold anybody
 * chose, so neither can fire on a good recording:
 *
 *   1. Did the USER end it? The code stops the recorder in every case, so it
 *      always knows which case this was. Catches the 30-second cap, an incoming
 *      call, the screen locking, another app taking the microphone.
 *   2. Did ANY sound arrive? Catches the case above, where stop was pressed
 *      perfectly normally and the recording was simply empty.
 *
 * KNOWN LIMIT, deliberately left: gate 2 fires on digital silence — every
 * sample exactly zero. A microphone that delivers very faint noise instead of
 * true zeros passes it. That is what the live level meter is for: the owner
 * sees the bar not moving long before he presses stop. A threshold ("quieter
 * than X counts as silence") was considered and declined — it is the only
 * number here that would be somebody's judgement, and it is the only one that
 * could refuse a recording that was fine.
 *
 * `peak` of null means the level could not be measured at all (no Web Audio
 * support). That FAILS OPEN and sends: refusing what we cannot measure would
 * break voice input on the browser rather than protect it.
 */

// Why the recorder stopped. The code sets this immediately before every call to
// MediaRecorder.stop(), so it is never inferred.
export const STOP_USER = 'user';               // he pressed stop
export const STOP_TIMEOUT = 'timeout';         // the 30-second cap fired
export const STOP_INTERRUPTED = 'interrupted'; // track muted/ended, or the app went to the background

// Below this, nothing was captured at all — a tap that never became a
// recording. Pre-existing guard, kept: its message ("hold longer") is the
// useful one for that case.
export const MIN_BLOB_BYTES = 1000;

/**
 * @param {object}  input
 * @param {string}  input.stopReason  one of STOP_USER / STOP_TIMEOUT / STOP_INTERRUPTED
 * @param {number}  input.sizeBytes   size of the encoded recording
 * @param {number|null} input.peak    loudest sample seen, 0..1; null = not measured
 * @returns {{ok: boolean, reason: string}} reason doubles as the translation key
 */
export function shouldSendRecording({ stopReason, sizeBytes, peak }) {
  // The cause comes before the symptom: an interrupted recording is usually
  // also silent, and "your call interrupted this" is a better thing to read
  // than "no sound was captured".
  if (stopReason === STOP_TIMEOUT) return { ok: false, reason: 'timed_out' };
  if (stopReason !== STOP_USER) return { ok: false, reason: 'interrupted' };

  if (typeof sizeBytes === 'number' && sizeBytes < MIN_BLOB_BYTES) {
    return { ok: false, reason: 'too_short' };
  }

  if (peak === 0) return { ok: false, reason: 'silent' };

  return { ok: true, reason: 'ok' };
}
