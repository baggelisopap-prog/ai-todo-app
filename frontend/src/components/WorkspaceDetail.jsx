import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  updateWorkspace, archiveWorkspace, restoreWorkspace,
  createCategory, updateCategory, deleteCategory,
} from '../api';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { useAppSettings } from '../hooks/useAppSettings';
import Switch from './Switch';
import MembersPanel from './MembersPanel';
import { nextPosition } from '../utils/workspaces';

const TABS = ['general', 'categories', 'members'];
const TAB_LABELS = {
  general: 'workspace.tab_general',
  categories: 'workspace.tab_categories',
  members: 'workspace.tab_members',
};

/**
 * One workspace, on its own screen, split into the three things it actually is.
 *
 * WHY THREE TABS AND NOT ONE LONGER PAGE. What a workspace holds are three
 * unrelated jobs that happen to share an owner: what it is called and looks
 * like, what categories live in it, and who is in it. They are visited for
 * different reasons and almost never in the same minute — and stacked in one
 * column the third one (people) sat below however many categories the room had,
 * which is how it ended up behind a disclosure in the first place.
 *
 * THE WORKSPACE IS LOOKED UP BY ID, not passed in as an object. A copy handed
 * down at open time goes stale the moment the name or colour is edited here,
 * and the header above this screen reads that name. Looking it up also gives
 * the disappearance case for free: archived here, or archived by somebody else
 * in the other window this owner keeps open, and the row is simply gone — so
 * the screen leaves rather than rendering a workspace that no longer exists.
 */
