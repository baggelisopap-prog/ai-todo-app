import { useTranslation } from 'react-i18next';
import { useSpeechInput, isSpeechInputSupported } from '../hooks/useSpeechInput';
import { MicIcon, StopIcon } from './icons';

// The recogniser wants a full BCP-47 tag, while i18n carries only the language.
const RECOGNITION_LANGS = { el: 'el-GR', en: 'en-US' };

/**
 * Dictates into a text field.
 *
 * The transcript is handed to the caller to put in the input — it is NOT sent
 * anywhere by itself. That matters here specifically: this sits on the box that
 * edits a task through the agent, so a misheard word would otherwise become a
 * wrong write to a real task. Seeing the words before pressing send is the
 * whole safeguard, and it costs one glance.
 *
 * Renders nothing at all where the browser has no recognition (Firefox today),
 * rather than a button that cannot work.
 */
function DictateButton({ onTranscript, onError, disabled = false, className = '' }) {
  const { t, i18n } = useTranslation();

  const lang = RECOGNITION_LANGS[i18n.resolvedLanguage?.slice(0, 2)] || 'en-US';
  const { isListening, toggle } = useSpeechInput({
    lang,
    onResult: onTranscript,
    onError,
  });

  if (!isSpeechInputSupported()) return null;

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled}
      aria-label={isListening ? t('voice.stop_dictation') : t('voice.dictate')}
      aria-pressed={isListening}
      className={`relative w-10 h-10 flex items-center justify-center rounded-md border transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed ${
        isListening
          ? 'bg-[var(--danger)] border-[var(--danger)] text-white'
          : 'bg-[var(--bg-card)] border-[var(--border-medium)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
      } ${className}`}
    >
      {isListening && (
        <span className="absolute inset-0 rounded-md bg-[var(--danger)] opacity-25 animate-ping" />
      )}
      {/* Both icons default to w-7 h-7, which is sized for the capture FAB and
          overflows a 40px button. */}
      <span className="relative flex items-center justify-center">
        {isListening ? <StopIcon className="w-4 h-4" /> : <MicIcon className="w-4 h-4" />}
      </span>
    </button>
  );
}

export default DictateButton;
