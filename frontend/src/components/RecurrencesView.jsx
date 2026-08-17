import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { getRecurrences, updateRecurrence, deleteRecurrence } from '../api';
import Switch from './Switch';
import RecurrenceForm from './RecurrenceForm';

/**
 * A rule as one line of human language: "Mon-Fri at 09:00".
 *
 * Exported because the Inbox renders pending AI-made rules with the same
 * sentence (a later task) — a recurrence the user is asked to approve must
 * read exactly like one they already own, or they are approving something
 * else. (Mixing this export with the default component below trips
 * react-refresh/only-export-components; disabled deliberately rather than
 * split into a third file for one function.)
 */
// eslint-disable-next-line react-refresh/only-export-components
export function describeRecurrence(rule, t) {
  const days = rule.weekdays || [];
  let when;

  if (rule.freq === 'monthly') {
    when = rule.month_day === -1
      ? t('recurrence.monthly_last')
      : t('recurrence.monthly_day', { day: rule.month_day });
  } else if (days.length === 7) {
    when = t('recurrence.every_day');
  } else if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) {
    when = t('recurrence.weekdays');
  } else if (days.length === 2 && days.includes(6) && days.includes(7)) {
    when = t('recurrence.weekends');
  } else {
    // Confirmed against frontend/src/i18n.js: plain i18next + initReactI18next,
    // no config that would make returnObjects misbehave. This is a real array,
    // not a stringified object — [d - 1] because the key is ISO (1 = Monday)
    // and the array is 0-indexed (Monday first).
    const short = t('recurrence.days_short', { returnObjects: true });
    when = days.slice().sort((a, b) => a - b).map((d) => short[d - 1]).join(' ');
  }

  const time = rule.due_time
    ? t('recurrence.at_time', { time: rule.due_time })
    : t('recurrence.no_time');
  return `${when} · ${time}`;
}

/**
 * The Recurrences sub-screen: what repeats, when, and a switch per row.
 *
 * Modelled on HostawayConnectionView (SettingsModal.jsx) — the closest
 * existing settings sub-screen: same space-y rhythm, same border/bg-input
 * card look for each row, same brand-primary full-width primary action.
 */
function RecurrencesView({ onShowToast }) {
  const { t } = useTranslation();
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null | 'new' | rule object

  // A .then()/.catch()/.finally() chain, not an async function: the setState
  // calls sit inside their own nested callbacks rather than directly in
  // `load`'s own body, which is what keeps react-hooks/set-state-in-effect
  // quiet when `load()` is called from the mount effect below — the same
  // shape HostawayConnectionView and CalendarConnectionView already use in
  // SettingsModal.jsx for the same reason.
  const load = useCallback(() => {
    return getRecurrences()
      .then((data) => setRules(data.recurrences || []))
      .catch((err) => onShowToast?.(err.message, 'error'))
      .finally(() => setLoading(false));
  }, [onShowToast]);

  useEffect(() => { load(); }, [load]);

  async function handleToggle(rule) {
    const next = !rule.is_active;
    // Optimistic: the switch must move under the finger. A failure reloads.
    setRules((prev) => prev.map((r) =>
      r.record_id === rule.record_id ? { ...r, is_active: next } : r));
    try {
      await updateRecurrence(rule.record_id, { is_active: next });
      onShowToast?.(next ? t('recurrence.resumed') : t('recurrence.paused'), 'success');
    } catch (err) {
      onShowToast?.(err.message, 'error');
      load();
    }
  }

  async function handleDelete(rule) {
    if (!window.confirm(t('recurrence.delete_confirm'))) return;
    try {
      await deleteRecurrence(rule.record_id);
      setRules((prev) => prev.filter((r) => r.record_id !== rule.record_id));
      onShowToast?.(t('recurrence.deleted'), 'success');
    } catch (err) {
      onShowToast?.(err.message, 'error');
    }
  }

  if (editing) {
    return (
      <RecurrenceForm
        rule={editing === 'new' ? null : editing}
        onCancel={() => setEditing(null)}
        onSaved={() => { setEditing(null); onShowToast?.(t('recurrence.saved'), 'success'); load(); }}
      />
    );
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setEditing('new')}
        className="w-full px-4 py-2 rounded-md bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] text-white text-sm font-medium transition-colors"
      >
        + {t('recurrence.new')}
      </button>

      {loading && <p className="text-sm text-[var(--text-muted)]">…</p>}

      {!loading && rules.length === 0 && (
        <div className="py-6 text-center">
          <p className="text-sm text-[var(--text-primary)]">{t('recurrence.empty')}</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">{t('recurrence.empty_hint')}</p>
        </div>
      )}

      {rules.map((rule) => (
        <div
          key={rule.record_id}
          className="flex items-center gap-3 p-3 rounded-md border border-[var(--border-medium)] bg-[var(--bg-input)]"
        >
          <button
            type="button"
            onClick={() => setEditing(rule)}
            className="flex-1 text-left min-w-0"
          >
            <span className={`block text-sm font-medium truncate ${rule.is_active ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>
              {rule.task_name}
            </span>
            <span className="block text-xs text-[var(--text-muted)] truncate">
              {describeRecurrence(rule, t)}
            </span>
          </button>

          {/*
            No `label`: Switch's real props are label/description/checked/
            onChange/disabled/disabledReason (Switch.jsx:15) — it does not
            accept aria-label. The row's own button, immediately to this
            switch's left, already names the rule (task_name), so passing
            label={rule.task_name} here would print the name a second time
            next to the toggle. Omitted per the brief's own guidance: "use
            label, or omit where surrounding text already labels the
            control."
          */}
          <Switch
            checked={rule.is_active}
            onChange={() => handleToggle(rule)}
          />

          <button
            type="button"
            onClick={() => handleDelete(rule)}
            aria-label={t('recurrence.delete')}
            className="text-[var(--text-muted)] hover:text-[var(--danger-text)] transition-colors p-1"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

export default RecurrencesView;
