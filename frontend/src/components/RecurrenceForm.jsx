import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createRecurrence, updateRecurrence } from '../api';
import { isoWeekday } from '../utils/formatDate';
import Switch from './Switch';

const ISO_DAYS = [1, 2, 3, 4, 5, 6, 7]; // 1 = Monday .. 7 = Sunday

function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * An existing task read as the rule it is about to become. The keys are the
 * rule's own field names so the form can read either source without caring
 * which it got.
 *
 * Two judgements worth naming. The days default to the ONE day the task
 * already falls on, not Mon-Fri: "repeat this" said about next Tuesday most
 * often means every Tuesday, and a form that opens pre-armed for five days a
 * week invites the user to save four commitments they never asked for. And
 * Hostaway cannot come along — RecurrenceRule refuses that category outright
 * (models.py), because it belongs to the integration and its escalation
 * intervals. A Hostaway task can still be made to repeat; it just arrives as
 * Unknown rather than being rejected at save time with no explanation.
 */
function fromTask(task) {
  const weekday = isoWeekday(task.due_date);
  return {
    task_name: task.task_name || '',
    // The AI routinely sets description to the task name verbatim, which the
    // row already knows to hide (TaskRow's showDescription). Carrying it into
    // the rule would print the same words twice in the Recurrences list.
    description: task.description === task.task_name ? '' : (task.description || ''),
    category: !task.category || task.category === 'Hostaway' ? 'Unknown' : task.category,
    priority: task.priority || 'P3',
    due_time: task.due_time || '',
    weekdays: weekday ? [weekday] : [1, 2, 3, 4, 5],
    starts_on: task.due_date || todayISO(),
    notify_enabled: task.notify_enabled ?? false,
    calendar_sync_enabled: task.calendar_sync_enabled ?? false,
  };
}

/**
 * The alarm-clock shape: a time, and seven day toggles. Monthly is the second
 * mechanism, not a variation of the first, so it swaps the day toggles out
 * entirely rather than adding a mode to them.
 *
 * Three ways in, one form. `rule` set means edit it. `task` set means make
 * that task repeat — the fields open filled in from it, and saving asks the
 * server to adopt it as the rule's first occurrence rather than generating a
 * twin beside it. Neither means a rule from scratch, which is what the
 * Settings screen does.
 */
