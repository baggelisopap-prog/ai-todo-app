import { useCallback, useEffect, useRef, useState } from 'react';

function getRecognitionConstructor() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function isSpeechInputSupported() {
  return Boolean(getRecognitionConstructor());
}

/**
 * Speech to TEXT, using the browser's own recognition.
 *
 * Deliberately not the app's existing voice path. `/extract-voice` sends audio
 * to Gemini and comes back with saved TASKS — it is a capture flow, not a
 * transcriber, and there is no way to ask it for the words. Building a second
 * endpoint that does return words would mean a model call (and its cost) on
 * every dictated instruction, on top of the model call the instruction itself
 * already pays for. The browser does this for free.
 *
 * What it costs instead is coverage: this is Chrome, Edge and Safari 14.5+,
 * and not Firefox. `isSpeechInputSupported()` exists so callers can leave the
 * button out entirely rather than show one that cannot work — the same rule as
 * the reminder bell, that a control must not be present and inert.
 *
 * Note that recognition is a network service in Chrome: the audio goes to
 * Google to be transcribed. That is the same trade the platform makes for every
 * site using this API, but it is worth knowing before this is put anywhere more
 * sensitive than a task instruction.
 *
 * `interimResults` is on because a dictation box with nothing in it for three
 * seconds reads as broken. The interim text is replaced, not appended, as the
 * engine revises its guess.
 */
export function useSpeechInput({ lang = 'en-US', onResult, onError } = {}) {
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);
  // Handlers live in a ref so a long-lived recogniser never calls back into a
  // stale closure over the input's value — the caller appends to what is typed.
  // Written in an effect rather than during render, which is the rule for refs
  // and is enforced by react-hooks/refs. No dependency array on purpose: it has
  // to track whatever the latest render passed.
  const handlersRef = useRef({ onResult, onError });
  useEffect(() => {
    handlersRef.current = { onResult, onError };
  });

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Recognition = getRecognitionConstructor();
    if (!Recognition) return;

    // Any previous instance is discarded rather than reused: a recogniser that
    // has already ended cannot be restarted on every browser.
    recognitionRef.current?.abort();

    const recognition = new Recognition();
    recognition.lang = lang;
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onresult = (event) => {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) final += result[0].transcript;
        else interim += result[0].transcript;
      }
      if (final) handlersRef.current.onResult?.(final.trim(), { isFinal: true });
      else if (interim) handlersRef.current.onResult?.(interim.trim(), { isFinal: false });
    };

    recognition.onerror = (event) => {
      // 'aborted' is what stopping deliberately produces, and 'no-speech' is
      // someone changing their mind. Neither is worth a message.
      if (event.error !== 'aborted' && event.error !== 'no-speech') {
        handlersRef.current.onError?.(event.error);
      }
      setIsListening(false);
    };

    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setIsListening(true);
    } catch {
      // start() throws if called while already running; nothing to recover.
      setIsListening(false);
    }
  }, [lang]);

  useEffect(() => () => recognitionRef.current?.abort(), []);

  return { isListening, start, stop, toggle: () => (isListening ? stop() : start()) };
}

export default useSpeechInput;
