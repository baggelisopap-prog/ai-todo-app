import { forwardRef, useState, useEffect, useRef, useImperativeHandle } from 'react';
import { useTranslation } from 'react-i18next';
import { extractTasksFromAudio } from '../api';
import { MicIcon, StopIcon, SpinnerIcon } from './icons';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { UNFILED } from '../utils/workspaces';
import {
  shouldSendRecording,
  STOP_USER,
  STOP_TIMEOUT,
  STOP_INTERRUPTED,
} from '../utils/recordingGate';

function formatTime(s) {
  const m = Math.floor(s / 60);
  const secs = s % 60;
  return `${m}:${secs.toString().padStart(2, '0')}`;
}

const VoiceButton = forwardRef(function VoiceButton({ onComplete, renderIdleButton = true }, ref) {
  const { activeId } = useWorkspaces();
  // UNFILED is a VIEW, not a destination: a task added while looking at the
  // unfiled pile should go to the user's default workspace, not deliberately
  // back onto the pile. null tells the server to use that default.
  const destination = activeId === UNFILED ? null : activeId;
  const { t } = useTranslation();
  const [recordingState, setRecordingState] = useState('idle');
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [voiceError, setVoiceError] = useState(null);
  // Current microphone level, 0..1, for the meter. Its only job is to let the
  // user SEE that something is arriving — the decision is made from peakRef.
  const [level, setLevel] = useState(0);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);
  const maxDurationTimerRef = useRef(null);
  const errorTimerRef = useRef(null);

  // WHY the recorder stopped, written immediately before every stop() call so
  // it is never guessed. See utils/recordingGate.js.
  const stopReasonRef = useRef(null);
  // Loudest sample of the whole recording. null means NOT MEASURED (no Web
  // Audio) and fails open; 0 is a measurement, and means silence.
  const peakRef = useRef(null);
  const audioCtxRef = useRef(null);
  const rafRef = useRef(null);
  const interruptCleanupRef = useRef(null);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current.stream?.getTracks().forEach((tr) => tr.stop());
      }
      interruptCleanupRef.current?.();
      stopLevelMetering();
      clearInterval(timerRef.current);
      clearTimeout(maxDurationTimerRef.current);
      clearTimeout(errorTimerRef.current);
    };
  }, []);

  function showError(msg) {
    setVoiceError(msg);
    clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setVoiceError(null), 4000);
  }

  /**
   * Reads the live microphone level off the SAME stream the recorder is using.
   * Two outputs: `level` drives the meter on screen, `peakRef` remembers the
   * loudest moment of the whole recording so the gate can tell silence from
   * sound after the fact.
   *
   * Failing here is not fatal. peakRef stays null, which the gate reads as "not
   * measured" and lets through — a browser without Web Audio must still be able
   * to record, and refusing what cannot be measured would break voice input
   * rather than protect it.
   */
  function startLevelMetering(stream) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      ctx.resume?.();

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      ctx.createMediaStreamSource(stream).connect(analyser);

      const samples = new Uint8Array(analyser.fftSize);
      // Only now does 0 MEAN something. Before this line it means "unknown".
      peakRef.current = 0;

      const tick = () => {
        analyser.getByteTimeDomainData(samples);
        // getByteTimeDomainData centres silence on 128, so distance from 128 is
        // how far the microphone moved. Digital silence is exactly 128 for
        // every sample, which is exactly 0 here — no threshold involved.
        let framePeak = 0;
        for (let i = 0; i < samples.length; i += 1) {
          const deviation = Math.abs(samples[i] - 128) / 128;
          if (deviation > framePeak) framePeak = deviation;
        }
        if (framePeak > peakRef.current) peakRef.current = framePeak;
        setLevel(framePeak);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      peakRef.current = null;
    }
  }

  function stopLevelMetering() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    audioCtxRef.current?.close?.();
    audioCtxRef.current = null;
    setLevel(0);
  }

  /**
   * Every path that ends a recording comes through here and says why. The
   * default is STOP_USER because the only caller that passes nothing is the
   * button itself.
   */
  function stopRecording(reason = STOP_USER) {
    if (mediaRecorderRef.current?.state === 'recording') {
      // First writer wins: an interruption arriving while the user is already
      // stopping must not rewrite why the recording actually ended.
      if (!stopReasonRef.current) stopReasonRef.current = reason;
      mediaRecorderRef.current.stop();
    }
    clearInterval(timerRef.current);
    clearTimeout(maxDurationTimerRef.current);
  }

  async function startRecording() {
    setVoiceError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      stopReasonRef.current = null;
      peakRef.current = null;

      startLevelMetering(stream);

      // The three ways a recording ends that are NOT the user. The track's own
      // mute/ended events are the browser saying outright that no media is
      // flowing — the most direct signal there is, though not every phone
      // sends it, which is why the silence gate exists underneath.
      const track = stream.getAudioTracks()[0];
      const onInterrupted = () => stopRecording(STOP_INTERRUPTED);
      const onVisibilityChange = () => {
        if (document.hidden) stopRecording(STOP_INTERRUPTED);
      };
      track?.addEventListener('mute', onInterrupted);
      track?.addEventListener('ended', onInterrupted);
      document.addEventListener('visibilitychange', onVisibilityChange);
      interruptCleanupRef.current = () => {
        track?.removeEventListener('mute', onInterrupted);
        track?.removeEventListener('ended', onInterrupted);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        interruptCleanupRef.current = null;
      };

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        interruptCleanupRef.current?.();
        stopLevelMetering();
        stream.getTracks().forEach((audioTrack) => audioTrack.stop());

        const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType });
        audioChunksRef.current = [];

        // THE GATE. Nothing reaches the AI that the code cannot say is a
        // complete recording — see utils/recordingGate.js for why this is code
        // and not an instruction to the model. Every refusal reason doubles as
        // its translation key.
        const verdict = shouldSendRecording({
          stopReason: stopReasonRef.current,
          sizeBytes: audioBlob.size,
          peak: peakRef.current,
        });
        stopReasonRef.current = null;

        if (!verdict.ok) {
          setRecordingState('idle');
          showError(t(`voice.${verdict.reason}`));
          return;
        }

        setRecordingState('processing');
        try {
          const result = await extractTasksFromAudio(audioBlob, destination);
          onComplete(result.saved_tasks);
        } catch (err) {
          showError(err.message);
        } finally {
          setRecordingState('idle');
        }
      };

      mediaRecorder.start();
      setRecordingState('recording');
      setRecordingSeconds(0);

      timerRef.current = setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);

      maxDurationTimerRef.current = setTimeout(() => {
        if (mediaRecorderRef.current?.state === 'recording') {
          // A recording the clock ended is cut off by definition, whatever was
          // being said at the time. It is refused rather than sent, so the
          // model is never handed half a sentence to finish.
          stopRecording(STOP_TIMEOUT);
        }
      }, 30000);
    } catch {
      showError(t('voice.permission_denied'));
      setRecordingState('idle');
    }
  }

  function handleClick() {
    if (recordingState === 'idle') {
      startRecording();
    } else if (recordingState === 'recording') {
      stopRecording();
    }
  }

  useImperativeHandle(ref, () => ({
    trigger: () => {
      if (recordingState === 'idle') startRecording();
    },
  }));

  const isProcessing = recordingState === 'processing';
  const isActive = recordingState !== 'idle';

  // When not rendering the idle FAB (Speed Dial mode), there is nothing to
  // show until recording/processing starts or an error needs to be surfaced.
  if (!renderIdleButton && !isActive && !voiceError) {
    return null;
  }

  return (
    <div
      className={
        renderIdleButton
          ? 'relative flex flex-col items-center gap-1'
          // Climbs with the capture button it stacks above (see
          // .bottom-safe-rec), and picks up the home-indicator inset the old
          // bare `bottom-44` was ignoring.
          : 'fixed bottom-safe-rec right-4 z-40 flex flex-col items-center gap-1'
      }
    >
      {voiceError && (
        <div className="absolute bottom-full mb-2 right-0 w-52 p-2 rounded-lg border border-[var(--danger-border)] bg-[var(--bg-card)] text-[var(--danger)] text-xs shadow-[var(--shadow-menu)] z-10">
          {voiceError}
        </div>
      )}
      {(renderIdleButton || isActive) && (
        <>
          <div className="relative flex items-center justify-center">
            {recordingState === 'recording' && (
              <span className="absolute w-16 h-16 rounded-full bg-[var(--danger)] opacity-25 animate-ping" />
            )}
            <button
              type="button"
              onClick={handleClick}
              disabled={isProcessing}
              aria-label={t('voice.label')}
              className={`relative w-16 h-16 rounded-full flex items-center justify-center transition-colors shadow-[var(--shadow-fab)]
                ${recordingState === 'idle'
                  ? 'bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] text-white'
                  : recordingState === 'recording'
                  ? 'bg-[var(--danger)] text-white'
                  : 'bg-[var(--bg-hover)] text-[var(--text-secondary)]'
                } disabled:cursor-not-allowed`}
            >
              {recordingState === 'idle' && <MicIcon />}
              {recordingState === 'recording' && <StopIcon />}
              {recordingState === 'processing' && <SpinnerIcon />}
            </button>
          </div>
          {recordingState === 'recording' && (
            // The whole point of showing this: a microphone that is running but
            // hearing nothing looked EXACTLY like a working one, which is how a
            // silent recording reached the AI in the first place.
            <div
              className="w-16 h-1.5 rounded-full bg-[var(--bg-hover)] overflow-hidden"
              role="progressbar"
              aria-label={t('voice.level')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(level * 100)}
            >
              <div
                className="h-full bg-[var(--danger)]"
                style={{ width: `${Math.min(100, Math.round(level * 140))}%` }}
              />
            </div>
          )}
          <span className="text-xs text-[var(--text-secondary)] text-center min-w-[56px]">
            {recordingState === 'idle' && t('voice.label')}
            {recordingState === 'recording' && formatTime(recordingSeconds)}
            {recordingState === 'processing' && t('voice.processing')}
          </span>
        </>
      )}
    </div>
  );
});

export default VoiceButton;
