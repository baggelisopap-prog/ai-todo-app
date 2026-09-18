import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getWorkspaceActivity } from '../api';
import { personName } from '../utils/people';
import Avatar from './Avatar';

/**
 * What has happened in this room, newest first, grouped by day.
 *
 * THIS IS WHAT MAKES "ANYONE MAY EDIT ANYTHING" HONEST. The shape Trello and
 * Todoist both settled on gives every member of a shared container the right to
 * change and complete anything in it; what keeps that from being merely
 * permissive is that deleting stays the owner's alone and that the rest is
 * written down. The log has been written since sharing shipped — every invite,
 * join, removal, archive and handover — and until now nothing displayed it.
 *
 * Grouped under date headings rather than printed as a flat list of
 * timestamps: the question asked of a log is almost always "what happened
 * around then", and a reader who has to compare thirty timestamps to find a day
 * boundary is doing the grouping in their head.
 *
 * The rows are SENTENCES, not verbs beside ids. `actor_name` is resolved by the
 * server (see main.list_workspace_activity) because only the server can name
 * somebody who has since left — which is exactly who a log tends to be about.
 * The person on the receiving end of a removal or a handover is resolved here
 * instead, from the members list already on screen, and falls back to a plain
 * "somebody" rather than printing a raw id at a reader.
 */
function ActivityPanel({ workspace, members }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [activity, setActivity] = useState(null);

  // Opening is what fetches. A workspace row in Settings must not cost a log
  // request nobody asked for, and this is the least-visited thing on the panel.
  useEffect(() => {
    if (!open || activity) return undefined;
    let cancelled = false;
    getWorkspaceActivity(workspace.record_id, 100)
      .then((data) => { if (!cancelled) setActivity(data.activity || []); })
      .catch(() => { if (!cancelled) setActivity([]); });
    return () => { cancelled = true; };
  }, [open, activity, workspace.record_id]);

  function nameOf(userId) {
    const member = (members || []).find((m) => m.user_id === userId);
    return personName(member) || t('activity.somebody');
  }

  /**
   * The actor as something Avatar can draw.
   *
   * Somebody who has left the room is not in `members` any more, but the server
   * still named them — so a row is built from that name rather than falling
   * through to the grey "?" circle. Losing the face of everyone who has left
   * would empty exactly the part of the log people read it for.
   */
  function actorMemberOf(row) {
    const present = (members || []).find((m) => m.user_id === row.actor_user_id);
    if (present) return present;
    if (row.actor_name) {
      return { user_id: row.actor_user_id, display_name: row.actor_name, email: null };
    }
    return null;
  }

  function sentenceFor(row) {
    const actor = row.actor_name || t('activity.somebody');
    const task = row.task_name || t('activity.a_task');
    const details = row.details || {};

    switch (row.action) {
      case 'invite_created':
        return t('activity.invite_created', { actor });
      case 'invite_revoked':
        return t('activity.invite_revoked', { actor });
      case 'member_joined':
        return t('activity.member_joined', { actor });
      case 'member_removed':
        return t('activity.member_removed', { actor, member: nameOf(details.member) });
      case 'member_left':
        return t('activity.member_left', { actor });
      case 'workspace_archived':
        return t('activity.workspace_archived', { actor });
      case 'workspace_restored':
        return t('activity.workspace_restored', { actor });
      case 'task_assigned':
        // A handover and a hand-back are different events wearing one verb:
        // assigned_to is null when somebody puts work back on the pile, and
        // "assigned X to nobody" is not a sentence.
        return details.assigned_to
          ? t('activity.task_assigned', { actor, task, member: nameOf(details.assigned_to) })
          : t('activity.task_unassigned', { actor, task });
      // The two verbs the log was missing until 2026-09-17, and their absence
      // was not cosmetic: a member may edit anything in a shared room BECAUSE
      // this log says who did what, and the one act that ends a task was going
      // unrecorded. Reopening is its own verb rather than the absence of one,
      // or the log would show the same task completed twice and never say it
      // came back.
      case 'task_completed':
        return t('activity.task_completed', { actor, task });
      case 'task_reopened':
        return t('activity.task_reopened', { actor, task });
      default:
        // The vocabulary is meant to grow — comments are the next project — and
        // the column has no CHECK constraint for that reason. An unknown verb
        // prints the verb rather than disappearing: a log that silently drops
        // rows it does not recognise is worse than one that reads awkwardly.
        return `${actor} · ${row.action}`;
    }
  }

  // Grouped in one pass over a list the server already ordered newest-first, so
  // the day headings come out newest-first too with nothing to sort.
  const days = [];
  (activity || []).forEach((row) => {
    const day = (row.created_at || '').slice(0, 10);
    const last = days[days.length - 1];
    if (last && last.day === day) last.rows.push(row);
    else days.push({ day, rows: [row] });
  });

  function dayLabel(day) {
    if (!day) return '';
    const date = new Date(day);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    const iso = (d) => d.toISOString().slice(0, 10);
    if (day === iso(today)) return t('activity.today');
    if (day === iso(yesterday)) return t('activity.yesterday');
    return date.toLocaleDateString(i18n.language === 'en' ? 'en-GB' : 'el-GR', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
  }

  function timeOf(row) {
    if (!row.created_at) return '';
    return new Date(row.created_at).toLocaleTimeString(
      i18n.language === 'en' ? 'en-GB' : 'el-GR',
      { hour: '2-digit', minute: '2-digit', hour12: false }
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="tap-44 flex items-center gap-2 w-full text-left text-xs font-medium text-[var(--text-secondary)]"
        aria-expanded={open}
      >
        <span aria-hidden="true" className="text-[10px] text-[var(--text-muted)]">
          {open ? '▾' : '▸'}
        </span>
        {t('activity.title')}
      </button>

      {open && (
        <div className="mt-2 space-y-3">
          {activity === null && (
            <p className="text-xs text-[var(--text-muted)]">{t('members.loading')}</p>
          )}

          {activity?.length === 0 && (
            <p className="text-xs text-[var(--text-muted)]">{t('activity.empty')}</p>
          )}

          {days.map(({ day, rows }) => (
            <div key={day} className="space-y-1.5">
              <span className="block text-[11px] uppercase tracking-wide text-[var(--text-muted)] font-medium">
                {dayLabel(day)}
              </span>
              {rows.map((row) => (
                <div key={row.id} className="flex items-start gap-2">
                  <Avatar
                    member={actorMemberOf(row)}
                    userId={row.actor_user_id}
                    size="xs"
                    unknownLabel={t('members.former_member')}
                    className="mt-0.5"
                  />
                  <span className="flex-1 min-w-0 text-xs text-[var(--text-secondary)]">
                    {sentenceFor(row)}
                  </span>
                  <span className="text-[11px] text-[var(--text-muted)] tabular-nums flex-shrink-0">
                    {timeOf(row)}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default ActivityPanel;
