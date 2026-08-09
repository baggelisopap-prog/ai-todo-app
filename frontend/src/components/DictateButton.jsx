import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSpeechInput, isSpeechInputSupported } from '../hooks/useSpeechInput';
import {
  DICTATION_LANGS,
  resolveDictationLang,
  setDictationLang,
  dictationTagFor,
  dictationLabelFor,
} from '../utils/dictationLang';
import { MicIcon, StopIcon } from './icons';

/**
 * Dictates into a text field, with the language it will listen in shown — and
 * changed — on the button itself.
 *
 * The transcript is handed to the caller to put in the input; it is NOT sent
 * anywhere by itself. This sits on the box that edits a task through the agent,
 * so a misheard word would otherwise become a wrong write to a real task.
 *
 * The language badge started as a label only, which was half a fix: it made a
 * wrong language visible without making it correctable, so the answer to
 * noticing it was "go and find Settings". It is now a button. Two languages
 * means tapping it can simply swap them rather than open a picker — the
 * Settings row still exists for anyone who goes looking there instead.
 *
 * It is a SIBLING of the mic, not nested inside it: a button inside a button is
 * invalid HTML and browsers resolve it by dropping one of them.
 *
 * Renders nothing where the browser has no recognition (Firefox today), rather
 * than a control that cannot work.
 */
function DictateButton({ onTranscript, onError, disabled = false }) {
  const { t, i18n } = useTranslation();
  const [langCode, setLangCode] = useState(() => resolveDictationLang(i18n.resolvedLanguage));

  const { isListening, stop, toggle } = useSpeechInput({
    lang: dictationTagFor(langCode),
    onResult: onTranscript,
    onError,
  });

  if (!isSpeechInputSupported()) return null;

  function cycleLanguage(e) {
    e.stopPropagation();
    const index = DICTATION_LANGS.findIndex((l) => l.code === langCode);
    const next = DICTATION_LANGS[(index + 1) % DICTATION_LANGS.length].code;
    // Stop first: the recogniser's language cannot be changed mid-session, so
    // switching while it listens would leave it hearing the old one.
    if (isListening) stop();
    setDictationLang(next);
    setLangCode(next);
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-label={isListening ? t('voice.stop_dictation') : t('voice.dictating_in', { language: dictationLabelFor(langCode) })}
        aria-pressed={isListening}
        className={`relative w-11 h-11 flex items-center justify-center rounded-md border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          isListening
            ? 'bg-[var(--danger)] border-[var(--danger)] text-white'
            : 'bg-[var(--bg-card)] border-[var(--border-medium)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
        }`}
      >
        {isListening && (
          <span className="absolute inset-0 rounded-md bg-[var(--danger)] opacity-25 animate-ping" />
        )}
        {/* Both icons default to w-7 h-7, sized for the capture FAB. */}
        <span className="relative flex items-center justify-center">
          {isListening ? <StopIcon className="w-5 h-5" /> : <MicIcon className="w-5 h-5" />}
        </span>
      </button>

      <button
        type="button"
        onClick={cycleLanguage}
        disabled={disabled}
        title={t('voice.switch_language')}
        aria-label={t('voice.switch_language')}
        // Sits on the corner of the mic and hangs slightly outside it, so the
        // mic keeps its own centre clear for the tap that matters most.
        className="absolute -bottom-1.5 -right-1.5 px-1 py-0.5 rounded border border-[var(--border-medium)] bg-[var(--bg-card)] text-[10px] font-bold leading-none text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-secondary)] transition-colors disabled:opacity-50"
      >
        {langCode.toUpperCase()}
      </button>
    </div>
  );
}

export default DictateButton;
