import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getArchivedWorkspaces, restoreWorkspace } from '../api';

/**
 * The way back from archiving.
 *
 * Archiving replaced deleting on the owner's rule that work is never lost, and
 * until this existed the rule was only half kept: the tasks survived, and the
 * room holding them left every screen in the app. POST /restore worked the
 * whole time — there was simply no screen that could name a workspace to
 * restore, so an archived workspace was unreachable without an API call.
 *
 * Closed by default with the count in the summary, which is the shape Trello
 * uses ("View all closed boards"): out of sight, one tap away, and never
 * confusable with the live list above it. Zero archived rooms renders nothing
 * at all rather than an empty heading — most accounts will never archive
 * anything, and a permanent "Archived (0)" is a question nobody asked.
 */
function ArchivedPanel({ version = 0, onShowToast, onRestored }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [archived, setArchived] = useState(null);
  const [busy, setBusy] = useState(false);

  // Fetched once on mount even while closed, because the COUNT is the thing
  // that decides whether this section is drawn at all — and a heading that
  // appears only after you tap something invisible is not a heading.
  useEffect(() => {
    let cancelled = false;
    getArchivedWorkspaces()
      .then((data) => { if (!cancelled) setArchived(data.workspaces || []); })
      // Silent: this is a section that does not exist on most accounts, and an
      // error toast about one nobody opened would be noise on the Settings
      // screen of every user who has never archived anything.
      .catch(() => { if (!cancelled) setArchived([]); });
    return () => { cancelled = true; };
    // `version` is bumped by the parent when something is archived. Without it
    // the section stays absent until the next visit to Settings — the one
    // moment somebody most wants the way back is the second after they used
    // the button by mistake.
  }, [version]);

  async function handleRestore(workspace) {
    setBusy(true);
    try {
      await restoreWorkspace(workspace.record_id);
      const data = await getArchivedWorkspaces();
      setArchived(data.workspaces || []);
      onRestored?.();
      onShowToast?.(t('workspace.restored'), 'success');
    } catch (err) {
      onShowToast?.(err.detail || err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  function archivedOn(workspace) {
    if (!workspace.archived_at) return '';
    return new Date(workspace.archived_at).toLocaleDateString(
      i18n.language === 'en' ? 'en-GB' : 'el-GR',
      { day: 'numeric', month: 'short', year: 'numeric' }
    );
  }

  if (!archived || archived.length === 0) return null;

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-input)] p-3 space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="tap-44 flex items-center gap-2 w-full text-left text-xs font-medium text-[var(--text-secondary)]"
        aria-expanded={open}
      >
        <span aria-hidden="true" className="text-[10px] text-[var(--text-muted)]">
          {open ? '▾' : '▸'}
        </span>
        {t('workspace.archived_title', { count: archived.length })}
      </button>

      {open && (
        <div className="space-y-2">
          <p className="text-xs text-[var(--text-muted)]">{t('workspace.archived_hint')}</p>
          {archived.map((workspace) => (
            <div key={workspace.record_id} className="flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: workspace.color || 'var(--text-muted)' }}
              />
              <span className="flex-1 min-w-0">
                <span className="block truncate text-sm text-[var(--text-primary)]">
                  {workspace.name}
                </span>
                <span className="block text-[11px] text-[var(--text-muted)]">
                  {t('workspace.archived_on', { date: archivedOn(workspace) })}
                </span>
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleRestore(workspace)}
                className="tap-44 px-2 text-xs font-medium text-[var(--brand-primary)] hover:underline flex-shrink-0"
              >
                {t('workspace.restore')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default ArchivedPanel;
