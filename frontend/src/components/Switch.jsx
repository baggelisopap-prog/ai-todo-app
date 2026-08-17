/**
 * An on/off switch with a label and, optionally, a line explaining what it does.
 *
 * This exact markup was written out five times in SettingsModal.jsx and was
 * about to be written a sixth and seventh time by the task detail sheet. Five
 * copies of a control is five places for it to drift — and it already had: the
 * copies differed in whether they carried an aria-label at all.
 *
 * `disabledReason` is the interesting prop. The old reminder and calendar
 * buttons rendered at 40% opacity when they could not work but stayed
 * clickable, so the control looked disabled and was not. Here a switch that
 * cannot act is genuinely disabled AND says why, instead of leaving the user to
 * tap it and find out.
 */
// `ariaLabel` is optional and defaults to `label` (`aria-label={ariaLabel ||
// label}`), so every caller written before this prop existed keeps its exact
// behaviour. It exists for the case `label` cannot cover: a row whose
// visible text already names the control (rendered elsewhere, next to the
// switch, not by the switch) still needs a name for a screen reader — and
// passing that same text as `label` here would print it a second time.
function Switch({ label, ariaLabel, description, checked, onChange, disabled = false, disabledReason }) {
  const isDisabled = disabled || Boolean(disabledReason);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className={`text-sm font-medium ${isDisabled ? 'text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}>
          {label}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={ariaLabel || label}
          disabled={isDisabled}
          onClick={onChange}
          className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 disabled:cursor-not-allowed disabled:opacity-50 ${
            checked ? 'bg-[var(--brand-primary)]' : 'bg-[var(--border-subtle)]'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
              checked ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
      {(disabledReason || description) && (
        <p className="text-xs text-[var(--text-muted)] mt-1">{disabledReason || description}</p>
      )}
    </div>
  );
}

export default Switch;
