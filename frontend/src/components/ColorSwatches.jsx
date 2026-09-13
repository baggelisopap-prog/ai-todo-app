import { useTranslation } from 'react-i18next';
import { PALETTE } from '../utils/palette';

/**
 * Eight colours to choose from, instead of the operating system's colour dialog.
 *
 * `<input type="color">` opens the OS picker — a spectrum, a hex field, and on
 * Windows a modal that does not belong to this app. It is the wrong instrument
 * for the question: the colour of a workspace is not an aesthetic decision with
 * sixteen million answers, it is a LABEL that has to be told apart from the
 * other five at a glance and stay readable in both themes. A spectrum lets you
 * pick two blues nobody can distinguish, and a near-white that vanishes on the
 * light theme.
 *
 * A COLOUR ALREADY SAVED THAT IS NOT ONE OF THE EIGHT KEEPS ITS SWATCH. Every
 * workspace and category in the live database was coloured through the old OS
 * picker, so some of them are not on this list — and a palette that showed
 * nothing selected would read as "no colour set" and invite a change nobody
 * asked for. It appears as a ninth swatch, at the front, already selected.
 *
 * The palette itself lives in utils/palette.js: this module exports a component,
 * and a module that exports a component may export nothing else without
 * tripping react-refresh — the same split useWorkspaces.js and useMembers.js
 * already make.
 */
function ColorSwatches({ value, onChange, disabled = false, label, size = 'md' }) {
  const { t } = useTranslation();

  const current = (value || '').toLowerCase();
  const known = PALETTE.some((c) => c.value === current);
  const swatches = current && !known
    ? [{ value: current, key: 'custom' }, ...PALETTE]
    : PALETTE;

  const box = size === 'sm' ? 'w-6 h-6' : 'w-8 h-8';

  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
      {swatches.map((swatch) => {
        const selected = current === swatch.value;
        return (
          <button
            key={swatch.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={t(`color.${swatch.key}`)}
            title={t(`color.${swatch.key}`)}
            disabled={disabled}
            onClick={() => onChange(swatch.value)}
            className={`${box} rounded-full flex-shrink-0 transition-transform disabled:opacity-50 disabled:cursor-not-allowed hover:scale-110`}
            style={{
              backgroundColor: swatch.value,
              // The selected ring is drawn as shadows rather than a border, so
              // choosing a colour never changes the swatch's size and the row
              // does not reflow under the finger that just tapped it.
              boxShadow: selected
                ? '0 0 0 2px var(--bg-card), 0 0 0 4px var(--text-primary)'
                : 'inset 0 0 0 1px rgba(0,0,0,0.12)',
            }}
          />
        );
      })}
    </div>
  );
}

export default ColorSwatches;
