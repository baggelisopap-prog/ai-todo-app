import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { getRecurrences, updateRecurrence, deleteRecurrence } from '../api';
import { describeRecurrence } from '../utils/taskDisplay';
import { useRecurrence } from '../hooks/useRecurrence';
import Switch from './Switch';
import RecurrenceForm from './RecurrenceForm';

// describeRecurrence lives in utils/taskDisplay.js, beside its sibling
// categoryLabel — same shape (a domain object plus `t`, returns a string),
// no React involved. The Inbox (a later task), which renders pending
// AI-made rules with the same sentence, imports it from there too, not
// from this file — one shared source for the sentence, not a re-export
// chain through a component.

/**
 * The Recurrences sub-screen: what repeats, when, and a switch per row.
 *
 * Modelled on HostawayConnectionView (SettingsModal.jsx) — the closest
 * existing settings sub-screen: same space-y rhythm, same brand-primary
 * full-width primary action. Two deliberate differences, not oversights:
 * each row here is its own bordered bg-input card, where Hostaway's toggle
 * rows (SettingsModal.jsx:704-726) are plain, unbordered divs — this screen
 * needed the card to separate one rule from the next in a list, a problem
 * Hostaway never has since it only ever shows one connection. And this view
 * renders a visible "…" while loading, rather than Hostaway's
 * render-nothing-until-loaded (SettingsModal.jsx:660) — arguably the better
 * choice for a list that might otherwise flash empty, but not the same, so
 * not claimed as the same.
 */
function RecurrencesView({ onShowToast }) {
  const { t } = useTranslation();
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null | 'new' | rule object

  // This screen keeps its own copy of the rules — it needs one it can move
  // optimistically under a finger on the switch — but it is no longer the only
  // copy: every task row now reads a rule to print "↻ Repeats · Mon-Fri", from
  // the shared one in RecurrenceProvider. So every write here has to tell that
  // copy to catch up, or editing a rule in Settings leaves forty rows in the
  // list behind it describing the rule as it used to be.
  //
  // A second copy is tolerable here in a way it was not for app settings
  // (see AppSettingsProvider): these writes PATCH only the fields that
  // changed, so a stale copy can show something out of date but cannot post
  // an old value over a new one.
  const { reload: reloadSharedRules } = useRecurrence();

  // A .then()/.catch()/.finally() chain, not an async function: the setState
  // calls sit inside their own nested callbacks rather than directly in
  // `load`'s own body, which is what keeps react-hooks/set-state-in-effect
  // quiet when `load()` is called from the mount effect below. Not the
  // brief's shape (a deliberate deviation, made to avoid a new lint error —
  // not one of the brief's three pre-approved corrections). It dodges the
  // same rule the same way HostawayConnectionView and CalendarConnectionView
  // do in SettingsModal.jsx, but not in the same shape: those two inline
  // their .then() chain directly inside useEffect, where this one is
  // extracted into a useCallback'd `load` so handleToggle's failure-recovery
  // path and the post-save reload below can call it too.
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
      reloadSharedRules();
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
      reloadSharedRules();
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
        onSaved={() => {
          setEditing(null);
          onShowToast?.(t('recurrence.saved'), 'success');
          load();
          reloadSharedRules();
        }}
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
            No `label`: the row's own button, immediately to this switch's
            left, already renders rule.task_name as visible text, so passing
            it as `label` too would print the name a second time next to the
            toggle. `ariaLabel` (Switch.jsx) exists for exactly this case —
            it gives the button an accessible name without duplicating the
            visible text a second time.
          */}
          <Switch
            checked={rule.is_active}
            onChange={() => handleToggle(rule)}
            ariaLabel={rule.task_name}
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
