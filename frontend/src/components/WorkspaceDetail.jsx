import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  updateWorkspace, archiveWorkspace, restoreWorkspace,
  createCategory, updateCategory, deleteCategory,
} from '../api';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { useAppSettings } from '../hooks/useAppSettings';
import { useConfirm } from '../hooks/useConfirm';
import Switch from './Switch';
import MembersPanel from './MembersPanel';
import ColorSwatches from './ColorSwatches';
import ConfirmDialog from './ConfirmDialog';
import KebabMenu from './KebabMenu';
import { AlertCircleIcon } from './icons';
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
  const confirm = useConfirm();
  const [tab, setTab] = useState('general');
  const [busy, setBusy] = useState(false);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  // Closed by default: the danger block is a title and a button, and the full
  // answer to "what does archiving do" opens from the (!) beside it.
  const [archiveHelp, setArchiveHelp] = useState(false);
  // Which category has its palette open. One at a time, and by id rather than a
  // boolean per row, so opening a second one closes the first without any row
  // needing to know about the others.
  const [paletteFor, setPaletteFor] = useState(null);

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

  async function handleArchive() {
    // ARCHIVES, it does not delete — the owner's rule that work is never lost.
    // The dialog says what archiving MEANS rather than quoting a count: the
    // number is not the part you need before deciding.
    const ok = await confirm.ask({
      title: t('workspace.archive_title', { name: workspace.name }),
      body: t('workspace.archive_workspace_confirm', { name: workspace.name }),
      confirmLabel: t('workspace.archive'),
    });
    if (!ok) return;

    // Then an UNDO in the toast. The dialog already asked, so this is not a
    // second gate — it is the one-tap way back for the case a confirmation
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

  async function handleDeleteCategory(category) {
    const ok = await confirm.ask({
      title: t('workspace.delete_category_title', { name: category.name }),
      body: t('workspace.delete_category_confirm', { name: category.name }),
      confirmLabel: t('actions.delete'),
    });
    if (!ok) return;
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

      {/* ONE HEIGHT FOR ALL THREE TABS.
          The modal is sized by its content, so a tab with less in it shrank the
          whole window — and switching from Γενικά to Κατηγορίες made the dialog
          jump up under the finger that had just tapped it. Reported by the
          owner: «όταν πατάς στο κατηγορίες, επειδή δεν έχει τίποτα, όλο το
          παράθυρο είναι πιο μικρό, έτσι φαίνεται άσχημο».

          A floor rather than a fixed height: a room with fifteen categories
          still grows, it just never shrinks below the tallest tab. 340px is
          roughly what Γενικά needs (name, colour, switch, danger block) and
          sits well inside the 85vh the modal is capped at, so it cannot force a
          scrollbar onto a phone that did not have one. */}
      <div className="min-h-[340px]">
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

          <div className="space-y-1.5">
            <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
              {t('workspace.color_label')}
            </span>
            <ColorSwatches
              value={workspace.color}
              disabled={busy}
              label={t('workspace.color_label')}
              onChange={(color) => run(() => updateWorkspace(workspace.record_id, { color }))}
            />
          </div>

          <div className="pt-3 border-t border-[var(--border-subtle)]">
            <Switch
              label={t('workspace.default_switch')}
              description={t('workspace.default_hint')}
              checked={isDefault}
              disabled={busy || !settings}
              onChange={handleToggleDefault}
            />
          </div>

          {/* Its own bordered block at the foot, rather than a red word beside
              the name. The border is what stops it reading as one more setting
              — the shape says "this one is different" before the colour does,
              which is also what keeps it legible to somebody who cannot tell
              red from grey.

              THE EXPLANATION IS BEHIND THE (!), and the reason is that the
              owner read the old one and still had to ask what archiving does.
              Two failures at once: the sentence said what is NOT lost without
              ever saying what HAPPENS, and it sat there permanently, which is
              what he called «χύμα» — a paragraph of small print nobody reads
              until it is too late to matter. Now the block is a title and a
              button, the full answer is one tap away, and the answer leads with
              the consequence: the room disappears for everybody. */}
          <div className="rounded-lg border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 space-y-2">
            <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--danger-text)]">
              {t('workspace.danger_zone')}
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={handleArchive}
                className="tap-44 rounded-lg border border-[var(--danger-border)] bg-[var(--bg-card)] px-3 py-2 text-sm font-medium text-[var(--danger-text)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
              >
                {t('workspace.archive')}
              </button>
              <button
                type="button"
                onClick={() => setArchiveHelp((v) => !v)}
                aria-expanded={archiveHelp}
                aria-label={t('workspace.archive_what')}
                title={t('workspace.archive_what')}
                className="tap-44 rounded-full p-1 text-[var(--danger-text)] hover:bg-[var(--bg-hover)] transition-colors"
              >
                <AlertCircleIcon />
              </button>
            </div>

            {archiveHelp && (
              <p className="text-xs leading-relaxed text-[var(--danger-text)]">
                {t('workspace.archive_hint')}
              </p>
            )}
          </div>
        </div>
      )}

      {tab === 'categories' && (
        <div className="space-y-2">
          {/* The same shape RecurrencesView uses for its empty list, rather
              than the one grey line this had: with the tabs now holding a
              steady height, a single small sentence at the top left the rest of
              the panel reading as a void. */}
          {categories.length === 0 && (
            <div className="py-6 text-center">
              <p className="text-sm text-[var(--text-primary)]">{t('workspace.no_categories')}</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">{t('workspace.no_categories_hint')}</p>
            </div>
          )}

          {categories.map((category) => (
            <div key={category.record_id}>
              <div className="flex items-center gap-2">
                {/* The dot IS the colour control. A row of eight swatches per
                    category would be forty controls on a screen whose question
                    is "what are my categories" — so the palette opens under the
                    one row you tapped, and only that one. */}
                <button
                  type="button"
                  disabled={busy || Boolean(category.system_key)}
                  onClick={() => setPaletteFor((id) => (id === category.record_id ? null : category.record_id))}
                  aria-label={`${t('workspace.change_color')} — ${category.name}`}
                  aria-expanded={paletteFor === category.record_id}
                  className="w-6 h-6 rounded-full flex-shrink-0 disabled:cursor-default"
                  style={{
                    backgroundColor: category.color || 'var(--text-muted)',
                    boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.12)',
                  }}
                />

                {/* No name field and no menu for the Hostaway category: the
                    backend refuses both with a 422 either way, and a control
                    that always fails is worse than no control. */}
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
                      // A border that appears under the pointer and stays while
                      // focused. The field used to be invisible until you
                      // guessed it was one — finding 3 of the eight.
                      className="flex-1 min-w-0 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-[var(--text-primary)] transition-colors hover:border-[var(--border-subtle)] focus:border-[var(--border-focus)] focus:outline-none"
                    />
                    <KebabMenu
                      ariaLabel={`${t('menu.open_menu')} — ${category.name}`}
                      items={[
                        {
                          key: 'color',
                          label: t('workspace.change_color'),
                          onClick: () => setPaletteFor(category.record_id),
                        },
                        {
                          key: 'delete',
                          label: t('actions.delete'),
                          danger: true,
                          separator: true,
                          disabled: busy,
                          onClick: () => handleDeleteCategory(category),
                        },
                      ]}
                    />
                  </>
                )}
              </div>

              {paletteFor === category.record_id && (
                <div className="pl-8 pt-2">
                  <ColorSwatches
                    size="sm"
                    value={category.color}
                    disabled={busy}
                    label={`${t('workspace.color_label')} — ${category.name}`}
                    onChange={(color) => {
                      setPaletteFor(null);
                      run(() => updateCategory(category.record_id, { color }));
                    }}
                  />
                </div>
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
                className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none"
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

      <ConfirmDialog request={confirm.request} onAnswer={confirm.onAnswer} />
    </div>
  );
}

export default WorkspaceDetail;
