import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  createWorkspace, updateWorkspace, deleteWorkspace,
  createCategory, updateCategory, deleteCategory,
} from '../api';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { useAppSettings } from '../hooks/useAppSettings';
import CustomSelect from './CustomSelect';
import { nextPosition } from '../utils/workspaces';

/**
 * Create, rename and delete workspaces and the categories inside them.
 *
 * Two levels in ONE screen rather than a drill-down: a workspace with three
 * categories is a four-line block, and hiding those three behind another tap
 * makes the one question the user actually has — "what have I got?" — cost a
 * tap per workspace to answer.
 *
 * The Hostaway category renders with no name field and no delete button. The
 * backend refuses both with a 422 either way (main.py's category routes); not
 * offering the action is the point, because a button that always fails is
 * worse than no button.
 *
 * Modelled on RecurrencesView — same bordered bg-input card per row, same
 * toast calls — so Settings keeps one idiom instead of growing a second.
 */
function WorkspacesView({ onShowToast }) {
  const { t } = useTranslation();
  const { workspaces, reload, categoriesFor } = useWorkspaces();
  const { settings, updateSettings } = useAppSettings();
  const [busy, setBusy] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [newCategoryFor, setNewCategoryFor] = useState(null); // workspace_id
  const [newCategoryName, setNewCategoryName] = useState('');

  // Every write goes through here: one place that reports failure, reloads the
  // shared copy so the chip row updates too, and cannot leave `busy` stuck on
  // if the call throws.
  async function run(action, successKey) {
    setBusy(true);
    try {
      await action();
      await reload();
      if (successKey) onShowToast?.(t(successKey), 'success');
    } catch (err) {
      // 409 is the one failure the user can act on, so it gets its own words
      // rather than the raw server sentence.
      const message = String(err.message || '').includes('409')
        ? t('workspace.name_taken')
        : err.message;
      onShowToast?.(message, 'error');
    } finally {
      setBusy(false);
    }
  }

  function handleDeleteWorkspace(workspace) {
    // The affected count comes back FROM the delete, so the confirmation cannot
    // quote it. It states what will happen instead — that the tasks survive —
    // which is the part the user needs before clicking, not the number.
    if (!window.confirm(t('workspace.delete_workspace_confirm', { name: workspace.name }))) return;
    run(() => deleteWorkspace(workspace.record_id), 'workspace.deleted');
  }

  function handleDeleteCategory(category) {
    if (!window.confirm(t('workspace.delete_category_confirm', { name: category.name }))) return;
    run(() => deleteCategory(category.record_id), 'workspace.deleted');
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--text-secondary)]">{t('workspace.manage_hint')}</p>

      {/* Which vocabulary the extractor is given when the user is on "Όλα".
          A second setting beside the switcher, not a reuse of it: "where am I
          looking" and "whose category names should the model see" are
          different questions, and "Όλα" cannot answer the second — the model
          must never be handed several workspaces and asked to guess. */}
      {workspaces.length > 0 && (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-input)] p-3 space-y-1">
          <span className="text-xs text-[var(--text-secondary)] font-medium uppercase tracking-wide block">
            {t('workspace.default_label')}
          </span>
          <CustomSelect
            compact
            value={settings?.default_workspace_id || ''}
            options={[
              { value: '', label: t('workspace.unfiled') },
              ...workspaces.map((w) => ({ value: w.record_id, label: w.name })),
            ]}
            onChange={(value) =>
              updateSettings({ default_workspace_id: value || null })?.catch?.(
                (err) => onShowToast?.(err.message, 'error')
              )
            }
            ariaLabel={t('workspace.default_label')}
          />
          <p className="text-xs text-[var(--text-muted)]">{t('workspace.default_hint')}</p>
        </div>
      )}

      {workspaces.map((workspace) => {
        const categories = categoriesFor(workspace.record_id);
        return (
          <div
            key={workspace.record_id}
            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-input)] p-3 space-y-2"
          >
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={workspace.color || '#888888'}
                disabled={busy}
                onChange={(e) => run(() => updateWorkspace(workspace.record_id, { color: e.target.value }))}
                className="w-7 h-7 rounded border-0 bg-transparent flex-shrink-0"
                aria-label={`${workspace.name} — ${t('workspace.label')}`}
              />
              <input
                type="text"
                defaultValue={workspace.name}
                disabled={busy}
                // onBlur, not onChange: a PATCH per keystroke would be one
                // request per letter, and each half-typed name can 409.
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  if (name && name !== workspace.name) {
                    run(() => updateWorkspace(workspace.record_id, { name }), 'workspace.saved');
                  }
                }}
                className="flex-1 min-w-0 bg-transparent text-[var(--text-primary)] font-medium focus:outline-none"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => handleDeleteWorkspace(workspace)}
                className="tap-44 px-2 text-sm text-[var(--danger-text)] hover:underline flex-shrink-0"
              >
                {t('workspace.remove')}
              </button>
            </div>

            <div className="pl-9 space-y-1">
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
                    className="w-5 h-5 rounded border-0 bg-transparent flex-shrink-0"
                    aria-label={`${category.name} — ${t('workspace.category_label')}`}
                  />
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

              {newCategoryFor === workspace.record_id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const name = newCategoryName.trim();
                    if (!name) return;
                    setNewCategoryName('');
                    setNewCategoryFor(null);
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
                    onBlur={() => { if (!newCategoryName.trim()) setNewCategoryFor(null); }}
                    className="w-full bg-[var(--bg-card)] rounded px-2 py-1 text-sm border border-[var(--border-subtle)] focus:outline-none"
                  />
                </form>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setNewCategoryFor(workspace.record_id)}
                  className="tap-44 text-xs text-[var(--brand-primary)] hover:underline"
                >
                  + {t('workspace.new_category')}
                </button>
              )}
            </div>
          </div>
        );
      })}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const name = newWorkspaceName.trim();
          if (!name) return;
          setNewWorkspaceName('');
          run(() => createWorkspace({ name, position: nextPosition(workspaces) }), 'workspace.saved');
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          value={newWorkspaceName}
          placeholder={t('workspace.new_workspace')}
          onChange={(e) => setNewWorkspaceName(e.target.value)}
          className="flex-1 min-w-0 bg-[var(--bg-input)] rounded-lg px-3 py-2 text-sm border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !newWorkspaceName.trim()}
          className="tap-44 px-4 rounded-lg bg-[var(--brand-primary)] text-white text-sm font-medium disabled:opacity-50"
          aria-label={t('workspace.new_workspace')}
        >
          +
        </button>
      </form>
    </div>
  );
}

export default WorkspacesView;