function RecurrenceForm({ rule, task, onCancel, onSaved }) {
  const { t } = useTranslation();
  const isEdit = Boolean(rule);
  const adoptTask = isEdit ? null : task;
  const source = rule || (adoptTask ? fromTask(adoptTask) : {});

  const [taskName, setTaskName] = useState(source.task_name || '');
  const [description, setDescription] = useState(source.description || '');
  const [category, setCategory] = useState(source.category || 'Personal');
  const [priority, setPriority] = useState(source.priority || 'P3');
  const [dueTime, setDueTime] = useState(source.due_time || '');
  const [freq, setFreq] = useState(source.freq || 'weekly');
  const [weekdays, setWeekdays] = useState(source.weekdays || [1, 2, 3, 4, 5]);
  const [monthDay, setMonthDay] = useState(source.month_day ?? 1);
  const [startsOn, setStartsOn] = useState(source.starts_on || todayISO());
  const [endsOn, setEndsOn] = useState(source.ends_on || '');
  const [notify, setNotify] = useState(source.notify_enabled ?? false);
  const [calendar, setCalendar] = useState(source.calendar_sync_enabled ?? false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Confirmed against frontend/src/i18n.js: plain i18next + initReactI18next
  // with no config that would make returnObjects misbehave — this is the
  // real seven-element array, not a stringified object.
  const dayLabels = t('recurrence.days_short', { returnObjects: true });

  function toggleDay(day) {
    setWeekdays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b));
  }

  async function handleSave() {
    // The server also rejects both of these with a 422 (see
    // tests/test_recurrence_api.py), but a round trip just to learn "give it
    // a name" is a bad way to find that out.
    if (!taskName.trim()) { setError(t('recurrence.error_no_name')); return; }
    if (freq === 'weekly' && weekdays.length === 0) {
      setError(t('recurrence.error_no_days'));
      return;
    }

    setSaving(true);
    setError(null);

    const payload = {
      task_name: taskName.trim(),
      description: description.trim(),
      category,
      priority,
      due_time: dueTime || null,
      freq,
      // Monthly replaces the weekday toggles entirely — it is the second
      // mechanism, not a variation of the first, so the field the other
      // mechanism owns is cleared rather than left stale.
      weekdays: freq === 'weekly' ? weekdays : null,
      month_day: freq === 'monthly' ? Number(monthDay) : null,
      starts_on: startsOn,
      ends_on: endsOn || null,
      notify_enabled: notify,
      calendar_sync_enabled: calendar,
      // Not part of the rule. It tells the server that this task already
      // exists and should BECOME the first occurrence — without it the
      // generator creates its own row for the same day and the user is
      // looking at two identical tasks the moment they hit save.
      ...(adoptTask ? { adopt_task_id: adoptTask.record_id } : {}),
    };

    try {
      if (isEdit) {
        await updateRecurrence(rule.record_id, payload);
      } else {
        await createRecurrence(payload);
      }
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  const field = 'w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-medium)] rounded-md text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-focus)] transition-colors';
  const label = 'block text-xs text-[var(--text-muted)] mb-1';

  return (
    <div className="space-y-4">
      <div>
        <label className={label}>{t('recurrence.form_name')}</label>
        <input className={field} value={taskName} onChange={(e) => setTaskName(e.target.value)} maxLength={80} />
      </div>

      <div>
        <label className={label}>{t('recurrence.form_description')}</label>
        <textarea className={`${field} resize-none`} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>{t('recurrence.form_category')}</label>
          <select className={field} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="Personal">{t('browse.filter_personal')}</option>
            <option value="Business">{t('browse.filter_business')}</option>
            <option value="Unknown">{t('browse.filter_unknown')}</option>
          </select>
        </div>
        <div>
          <label className={label}>{t('recurrence.form_priority')}</label>
          <select className={field} value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="P1">P1</option>
            <option value="P2">P2</option>
            <option value="P3">P3</option>
          </select>
        </div>
      </div>

      <div>
        <label className={label}>{t('recurrence.form_time')}</label>
        <input type="time" className={field} value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
      </div>

      <div>
        <label className={label}>{t('recurrence.form_pattern')}</label>
        <div className="flex gap-2 mb-3">
          {['weekly', 'monthly'].map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFreq(f)}
              className={`flex-1 py-2 rounded-md text-sm transition-colors ${
                freq === f
                  ? 'bg-[var(--brand-primary)] text-white'
                  : 'bg-[var(--bg-input)] text-[var(--text-muted)] border border-[var(--border-medium)]'
              }`}
            >
              {t(f === 'weekly' ? 'recurrence.form_weekly' : 'recurrence.form_monthly')}
            </button>
          ))}
        </div>

        {freq === 'weekly' ? (
          <div className="flex gap-1.5">
            {ISO_DAYS.map((day) => (
              <button
                key={day}
                type="button"
                onClick={() => toggleDay(day)}
                aria-pressed={weekdays.includes(day)}
                className={`flex-1 aspect-square rounded-full text-sm font-medium transition-colors ${
                  weekdays.includes(day)
                    ? 'bg-[var(--brand-primary)] text-white'
                    : 'bg-[var(--bg-input)] text-[var(--text-muted)] border border-[var(--border-medium)]'
                }`}
              >
                {dayLabels[day - 1]}
              </button>
            ))}
          </div>
        ) : (
          <div>
            <label className={label}>{t('recurrence.form_day_of_month')}</label>
            <select className={field} value={monthDay} onChange={(e) => setMonthDay(e.target.value)}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
              <option value={-1}>{t('recurrence.form_last_day')}</option>
            </select>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>{t('recurrence.form_starts')}</label>
          <input type="date" className={field} value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
        </div>
        <div>
          <label className={label}>{t('recurrence.form_ends')}</label>
          <input type="date" className={field} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
        </div>
      </div>

      {/*
        Switch's real props are label/description/checked/onChange/disabled/
        disabledReason (Switch.jsx:15) — it does not accept aria-label, and it
        already renders its own label text next to the toggle (the same
        layout TaskDetailSheet.jsx uses for this exact pair of settings on a
        single task: notification + calendar sync). So the label is passed
        in rather than duplicated in a sibling <span>.
      */}
      <Switch
        label={t('recurrence.form_notify')}
        checked={Boolean(notify && dueTime)}
        onChange={() => setNotify((v) => !v)}
        disabledReason={dueTime ? null : t('task.no_time_for_reminder')}
      />

      <Switch
        label={t('recurrence.form_calendar')}
        checked={calendar}
        onChange={() => setCalendar((v) => !v)}
      />

      {error && (
        <div className="p-2 rounded border border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-text)] text-xs">
          {error}
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-2 rounded-md border border-[var(--border-medium)] text-sm text-[var(--text-muted)]"
        >
          {t('recurrence.form_cancel')}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex-1 py-2 rounded-md bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] text-white text-sm font-medium disabled:opacity-50 transition-colors"
        >
          {t('recurrence.form_save')}
        </button>
      </div>
    </div>
  );
}

export default RecurrenceForm;
