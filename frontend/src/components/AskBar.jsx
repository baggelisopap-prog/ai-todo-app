import { useTranslation } from 'react-i18next';
import { ChatIcon, MicIcon } from './icons';
import { isSpeechInputSupported } from '../hooks/useSpeechInput';

/**
 * The phone's standing invitation to ask the agent something.
 *
 * WHY IT IS A FIELD AND NOT A BUTTON. The agent is what this app is for, and
 * it spent its life as a small outlined grey button in the top bar — the
 * corner a thumb reaches last, next to the loudest thing on the screen (the
 * red capture FAB) which merely adds a task. A button asks whether you would
 * like to open something; an open field asks you to write. That difference is
 * the whole point of this component, and it is why the placeholder text is
 * never hidden at any width.
 *
 * It is NOT an <input>. Tapping it opens AgentChatModal, which owns the real
 * conversation, its history and its send button. Two live text fields for one
 * conversation would mean two places to hold a draft and a hand-off to keep in
 * sync between them; a field that is really a door costs one tap and no state.
 *
 * THE MICROPHONE IS A SIBLING, not nested inside the door: a button inside a
 * button is invalid HTML and browsers resolve it by silently dropping one of
 * them (the same rule DictateButton is built around). It opens the same modal
 * and tells it to start listening at once, so dictating a question is one tap
 * from here rather than three. It is absent — not disabled — where the browser
 * has no recognition (Firefox today), because a control must not be present
 * and inert.
 *
 * Rendered only below 1024px, inside the fixed dock App builds with BottomNav.
 * It has no position of its own: the dock is what is pinned, and this simply
 * sits on top of the nav. That is deliberate — the alternative was pinning it
 * "62px from the bottom", a number that depends on the nav's fonts and labels
 * and would break silently the first time either changed.
 */
function AskBar({ onOpen }) {
  const { t } = useTranslation();

  return (
    // The strip around the field carries the page's own background rather than
    // the card's: without an opaque ground the list would be visible sliding
    // through the 6px gaps as it scrolls under the dock.
    <div className="bg-[var(--bg-app)] px-3 pt-1.5 pb-[7px]">
      <div className="h-9 flex items-center gap-2 pl-3 pr-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card)]">
        <button
          type="button"
          onClick={() => onOpen({ dictate: false })}
          // tap-44: the field is 36px tall, which is under the minimum a thumb
          // should be asked to hit. tap-44 grows the region that accepts the
          // tap without moving a single visible pixel.
          className="tap-44 flex-1 min-w-0 h-full flex items-center gap-2 text-left"
        >
          <ChatIcon className="w-4 h-4 shrink-0 text-[var(--brand-primary)]" />
          <span className="min-w-0 truncate text-[13.5px] text-[var(--text-secondary)]">
            {t('agent.bar_placeholder')}
          </span>
        </button>

        {isSpeechInputSupported() && (
          <button
            type="button"
            onClick={() => onOpen({ dictate: true })}
            aria-label={t('agent.ask_by_voice')}
            className="tap-44 shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <MicIcon className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

export default AskBar;
