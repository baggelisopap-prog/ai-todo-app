import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getWorkspaceMembers, removeWorkspaceMember, leaveWorkspace, setWorkspaceNotifyAll,
} from '../api';
import { useMembers } from '../hooks/useMembers';
import { useConfirm } from '../hooks/useConfirm';
import { personName } from '../utils/people';
import Switch from './Switch';
import Avatar from './Avatar';
import InvitePanel from './InvitePanel';
import ActivityPanel from './ActivityPanel';
import ConfirmDialog from './ConfirmDialog';
import KebabMenu from './KebabMenu';

/**
 * Who is in one workspace, and what this person may do about it.
 *
 * THE DISCLOSURE IS GONE. This used to render collapsed inside a WorkspacesView
 * row, and opening it is what fetched — the reasoning being that a list of
 * workspaces must not become one members request per workspace on every visit
 * to Settings. That reasoning still holds and is still obeyed; what changed is
 * where the cost is paid. This is now the Μέλη tab of WorkspaceDetail, so it is
 * mounted only when somebody opened ONE workspace and then asked for its
 * people — one request, for the room they are standing in, because they asked.
 * The list screen draws its faces from MembersProvider, which had already
 * fetched them for the task rows.
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
  const { t, i18n } = useTranslation();
  const confirm = useConfirm();
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
    if (members) return undefined;
    let cancelled = false;
    getWorkspaceMembers(workspace.record_id)
      .then((data) => { if (!cancelled) setMembers(data.members); })
      .catch((err) => { if (!cancelled) onShowToast?.(err.detail || err.message, 'error'); });
    return () => { cancelled = true; };
  }, [members, workspace.record_id, onShowToast]);

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

  async function handleRemove(member) {
    const name = personName(member);
    const ok = await confirm.ask({
      title: t('members.remove_title', { name }),
      body: t('members.remove_confirm', { name }),
      confirmLabel: t('members.remove'),
    });
    if (!ok) return;
    run(() => removeWorkspaceMember(workspace.record_id, member.user_id), 'members.removed');
  }

  async function handleLeave() {
    const ok = await confirm.ask({
      title: t('members.leave_title', { name: workspace.name }),
      body: t('members.leave_confirm', { name: workspace.name }),
      confirmLabel: t('members.leave'),
    });
    if (!ok) return;
    run(() => leaveWorkspace(workspace.record_id), 'members.left');
  }

  // The same locale expression ArchivedPanel and ActivityPanel already use.
  // `uiLocale()` in utils/formatDate.js answers a neighbouring question but
  // returns a bare language tag ('el') where these want the regional one
  // ('el-GR'), so it cannot be reused as-is; the triplication is parked in
  // BACKLOG.md rather than fixed here, because the other two components are
  // not part of this work and a date format is not worth touching them for.
  function shortDate(iso) {
    return new Date(iso).toLocaleDateString(
      i18n.language === 'en' ? 'en-GB' : 'el-GR',
      { day: 'numeric', month: 'short' }
    );
  }

  // The second line of a member row: their email, and when they joined.
  //
  // BOTH HAVE BEEN ARRIVING FROM THE SERVER SINCE SHARING SHIPPED and neither
  // was displayed anywhere — `GET /workspaces/{id}/members` returns
  // `email` and `joined_at` on every row. The email is the thing that confirms
  // you invited the right account, which is exactly the question you have while
  // looking at this list.
  //
  // The email is skipped when it is already the name: personName falls back to
  // it when somebody has not set a display name, and a row reading
  // "maria@…  /  maria@…" says nothing twice.
  function detailsOf(member) {
    const parts = [];
    if (member.display_name && member.email) parts.push(member.email);
    if (member.joined_at) parts.push(t('members.joined_on', { date: shortDate(member.joined_at) }));
    return parts.join(' · ');
  }

  return (
    <div className="space-y-3">
      {members === null && (
        <p className="text-xs text-[var(--text-muted)]">{t('members.loading')}</p>
      )}

      <div className="space-y-2">
        {members?.map((member) => (
          <div key={member.user_id} className="flex items-center gap-2.5">
            <Avatar member={member} size="md" />
            <span className="flex-1 min-w-0">
              <span className="block truncate text-sm text-[var(--text-primary)]">
                {personName(member)}
                {member.is_me && (
                  <span className="text-[var(--text-muted)]"> · {t('members.you')}</span>
                )}
              </span>
              {/* Rendered only when there is something in it, so a member with
                  neither a display name nor a join date gets one clean line
                  instead of a blank second one holding the row open. */}
              {detailsOf(member) && (
                <span className="block truncate text-[11px] text-[var(--text-muted)]">
                  {detailsOf(member)}
                </span>
              )}
            </span>

            {/* The role moves off the second line and onto a pill, where the
                other platforms put it: it is a PROPERTY of the person, not a
                description of them, and on the second line it was competing
                with the email for the same space. Both pills share a
                background and differ by weight — the word is what separates
                them, so it still reads for somebody who cannot tell two greys
                apart. */}
            <span
              className={`flex-shrink-0 rounded-full bg-[var(--bg-hover)] px-2 py-0.5 text-[11px] ${
                member.role === 'owner'
                  ? 'font-semibold text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)]'
              }`}
            >
              {member.role === 'owner' ? t('members.owner') : t('members.member')}
            </span>
            {/* Nothing at all for the owner: the backend answers 409, and a
                control that always fails is worse than no control — the same
                rule the locked Hostaway category follows.

                For everybody else this is a ⋯ rather than the ✕ that used to
                sit two pixels from the person's name, permanently armed, in a
                list scrolled with a thumb. */}
            {isOwner && member.role !== 'owner' && (
              <KebabMenu
                ariaLabel={`${t('menu.open_menu')} — ${personName(member)}`}
                items={[
                  {
                    key: 'remove',
                    label: t('members.remove'),
                    danger: true,
                    disabled: busy,
                    onClick: () => handleRemove(member),
                  },
                ]}
              />
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

      <ConfirmDialog request={confirm.request} onAnswer={confirm.onAnswer} />
    </div>
  );
}

export default MembersPanel;
