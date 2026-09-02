import { useTranslation } from 'react-i18next';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { UNFILED } from '../utils/workspaces';

/**
 * The workspace switcher: a row of chips under the AppBar, "Όλα" first.
 *
 * A row rather than a dropdown in the title, chosen by the owner: switching is
 * one tap and the current position is always visible. It costs ~40px of height
 * on every screen, which is the trade he accepted.
 *
 * Renders NOTHING while there are fewer than two workspaces. A single chip
 * reading "Όλα" is a control that cannot do anything, and it would take that
 * 40px from every screen of every user who never organises anything.
 */
function WorkspaceBar() {
  const { t } = useTranslation();
  const { workspaces, activeId, setActiveId } = useWorkspaces();

  if (workspaces.length < 2) return null;

  // Last, after the real workspaces: it is where anything the AI could not
  // place goes to be found. Without it the old "Unknown" filter would have
  // been removed with nothing in its place, and an unfiled task would only
  // ever be visible mixed into "Όλα".
  const chips = [
    { record_id: null, name: t('workspace.all'), color: null },
    ...workspaces,
    { record_id: UNFILED, name: t('workspace.unfiled'), color: null },
  ];

  return (
    // top-14 matches the AppBar's h-14 above it, so the two stack while the
    // page scrolls instead of overlapping.
    <div className="sticky top-14 z-20 bg-[var(--bg-card)] border-b border-[var(--border-subtle)]">
      {/* overflow-x-auto so four or five workspaces scroll sideways rather than
          wrapping into a second row and pushing the list further down. */}
      <div
        className="max-w-3xl mx-auto flex gap-2 px-4 py-2 overflow-x-auto"
        role="tablist"
        aria-label={t('workspace.label')}
      >
        {chips.map((workspace) => {
          const selected = activeId === workspace.record_id;
          return (
            <button
              key={workspace.record_id || 'all'}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActiveId(workspace.record_id)}
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
    </div>
  );
}

export default WorkspaceBar;
