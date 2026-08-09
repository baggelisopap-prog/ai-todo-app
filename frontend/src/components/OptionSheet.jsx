import { useTranslation } from 'react-i18next';
import { CheckIcon } from './TaskIcons';

/**
 * Pick one of a handful of options.
 *
 * This is the deliberate exception to "settings open in a sub-screen". Language
 * has two options and Appearance has three; pushing a whole screen to show two
 * buttons is a tap to get in, a tap to choose and a tap to get back, for a
 * choice that fits in a thumb's reach. The row above it already shows the
 * current value, which was the actual problem with the old accordions, so the
 * screen would have bought nothing.
 *
 * Anything with more than a few options, or with anything to explain, belongs
 * in a sub-screen instead — that is where Notifications and Calendar went.
 */
function OptionSheet({ title, options, value, onPick, onClose }) {
  const { t } = useTranslation();

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 animate-fade-in flex items-end md:items-center justify-center md:p-4"
      onClick={onClose}
    >
      <div
        className="w-full md:max-w-xs bg-[var(--bg-modal)] md:rounded-lg rounded-t-2xl shadow-[var(--shadow-modal)] p-2"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <p className="px-4 pt-2 pb-1 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
          {title}
        </p>
        {options.map((option) => {
          const isSelected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={isSelected}
              onClick={() => onPick(option.value)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-md hover:bg-[var(--bg-hover)] text-left"
            >
              <span className={`flex-1 text-sm ${isSelected ? 'text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)]'}`}>
                {option.label}
              </span>
              {/* The tick, not a coloured row: the selection has to survive
                  someone who cannot tell the two shades apart. */}
              {isSelected && <CheckIcon className="w-3.5 h-3.5 text-[var(--brand-primary)]" />}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onClose}
          className="w-full px-4 py-3 mt-1 rounded-md text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
        >
          {t('actions.cancel')}
        </button>
      </div>
    </div>
  );
}

export default OptionSheet;
