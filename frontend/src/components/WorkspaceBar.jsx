import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import CustomSelect from './CustomSelect';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { UNFILED } from '../utils/workspaces';
import { ALL, switcherShape, needsFind } from '../utils/taskFilters';

/**
 * The workspace switcher, in the shape the number of workspaces calls for.
 *
 * A row of chips was the owner's choice and it stays the default: switching is
 * one tap and the current position is always visible, for ~40px of height on
 * every screen. But "always visible" is only true while they FIT. Past five,
 * the row scrolls sideways and the selected chip can sit off screen — so the
 * one control whose entire job is showing where you are starts hiding it, and
 * you are filtering by a workspace you cannot see. So:
 *
 *   under two — nothing is drawn. A single chip reading "Όλα" is a control
 *               that cannot do anything, and it would still take that 40px
 *               from every user who never organises anything.
 *   two to five — chips, as before, plus the selected one scrolled into view.
 *   six and up — one menu, with a find box past eight entries.
 *
 * The thresholds live in utils/taskFilters.js as a tested rule rather than
 * here as a number, because the owner's instruction was about users in general
 * and not about his own account: «ανάλογα με τον αριθμό να γίνεται, γτ δεν
 * ξέρω ο κάθε χρήστης πόσα θα έχει».
 */
function WorkspaceBar() {
  const { t } = useTranslation();
  const { workspaces, activeId, setActiveId } = useWorkspaces();

  const shape = switcherShape(workspaces.length);

  // Last, after the real workspaces: it is where anything the AI could not
  // place goes to be found. Without it an unfiled task would only ever be
  // visible mixed into "Όλα".
  const rows = [
    { record_id: null, name: t('workspace.all'), color: null },
    ...workspaces,
    { record_id: UNFILED, name: t('workspace.unfiled'), color: null },
  ];

  if (shape === 'none') return null;

  return (
    // top-14 matches the AppBar's h-14 above it, so the two stack while the
    // page scrolls instead of overlapping.
    <div className="sticky top-14 z-20 bg-[var(--bg-card)] border-b border-[var(--border-subtle)]">
      <div className="max-w-3xl mx-auto px-4 py-2">
        {shape === 'chips'
          ? <WorkspaceChips rows={rows} activeId={activeId} onPick={setActiveId} label={t('workspace.label')} />
          : <WorkspaceMenu rows={rows} activeId={activeId} onPick={setActiveId} label={t('workspace.label')} />}
      </div>
    </div>
  );
}

function WorkspaceChips({ rows, activeId, onPick, label }) {
  const selectedRef = useRef(null);

  // Scroll the selected chip into view — on mount as much as on change. The
  // active workspace is restored from app_settings, so on a phone the app could
  // open already filtered by a chip three positions off the right edge, with
  // the visible chips all looking unselected. A DOM effect, not a state
  // update, so it cannot cascade into another render.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [activeId]);

  return (
    // overflow-x-auto so four or five workspaces scroll sideways rather than
    // wrapping into a second row and pushing the list further down.
    <div className="flex gap-2 overflow-x-auto" role="tablist" aria-label={label}>
      {rows.map((workspace) => {
        const selected = activeId === workspace.record_id;
        return (
          <button
            key={workspace.record_id || 'all'}
            ref={selected ? selectedRef : null}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onPick(workspace.record_id)}
            // The colour is per-workspace DATA, so it cannot be a Tailwind
            // class: those are compiled ahead of time and a runtime hex has
            // no class to match. An inline style is the only option here.
            style={selected && workspace.color
              ? { backgroundColor: workspace.color, borderColor: workspace.color }
              : undefined}
            className={`flex-shrink-0 px-3 py-1 rounded-full border text-sm font-medium transition-colors ${
              selected
                ? 'text-white border-[var(--brand-primary)] bg-[var(--brand-primary)]'
                : 'text-[var(--text-secondary)] border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]'
            }`}
          >
            {workspace.name}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The same switcher as one control, for accounts with too many rooms for a row.
 *
 * `null` is "Όλα" everywhere else in the app, but a select cannot hold null as
 * a value — so it travels as ALL through the menu and is translated back on the
 * way out. The alternative, teaching CustomSelect about null, would put this
 * one screen's vocabulary into every menu in the app.
 */
function WorkspaceMenu({ rows, activeId, onPick, label }) {
  const options = rows.map((row) => ({
    value: row.record_id === null ? ALL : row.record_id,
    label: row.name,
  }));

  return (
    <CustomSelect
      value={activeId === null ? ALL : activeId}
      options={options}
      onChange={(value) => onPick(value === ALL ? null : value)}
      ariaLabel={label}
      searchable={needsFind(options.length)}
    />
  );
}

export default WorkspaceBar;
