import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { extractTasksFromAudio } from '../api';

function MicIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
      <path d="M19 10v2a7 7 0 01-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg className="w-7 h-7 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function formatTime(s) {
  const m = Math.floor(s / 60);
  const secs = s % 60;
  return `${m}:${secs.toString().padStart(2, '0')}`;
}

function VoiceButton({ onComplete }) {
  const { t } = useTranslation();
  const [recordingState, setRecordingState] = useState('idle');
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [voiceError, setVoiceError] = useState(null);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);
  const maxDurationTimerRef = useRef(null);
  const errorTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current.stream?.getTracks().forEach((tr) => tr.stop());
      }
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

  function stopRecording() {
    if (mediaRecorderRef.current?.state === 'recording') {
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

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());

        const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType });
        audioChunksRef.current = [];

        if (audioBlob.size < 1000) {
          setRecordingState('idle');
          showError(t('voice.too_short'));
          return;
        }

        setRecordingState('processing');
        try {
          const result = await extractTasksFromAudio(audioBlob);
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
          stopRecording();
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

  const isProcessing = recordingState === 'processing';

  return (
    <div className="relative flex flex-col items-center gap-1">
      {voiceError && (
        <div className="absolute bottom-full mb-2 right-0 w-52 p-2 rounded-lg border border-red-200 bg-[var(--bg-card)] text-[var(--danger)] text-xs shadow-[var(--shadow-menu)] z-10">
          {voiceError}
        </div>
      )}
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
      <span className="text-xs text-[var(--text-secondary)] text-center min-w-[56px]">
        {recordingState === 'idle' && t('voice.label')}
        {recordingState === 'recording' && formatTime(recordingSeconds)}
        {recordingState === 'processing' && t('voice.processing')}
      </span>
    </div>
  );
}

export default VoiceButton;
