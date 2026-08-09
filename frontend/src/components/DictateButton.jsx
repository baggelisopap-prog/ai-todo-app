import { useTranslation } from 'react-i18next';
import { useSpeechInput, isSpeechInputSupported } from '../hooks/useSpeechInput';
import { resolveDictationLang, dictationTagFor, dictationLabelFor } from '../utils/dictationLang';
import { MicIcon, StopIcon } from './icons';

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
 *
 * The spoken language does NOT come from the app's UI language — see
 * utils/dictationLang.js for why that was wrong. The label sits on the button
 * so a wrong one is visible before you speak rather than after, which is how
 * the original mistake stayed hidden: Greek through an English recogniser does
 * not fail, it returns confident nonsense.
 */
function DictateButton({ onTranscript, onError, disabled = false, className = '' }) {
  const { t, i18n } = useTranslation();

  const langCode = resolveDictationLang(i18n.resolvedLanguage);
  const { isListening, toggle } = useSpeechInput({
    lang: dictationTagFor(langCode),
    onResult: onTranscript,
    onError,
  });

  if (!isSpeechInputSupported()) return null;

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled}
      title={t('voice.dictating_in', { language: dictationLabelFor(langCode) })}
      aria-label={
        isListening
          ? t('voice.stop_dictation')
          : t('voice.dictating_in', { language: dictationLabelFor(langCode) })
      }
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
      {/* Which language it will listen in, on the button. Two characters is
          enough to notice it is wrong, and noticing beforehand is the point. */}
      <span className="absolute -bottom-0.5 -right-0.5 px-0.5 rounded text-[8px] font-bold leading-tight bg-[var(--bg-app)] text-[var(--text-secondary)]">
        {langCode.toUpperCase()}
      </span>
    </button>
  );
}

export default DictateButton;
