import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  createWorkspaceInvite, getWorkspaceInvites, revokeWorkspaceInvite, inviteLink,
} from '../api';
import { useConfirm } from '../hooks/useConfirm';
import ConfirmDialog from './ConfirmDialog';

/**
 * Minting an invitation link, handing it to somebody, and taking it back.
 *
 * SPLIT OUT OF MembersPanel, which was doing two jobs: who is in the room, and
 * how somebody else gets in. They change for different reasons, and one of
 * them had grown a share dialog.
 *
 * THE LINK IS A KEY. Only its hash is stored (the same standard as the
 * Hostaway secret), so there is no "show it again" to build and nothing here
 * can recover one. That is also why the pending list is a hole being closed
 * rather than a nicety: before it existed, minting a link and closing the panel
 * left a working seven-day key to the workspace in circulation that its owner
 * could neither see nor revoke.
 *
 * The share row follows the shape every messaging app settled on — copy, the
 * operating system's own share sheet, and one named destination.
 * navigator.share is the good path where it exists: it is how a link reaches
 * WhatsApp on a phone without anybody pasting anything. It is absent on
 * Firefox with no plans for it, so it is offered only when the browser
 * actually has it, and the other two are always there.
 */
function InvitePanel({ workspace, isOwner, onShowToast }) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [invites, setInvites] = useState(null);
  // The freshly minted link. Deliberately NOT persisted anywhere: it lives in
  // this component's state and nowhere else, which is the honest shape for
  // something the server cannot give back.
  const [freshLink, setFreshLink] = useState(null);

  // Only the owner may mint or revoke, so only the owner is shown the list. A
  // member would get a panel of things they cannot act on.
  useEffect(() => {
    if (!isOwner) return undefined;
    let cancelled = false;
    getWorkspaceInvites(workspace.record_id)
      .then((data) => { if (!cancelled) setInvites(data.invites || []); })
      .catch(() => { if (!cancelled) setInvites([]); });
    return () => { cancelled = true; };
  }, [isOwner, workspace.record_id]);

  async function refresh() {
    try {
      const data = await getWorkspaceInvites(workspace.record_id);
      setInvites(data.invites || []);
    } catch {
      // The list is a convenience beside an action that already reported its
      // own outcome. A second error toast for the refresh would blame the
      // action for something that worked.
    }
  }

  async function handleInvite() {
    // ASKS FIRST. Pressing this button used to mint a key on the spot: a
    // working seven-day pass to the whole workspace, created by a tap whose
    // label said only «Πρόσκληση». The dialog is not a safety gate — you can
    // revoke it — it is the sentence that tells you what the button is about
    // to make, before it exists.
    const ok = await confirm.ask({
      title: t('members.invite_title', { name: workspace.name }),
      body: t('members.invite_explain'),
      confirmLabel: t('members.invite_create'),
      danger: false,
    });
    if (!ok) return;

    setBusy(true);
    try {
      const result = await createWorkspaceInvite(workspace.record_id);
      setFreshLink(inviteLink(result.token));
      await refresh();
    } catch (err) {
      onShowToast?.(err.detail || err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(invite) {
    const ok = await confirm.ask({
      title: t('members.revoke_title'),
      body: t('members.revoke_confirm'),
      confirmLabel: t('members.revoke'),
    });
    if (!ok) return;
    setBusy(true);
    try {
      await revokeWorkspaceInvite(workspace.record_id, invite.id);
      // Whether the link still on screen is the one just revoked cannot be
      // known here — the token is not in the invite row — so the safe reading
      // is that it might be, and a dead link left on screen invites sending it.
      setFreshLink(null);
      await refresh();
      onShowToast?.(t('members.revoked'), 'success');
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

  const shareText = t('members.share_text', { name: workspace.name });
  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(`${shareText}\n${freshLink}`)}`;

  async function handleShare() {
    try {
      await navigator.share({ title: workspace.name, text: shareText, url: freshLink });
    } catch {
      // Includes the user simply closing the sheet, which is not a failure and
      // must not be reported as one. Copy and WhatsApp are both still on screen.
    }
  }

  // Live links only. A used or revoked one is history, and the question this
  // list answers is "what can still let somebody in", not "what happened".
  const pending = (invites || []).filter(
    (i) => !i.accepted_at && !i.revoked_at && new Date(i.expires_at) > new Date()
  );

  function daysLeft(invite) {
    const ms = new Date(invite.expires_at) - new Date();
    return Math.max(0, Math.ceil(ms / 86400000));
  }

  if (!isOwner) return null;

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={busy}
        onClick={handleInvite}
        className="tap-44 w-full rounded-lg bg-[var(--brand-primary)] text-white text-sm font-medium py-2 disabled:opacity-50 hover:bg-[var(--brand-primary-hover)] transition-colors"
      >
        {t('members.invite')}
      </button>

      {freshLink && (
        // Danger colours, not a grey sentence. "You will not see this again" is
        // the one thing on this panel that cannot be undone by coming back
        // later, and it used to be set in the same muted type as everything
        // else — which is how it read as a footnote.
        <div className="rounded-lg border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 space-y-2">
          <p className="text-xs font-semibold text-[var(--danger-text)]">
            {t('members.link_once')}
          </p>

          <p className="text-[11px] font-mono break-all rounded bg-[var(--bg-card)] border border-[var(--border-subtle)] p-2 text-[var(--text-primary)]">
            {freshLink}
          </p>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="tap-44 flex-1 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-card)] text-xs font-medium py-2 text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              {t('members.copy')}
            </button>

            {/* Feature-detected rather than assumed: navigator.share is on
                phones and on Chrome for Windows, and absent on Firefox. A
                button that silently does nothing is worse than no button. */}
            {typeof navigator !== 'undefined' && navigator.share && (
              <button
                type="button"
                onClick={handleShare}
                className="tap-44 flex-1 rounded-lg bg-[var(--brand-primary)] text-white text-xs font-medium py-2 hover:bg-[var(--brand-primary-hover)] transition-colors"
              >
                {t('members.share')}
              </button>
            )}

            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="tap-44 flex-1 flex items-center justify-center rounded-lg border border-[var(--border-medium)] bg-[var(--bg-card)] text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              WhatsApp
            </a>
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <div className="space-y-1">
          <span className="text-[11px] uppercase tracking-wide text-[var(--text-muted)] font-medium">
            {t('members.pending_title', { count: pending.length })}
          </span>
          {pending.map((invite) => (
            <div
              key={invite.id}
              className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2"
            >
              <span className="flex-1 min-w-0">
                <span className="block truncate text-xs font-medium text-[var(--text-primary)]">
                  {t('members.pending_row')}
                </span>
                <span className="block truncate text-[11px] text-[var(--text-muted)]">
                  {/* Chosen here rather than by an i18next plural suffix: this
                      project picks its own singular and plural keys in code
                      (toast.added_one beside toast.added_many), and one key that
                      quietly relied on the library's rules instead would be a
                      second idiom hiding in the locale file. */}
                  {daysLeft(invite) <= 1
                    ? t('members.pending_expires_soon')
                    : t('members.pending_expires', { count: daysLeft(invite) })}
                </span>
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleRevoke(invite)}
                className="tap-44 flex-shrink-0 rounded-lg border border-[var(--danger-border)] bg-[var(--bg-card)] px-3 py-1.5 text-xs font-medium text-[var(--danger-text)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
              >
                {t('members.revoke')}
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog request={confirm.request} onAnswer={confirm.onAnswer} />
    </div>
  );
}

export default InvitePanel;
