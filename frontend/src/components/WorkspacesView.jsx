import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createWorkspace } from '../api';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { useMembers } from '../hooks/useMembers';
import { useAppSettings } from '../hooks/useAppSettings';
import Avatar from './Avatar';
import ArchivedPanel from './ArchivedPanel';
import { nextPosition } from '../utils/workspaces';

/**
 * The list of workspaces: one row each, and a way in.
 *
 * THIS USED TO BE THE WHOLE SCREEN. Every workspace rendered its name, its
 * colour, its categories, a collapsed members panel, an invite panel, an
 * activity panel and an archive button in one scrolling column — six jobs in
 * one card, five levels of nesting, and the question most visits actually ask
 * ("who is in here?") three taps deep with no face visible before any of them.
 * The two levels are now two screens: this one, and WorkspaceDetail.
 *
 * The old comment defending one screen said hiding three categories behind
 * another tap makes "what have I got?" cost a tap per workspace. That was
 * right about the question and wrong about the answer: the row now CARRIES the
 * answer — how many categories, whether it is the default, and who is in it —
 * so nothing has to be opened to see it, which the old card could not manage
 * even while showing everything.
 *
 * THE FACES COST NOTHING, and that is the only reason they are here.
 * MembersProvider already holds the members of every SHARED workspace, fetched
 * once for the avatars on task rows, and `member_count` rides along with the
 * workspaces themselves. So this list adds zero requests: `isShared` is
 * answered from a count that was already on hand, and a solo account — where
 * the only member is you, and your own initials three times over are noise —
 * fetches nothing and draws nothing.
 */
function WorkspacesView({ onShowToast, onOpen }) {
  const { t } = useTranslation();
  const { workspaces, reload, categoriesFor } = useWorkspaces();
  const { settings } = useAppSettings();
  const { membersFor, isShared } = useMembers();
  const [busy, setBusy] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  // Bumped when a workspace is restored from the archive, so that section
  // refetches instead of waiting for the next visit to Settings. Archiving
  // itself happens on the detail screen, which unmounts this one — coming back
  // remounts it, and ArchivedPanel fetches on mount.
  const [archivedVersion, setArchivedVersion] = useState(0);

  async function handleCreate(e) {
    e.preventDefault();
    const name = newWorkspaceName.trim();
    if (!name) return;
    setNewWorkspaceName('');
    setBusy(true);
    try {
      await createWorkspace({ name, position: nextPosition(workspaces) });
      await reload();
      onShowToast?.(t('workspace.saved'), 'success');
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

  // What the row says under the name. Singular and plural are separate keys
  // rather than an i18next plural suffix, because that is what this project
  // already does everywhere else (toast.added_one beside toast.added_many) and
  // one key quietly relying on the library's rules would be a second idiom
  // hiding in the locale file.
  function subtitleFor(workspace) {
    const count = categoriesFor(workspace.record_id).length;
    const parts = [
      count === 0 ? t('workspace.cat_count_none')
        : count === 1 ? t('workspace.cat_count_one')
          : t('workspace.cat_count_many', { count }),
    ];
    if (settings?.default_workspace_id === workspace.record_id) {
      parts.push(t('workspace.default_badge'));
    }
    return parts.join(' · ');
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--text-secondary)]">{t('workspace.manage_hint')}</p>

      {/* No empty card when there is nothing in it. Every account is furnished
          with Business + Personal on creation, so this is the one-second gap
          before the first fetch lands rather than a state anybody lives in —
          and an empty bordered box reads as something being broken. */}
      {workspaces.length > 0 && (
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] overflow-hidden divide-y divide-[var(--border-subtle)]">
        {workspaces.map((workspace) => (
          <button
            key={workspace.record_id}
            type="button"
            onClick={() => onOpen(workspace.record_id)}
            className="w-full flex items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-[var(--bg-hover)]"
          >
            <span
              aria-hidden="true"
              className="w-7 h-7 rounded-md flex-shrink-0"
              style={{ backgroundColor: workspace.color || 'var(--text-muted)' }}
            />
            <span className="flex-1 min-w-0">
              <span className="block truncate text-sm font-medium text-[var(--text-primary)]">
                {workspace.name}
              </span>
              <span className="block truncate text-xs text-[var(--text-muted)]">
                {subtitleFor(workspace)}
              </span>
            </span>
            {isShared(workspace.record_id) && (
              <MemberStack members={membersFor(workspace.record_id)} />
            )}
            <ChevronIcon />
          </button>
        ))}
      </div>
      )}

      <form onSubmit={handleCreate} className="flex gap-2">
        <input
          type="text"
          value={newWorkspaceName}
          placeholder={t('workspace.new_workspace')}
          onChange={(e) => setNewWorkspaceName(e.target.value)}
          className="flex-1 min-w-0 bg-[var(--bg-input)] rounded-lg px-3 py-2 text-sm border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-focus)]"
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

      <ArchivedPanel
        version={archivedVersion}
        onShowToast={onShowToast}
        onRestored={() => { reload(); setArchivedVersion((v) => v + 1); }}
      />
    </div>
  );
}

/**
 * Up to three faces and then a count.
 *
 * Overlapped rather than spaced, which is the shape Trello and Figma both
 * settled on: it reads as ONE group at a glance instead of as three separate
 * things, and it stays the same width whether a room has three people or
 * eleven. The ring is the card's own background, so the circles cut into each
 * other cleanly on either theme — as an inline boxShadow rather than a Tailwind
 * ring class, because the colour has to come from the token and be certain to
 * survive the build.
 */
function MemberStack({ members }) {
  const shown = members.slice(0, 3);
  const extra = members.length - shown.length;
  if (shown.length === 0) return null;

  const ring = { boxShadow: '0 0 0 2px var(--bg-card)' };

  return (
    <span className="flex items-center flex-shrink-0">
      {/* The ring goes on a wrapper rather than on Avatar itself: Avatar takes
          no style prop, and giving it one so that a list row can draw a border
          would push a caller's layout concern into a component every screen
          shares. */}
      {shown.map((member, index) => (
        <span
          key={member.user_id}
          style={ring}
          className={`rounded-full flex flex-shrink-0 ${index > 0 ? '-ml-2' : ''}`}
        >
          <Avatar member={member} size="sm" />
        </span>
      ))}
      {extra > 0 && (
        <span
          style={ring}
          className="-ml-2 w-6 h-6 rounded-full bg-[var(--bg-hover)] text-[10px] font-semibold text-[var(--text-secondary)] flex items-center justify-center flex-shrink-0"
        >
          +{extra}
        </span>
      )}
    </span>
  );
}

function ChevronIcon() {
  return (
    <svg
      width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className="text-[var(--text-muted)] flex-shrink-0"
      aria-hidden="true"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

export default WorkspacesView;
