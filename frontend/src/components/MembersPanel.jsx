import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getWorkspaceMembers, removeWorkspaceMember, leaveWorkspace, setWorkspaceNotifyAll,
} from '../api';
import { useMembers } from '../hooks/useMembers';
import { personName } from '../utils/people';
import Switch from './Switch';
import Avatar from './Avatar';
import InvitePanel from './InvitePanel';
import ActivityPanel from './ActivityPanel';

/**
 * Who is in one workspace, and what this person may do about it.
 *
 * Rendered collapsed inside a WorkspacesView row, because a solo account has
 * exactly one member and should not pay a screenful for it. Opening it is what
 * fetches — a list of workspaces must not become one members request per
 * workspace on every visit to Settings.
 *
 * Each member is a FACE, not a line of text. The names in a shared workspace
 * are the same names that appear on task rows and in the activity log, and
 * Avatar derives its colour from the user id — so the person who is teal here
 * is teal everywhere, and recognising them stops depending on reading.
 *
 * Minting and revoking links moved to InvitePanel: "who is here" and "how
 * somebody else gets in" are two jobs, and the second had grown a share dialog.
 */
function MembersPanel({ workspace, onShowToast, onChanged }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState(null);
  const [busy, setBusy] = useState(false);
  // So the avatars on task rows update the moment somebody joins or leaves,
  // rather than at the next full reload of the app.
  const { reload: reloadMembers } = useMembers();

  // `is_me` comes from the server, which already knows who asked. The
  // alternative — reading the session here and comparing ids — is a second
  // source of truth for "who am I" in a component whose whole job is deciding
  // what this person may do.
  const me = members?.find((m) => m.is_me);
  const isOwner = me?.role === 'owner';

  useEffect(() => {
    if (!open || members) return;
    let cancelled = false;
    getWorkspaceMembers(workspace.record_id)
      .then((data) => { if (!cancelled) setMembers(data.members); })
      .catch((err) => { if (!cancelled) onShowToast?.(err.detail || err.message, 'error'); });
    return () => { cancelled = true; };
  }, [open, members, workspace.record_id, onShowToast]);

  // One place that reports failure and refreshes, so no path can leave `busy`
  // stuck on. Mirrors WorkspacesView.run rather than inventing a second idiom.
  async function run(action, successKey) {
    setBusy(true);
    try {
      await action();
      const data = await getWorkspaceMembers(workspace.record_id);
      setMembers(data.members);
      onChanged?.();
      reloadMembers();
      if (successKey) onShowToast?.(t(successKey), 'success');
    } catch (err) {
      onShowToast?.(err.detail || err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  function handleRemove(member) {
    const name = personName(member);
    if (!window.confirm(t('members.remove_confirm', { name }))) return;
    run(() => removeWorkspaceMember(workspace.record_id, member.user_id), 'members.removed');
  }

  function handleLeave() {
    if (!window.confirm(t('members.leave_confirm', { name: workspace.name }))) return;
    run(() => leaveWorkspace(workspace.record_id), 'members.left');
  }

  const count = members?.length;

  return (
    <div className="pt-2 border-t border-[var(--border-subtle)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="tap-44 flex items-center gap-2 w-full text-left text-xs font-medium text-[var(--text-secondary)]"
        aria-expanded={open}
      >
        <span aria-hidden="true" className="text-[10px] text-[var(--text-muted)]">
          {open ? '▾' : '▸'}
        </span>
        {count === undefined ? t('members.title') : t('members.title_count', { count })}
      </button>

      {open && (
        <div className="mt-2 space-y-3">
          {members === null && (
            <p className="text-xs text-[var(--text-muted)]">{t('members.loading')}</p>
          )}

          <div className="space-y-1.5">
            {members?.map((member) => (
              <div key={member.user_id} className="flex items-center gap-2">
                <Avatar member={member} size="md" />
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-sm text-[var(--text-primary)]">
                    {personName(member)}
                  </span>
                  <span className="block text-[11px] text-[var(--text-muted)]">
                    {member.role === 'owner' ? t('members.owner') : t('members.member')}
                    {member.is_me && ` · ${t('members.you')}`}
                  </span>
                </span>
                {/* No button for the owner: the backend answers 409 and a
                    button that always fails is worse than no button — the same
                    rule the locked Hostaway category follows. */}
                {isOwner && member.role !== 'owner' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleRemove(member)}
                    aria-label={`${t('members.remove')} ${personName(member)}`}
                    title={t('members.remove')}
                    className="tap-44 px-2 text-sm text-[var(--danger-text)] hover:underline flex-shrink-0"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>

          {me && (
            <Switch
              label={t('members.notify_all')}
              description={t('members.notify_all_hint')}
              checked={me.notify_all}
              disabled={busy}
              // Switch calls onChange with no argument — the caller flips the
              // value itself. Every other Switch in this codebase does the
              // same; taking a boolean here would be a second idiom.
              onChange={() =>
                run(() => setWorkspaceNotifyAll(workspace.record_id, !me.notify_all))
              }
            />
          )}

          {members && (
            <InvitePanel
              workspace={workspace}
              isOwner={isOwner}
              onShowToast={onShowToast}
            />
          )}

          {members && <ActivityPanel workspace={workspace} members={members} />}

          {members && !isOwner && (
            <button
              type="button"
              disabled={busy}
              onClick={handleLeave}
              className="tap-44 text-xs text-[var(--danger-text)] hover:underline"
            >
              {t('members.leave')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default MembersPanel;
