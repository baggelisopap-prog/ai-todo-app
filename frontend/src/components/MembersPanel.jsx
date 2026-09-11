import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getWorkspaceMembers, removeWorkspaceMember, leaveWorkspace,
  setWorkspaceNotifyAll, createWorkspaceInvite, inviteLink,
} from '../api';
import Switch from './Switch';

/**
 * Who is in one workspace, and the link that puts somebody else in it.
 *
 * Rendered collapsed inside a WorkspacesView row, because a solo account has
 * exactly one member and should not pay a screenful for it. Opening it is what
 * fetches — a list of workspaces must not become one members request per
 * workspace on every visit to Settings.
 *
 * The invite link appears ONCE. Only a hash of it is stored, so there is no
 * "show it again" to build: the panel keeps it in state until the user leaves,
 * says out loud that it will not be shown again, and offers Copy.
 */
function MembersPanel({ workspace, onShowToast, onChanged }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState(null);
  const [busy, setBusy] = useState(false);
  // The freshly minted link. Deliberately NOT persisted anywhere: it exists in
  // this component's state and nowhere else, which is the honest shape for
  // something the server cannot give back.
  const [freshLink, setFreshLink] = useState(null);

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
      if (successKey) onShowToast?.(t(successKey), 'success');
    } catch (err) {
      onShowToast?.(err.detail || err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleInvite() {
    setBusy(true);
    try {
      const result = await createWorkspaceInvite(workspace.record_id);
      setFreshLink(inviteLink(result.token));
    } catch (err) {
      onShowToast?.(err.detail || err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(freshLink);
      onShowToast?.(t('members.copied'), 'success');
    } catch {
      // Clipboard access can be refused (insecure context, permissions). The
      // link is on screen and selectable, so this is a nuisance, not a failure
      // — say so rather than reporting an error for something that still works.
      onShowToast?.(t('members.copy_failed'), 'error');
    }
  }

  function handleRemove(member) {
    const name = member.display_name || member.email || member.user_id;
    if (!window.confirm(t('members.remove_confirm', { name }))) return;
    run(() => removeWorkspaceMember(workspace.record_id, member.user_id), 'members.removed');
  }

  function handleLeave() {
    if (!window.confirm(t('members.leave_confirm', { name: workspace.name }))) return;
    run(() => leaveWorkspace(workspace.record_id), 'members.left');
  }

  const count = members?.length;

  return (
    <div className="pl-9 pt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="tap-44 text-xs text-[var(--text-secondary)] hover:underline"
        aria-expanded={open}
      >
        {count === undefined ? t('members.title') : t('members.title_count', { count })}
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {members === null && (
            <p className="text-xs text-[var(--text-muted)]">{t('members.loading')}</p>
          )}

          {members?.map((member) => {
            const name = member.display_name || member.email || member.user_id;
            const isMe = member.is_me;
            return (
              <div key={member.user_id} className="flex items-center gap-2">
                <span className="flex-1 min-w-0 truncate text-sm text-[var(--text-primary)]">
                  {name}
                  {member.role === 'owner' && (
                    <span className="ml-1 text-xs text-[var(--text-muted)]">
                      {t('members.owner')}
                    </span>
                  )}
                  {isMe && (
                    <span className="ml-1 text-xs text-[var(--text-muted)]">
                      {t('members.you')}
                    </span>
                  )}
                </span>
                {/* No button for the owner: the backend answers 409 and a
                    button that always fails is worse than no button — the same
                    rule the locked Hostaway category follows. */}
                {isOwner && member.role !== 'owner' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleRemove(member)}
                    className="tap-44 px-2 text-xs text-[var(--danger-text)] hover:underline flex-shrink-0"
                  >
                    {t('members.remove')}
                  </button>
                )}
              </div>
            );
          })}

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

          {isOwner && (
            <button
              type="button"
              disabled={busy}
              onClick={handleInvite}
              className="tap-44 text-xs text-[var(--brand-primary)] hover:underline"
            >
              {t('members.invite')}
            </button>
          )}

          {freshLink && (
            <div className="rounded border border-[var(--border-subtle)] p-2 space-y-1">
              <p className="text-xs text-[var(--text-secondary)]">
                {t('members.link_once')}
              </p>
              <p className="text-xs break-all text-[var(--text-primary)]">{freshLink}</p>
              <button
                type="button"
                onClick={handleCopy}
                className="tap-44 text-xs text-[var(--brand-primary)] hover:underline"
              >
                {t('members.copy')}
              </button>
            </div>
          )}

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
