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
function Switch({ label, description, checked, onChange, disabled = false, disabledReason }) {
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
          aria-label={label}
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