function WorkspaceDetail({ workspaceId, onShowToast, onBack }) {
  const { t } = useTranslation();
  const { workspaces, reload, categoriesFor } = useWorkspaces();
  const { settings, updateSettings } = useAppSettings();
  const [tab, setTab] = useState('general');
  const [busy, setBusy] = useState(false);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');

  const workspace = workspaces.find((w) => w.record_id === workspaceId);

  // Gone — archived from here, or from the owner's other session. Leaving is
  // the only honest thing: there is nothing left to show and nothing to edit.
  useEffect(() => {
    if (!workspace) onBack();
  }, [workspace, onBack]);

  if (!workspace) return null;

  const categories = categoriesFor(workspace.record_id);
  const isDefault = settings?.default_workspace_id === workspace.record_id;

  // Every write goes through here: one place that reports failure, reloads the
  // shared copy so the room picker in the app bar updates too, and cannot leave
  // `busy` stuck on if the call throws.
  async function run(action, successKey) {
    setBusy(true);
    try {
      await action();
      await reload();
      if (successKey) onShowToast?.(t(successKey), 'success');
    } catch (err) {
      const message = String(err.message || '').includes('409')
        ? t('workspace.name_taken')
        : err.message;
      onShowToast?.(message, 'error');
    } finally {
      setBusy(false);
    }
  }

  function handleArchive() {
    // ARCHIVES, it does not delete — the owner's rule that work is never lost.
    // The confirmation says what archiving MEANS rather than quoting a count:
    // the number is not the part you need before clicking.
    if (!window.confirm(t('workspace.archive_workspace_confirm', { name: workspace.name }))) return;

    // Then an UNDO in the toast. The confirmation already asked, so this is not
    // a second gate — it is the one-tap way back for the case a confirmation
    // cannot catch: the right answer given about the wrong room.
    setBusy(true);
    archiveWorkspace(workspace.record_id)
      .then(async () => {
        await reload();
        onShowToast?.({
          message: t('workspace.archived'),
          variant: 'success',
          // Longer than the default 3s: an undo nobody has time to read is a
          // toast with a decoration on it.
          duration: 8000,
          action: {
            label: t('workspace.undo'),
            onClick: () => {
              restoreWorkspace(workspace.record_id)
                .then(() => reload())
                .catch((err) => onShowToast?.(err.detail || err.message, 'error'));
            },
          },
        });
        onBack();
      })
      .catch((err) => onShowToast?.(err.detail || err.message, 'error'))
      .finally(() => setBusy(false));
  }

  function handleDeleteCategory(category) {
    if (!window.confirm(t('workspace.delete_category_confirm', { name: category.name }))) return;
    run(() => deleteCategory(category.record_id), 'workspace.deleted');
  }

  function handleToggleDefault() {
    // A switch rather than the picker this replaced, and the two ends are the
    // picker's own two answers: this workspace, or «Ακατάτακτες» — which is
    // what `default_workspace_id = null` has always meant. Turning it on here
    // therefore turns it off wherever it was, without a second control saying
    // so, which is why the list row carries the badge.
    updateSettings({ default_workspace_id: isDefault ? null : workspace.record_id })
      ?.catch?.((err) => onShowToast?.(err.message, 'error'));
  }

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label={t('workspace.manage')} className="flex gap-1 p-1 rounded-lg bg-[var(--bg-hover)]">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
            className={`flex-1 rounded-md py-2 px-2 text-sm font-medium transition-colors ${
              tab === name
                ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-[var(--shadow-card)]'
                : 'text-[var(--text-secondary)]'
            }`}
          >
            {t(TAB_LABELS[name])}
          </button>
        ))}
      </div>

      {tab === 'general' && (
        <div className="space-y-4">
          <label className="block space-y-1.5">
            <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
              {t('workspace.name_label')}
            </span>
            <input
              type="text"
              defaultValue={workspace.name}
              disabled={busy}
              // onBlur, not onChange: a PATCH per keystroke would be one request
              // per letter, and each half-typed name can 409.
              onBlur={(e) => {
                const name = e.target.value.trim();
                if (name && name !== workspace.name) {
                  run(() => updateWorkspace(workspace.record_id, { name }), 'workspace.saved');
                }
              }}
              className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-focus)]"
            />
          </label>

          <label className="flex items-center gap-3">
            <input
              type="color"
              value={workspace.color || '#888888'}
              disabled={busy}
              onChange={(e) => run(() => updateWorkspace(workspace.record_id, { color: e.target.value }))}
              className="w-9 h-9 rounded border-0 bg-transparent flex-shrink-0"
              aria-label={t('workspace.color_label')}
            />
            <span className="text-sm text-[var(--text-primary)]">{t('workspace.color_label')}</span>
          </label>

          <div className="pt-3 border-t border-[var(--border-subtle)]">
            <Switch
              label={t('workspace.default_switch')}
              description={t('workspace.default_hint')}
              checked={isDefault}
              disabled={busy || !settings}
              onChange={handleToggleDefault}
            />
          </div>

          <div className="pt-3 border-t border-[var(--border-subtle)]">
            <button
              type="button"
              disabled={busy}
              onClick={handleArchive}
              className="tap-44 w-full text-left px-3 py-2 rounded-md text-sm text-[var(--danger)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
            >
              {t('workspace.archive')}
            </button>
            <p className="mt-1 px-3 text-xs text-[var(--text-muted)]">
              {t('workspace.archive_hint')}
            </p>
          </div>
        </div>
      )}

      {tab === 'categories' && (
        <div className="space-y-2">
          {categories.length === 0 && (
            <p className="text-xs text-[var(--text-muted)]">{t('workspace.no_categories')}</p>
          )}

          {categories.map((category) => (
            <div key={category.record_id} className="flex items-center gap-2">
              <input
                type="color"
                value={category.color || '#888888'}
                disabled={busy}
                onChange={(e) => run(() => updateCategory(category.record_id, { color: e.target.value }))}
                className="w-6 h-6 rounded border-0 bg-transparent flex-shrink-0"
                aria-label={`${category.name} — ${t('workspace.category_label')}`}
              />
              {/* No name field and no delete for the Hostaway category: the
                  backend refuses both with a 422 either way, and a button that
                  always fails is worse than no button. */}
              {category.system_key ? (
                <span
                  className="flex-1 min-w-0 truncate text-sm text-[var(--text-secondary)]"
                  title={t('workspace.system_locked')}
                >
                  {category.name} 🔒
                </span>
              ) : (
                <>
                  <input
                    type="text"
                    defaultValue={category.name}
                    disabled={busy}
                    onBlur={(e) => {
                      const name = e.target.value.trim();
                      if (name && name !== category.name) {
                        run(() => updateCategory(category.record_id, { name }), 'workspace.saved');
                      }
                    }}
                    className="flex-1 min-w-0 bg-transparent text-sm text-[var(--text-primary)] focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleDeleteCategory(category)}
                    className="tap-44 px-2 text-xs text-[var(--danger-text)] hover:underline flex-shrink-0"
                    aria-label={`${t('workspace.remove')} ${category.name}`}
                  >
                    ✕
                  </button>
                </>
              )}
            </div>
          ))}

          {addingCategory ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const name = newCategoryName.trim();
                if (!name) return;
                setNewCategoryName('');
                setAddingCategory(false);
                run(() => createCategory({
                  workspace_id: workspace.record_id,
                  name,
                  position: nextPosition(categories),
                }), 'workspace.saved');
              }}
            >
              <input
                autoFocus
                type="text"
                value={newCategoryName}
                placeholder={t('workspace.name_placeholder')}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onBlur={() => { if (!newCategoryName.trim()) setAddingCategory(false); }}
                className="w-full bg-[var(--bg-card)] rounded px-2 py-1 text-sm border border-[var(--border-subtle)] focus:outline-none"
              />
            </form>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => setAddingCategory(true)}
              className="tap-44 text-xs text-[var(--brand-primary)] hover:underline"
            >
              + {t('workspace.new_category')}
            </button>
          )}
        </div>
      )}

      {tab === 'members' && (
        <MembersPanel
          workspace={workspace}
          onShowToast={onShowToast}
          onChanged={reload}
        />
      )}
    </div>
  );
}

export default WorkspaceDetail;
