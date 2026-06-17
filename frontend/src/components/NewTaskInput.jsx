import { useState, useEffect, useRef } from 'react';
import { extractTasks, extractTasksFromAudio } from '../api';

function NewTaskInput({ onTasksAdded }) {
  // Text input state
  const [text, setText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Voice recording state
  const [recordingState, setRecordingState] = useState('idle'); // 'idle' | 'recording' | 'processing'
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [voiceError, setVoiceError] = useState(null);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);
  const maxDurationTimerRef = useRef(null);

  // Release microphone if component unmounts mid-recording
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current.stream?.getTracks().forEach((t) => t.stop());
      }
      clearInterval(timerRef.current);
      clearTimeout(maxDurationTimerRef.current);
    };
  }, []);

  // ── Text submission ──────────────────────────────────────────────────────────

  const trimmedText = text.trim();
  const canSubmit = trimmedText.length > 0 && !isSubmitting;

  async function handleTextSubmit() {
    if (!canSubmit) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const result = await extractTasks(trimmedText);
      onTasksAdded(result.saved_tasks);
      setText('');
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleTextSubmit();
    }
  }

  // ── Voice recording ──────────────────────────────────────────────────────────

  function stopRecording() {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop(); // triggers ondataavailable → onstop
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

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // Release the microphone immediately
        stream.getTracks().forEach((track) => track.stop());

        const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType });
        audioChunksRef.current = [];

        // Guard against accidental taps producing a near-empty clip
        if (audioBlob.size < 1000) {
          setRecordingState('idle');
          setVoiceError('Recording too short. Hold longer.');
          return;
        }

        setRecordingState('processing');
        try {
          const result = await extractTasksFromAudio(audioBlob);
          onTasksAdded(result.saved_tasks);
        } catch (err) {
          setVoiceError(err.message);
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

      // Auto-stop at 30 seconds
      maxDurationTimerRef.current = setTimeout(() => {
        if (mediaRecorderRef.current?.state === 'recording') {
          stopRecording();
        }
      }, 30000);
    } catch {
      setVoiceError('Microphone access denied or not available.');
      setRecordingState('idle');
    }
  }

  function handleVoiceClick() {
    if (recordingState === 'idle') {
      startRecording();
    } else if (recordingState === 'recording') {
      stopRecording();
    }
    // 'processing' → clicks are ignored (button is disabled)
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="mb-6">
      <div className="flex flex-col md:flex-row gap-3">
        {/* Left: text input region */}
        <div className="flex-1 rounded-lg border border-slate-800 bg-slate-900 overflow-hidden focus-within:border-slate-700 transition-colors">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a task in any language... e.g. 'αύριο δουλειά στο passenger 22:00'"
            rows={3}
            disabled={isSubmitting}
            className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-500 px-4 py-3 resize-none focus:outline-none disabled:opacity-50"
          />
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-slate-800 bg-slate-950/50">
            <span className="text-xs text-slate-500">
              {isSubmitting ? 'Extracting tasks...' : 'Ctrl+Enter to submit'}
            </span>
            <button
              type="button"
              onClick={handleTextSubmit}
              disabled={!canSubmit}
              className="inline-flex items-center px-3 py-1.5 rounded-md text-xs font-medium bg-blue-600 text-white hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? 'Adding...' : 'Add'}
            </button>
          </div>
        </div>

        {/* Right: voice recording region */}
        <div className="md:w-32 flex items-center justify-center rounded-lg border border-slate-800 bg-slate-900 min-h-[100px] p-4">
          <VoiceButton
            state={recordingState}
            seconds={recordingSeconds}
            onClick={handleVoiceClick}
            disabled={isSubmitting}
          />
        </div>
      </div>

      {error && (
        <div className="mt-2 p-3 rounded-lg border border-red-900 bg-red-950 text-red-300">
          <p className="text-xs font-medium">Failed to add task</p>
          <p className="text-xs mt-1 opacity-80">{error}</p>
        </div>
      )}
      {voiceError && (
        <div className="mt-2 p-3 rounded-lg border border-red-900 bg-red-950 text-red-300">
          <p className="text-xs font-medium">Voice error</p>
          <p className="text-xs mt-1 opacity-80">{voiceError}</p>
        </div>
      )}
    </div>
  );
}

function VoiceButton({ state, seconds, onClick, disabled }) {
  const isDisabled = disabled || state === 'processing';

  function formatTime(s) {
    const m = Math.floor(s / 60);
    const secs = s % 60;
    return `${m}:${secs.toString().padStart(2, '0')}`;
  }

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Button + ping ring wrapper */}
      <div className="relative flex items-center justify-center">
        {state === 'recording' && (
          <span className="absolute w-20 h-20 rounded-full bg-red-600 opacity-25 animate-ping" />
        )}
        <button
          type="button"
          onClick={onClick}
          disabled={isDisabled}
          className={`relative w-20 h-20 rounded-full flex items-center justify-center transition-colors
            ${state === 'idle'
              ? 'bg-blue-600 hover:bg-blue-500 text-white'
              : state === 'recording'
              ? 'bg-red-600 text-white'
              : 'bg-slate-700 text-slate-400'
            } disabled:cursor-not-allowed`}
        >
          {state === 'idle' && <span className="text-2xl">🎤</span>}
          {state === 'recording' && <span className="text-2xl">⏹</span>}
          {state === 'processing' && (
            <svg
              className="w-8 h-8 animate-spin"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12" cy="12" r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          )}
        </button>
      </div>

      {/* Label / timer below the button */}
      <span className="text-xs text-slate-400 text-center min-w-[56px]">
        {state === 'idle' && 'Voice'}
        {state === 'recording' && formatTime(seconds)}
        {state === 'processing' && 'Extracting...'}
      </span>
    </div>
  );
}

export default NewTaskInput;
