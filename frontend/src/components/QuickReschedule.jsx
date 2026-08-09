import { useTranslation } from 'react-i18next';
import { toLocalISODate } from '../utils/formatDate';

/**
 * Three dates and nothing else.
 *
 * Rescheduling is the one edit worth a shortcut: it is the most common change
 * to a task, and doing it through the form costs opening the sheet, pressing
 * Edit, and operating a date picker to express "tomorrow". The inline agent
 * already offers the same three as chips, but each of those spends a model call
 * on arithmetic the browser can do for free — this is the zero-token path to
 * the same result.
 *
 * Anything other than these three still goes through the date field in the
 * detail sheet. That is the point of keeping the list to three: a popover that
 * tries to be a calendar is just a worse calendar.
 */
function QuickReschedule({ onPick, onClose }) {
  const { t } = useTranslation();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const at = (daysFromNow) => {
    const d = new Date(today);
    d.setDate(d.getDate() + daysFromNow);
    return toLocalISODate(d);
  };

  const options = [
    { key: 'today', label: t('reschedule.today'), date: at(0) },
    { key: 'tomorrow', label: t('reschedule.tomorrow'), date: at(1) },
    { key: 'next_week', label: t('reschedule.next_week'), date: at(7) },
  ];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 animate-fade-in flex items-end md:items-center justify-center md:p-4"
      onClick={onClose}
    >
      <div
        className="w-full md:max-w-xs bg-[var(--bg-modal)] md:rounded-lg rounded-t-2xl shadow-[var(--shadow-modal)] p-2"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('actions.reschedule')}
      >
        {options.map(({ key, label, date }) => (
          <button
            key={key}
            type="button"
            onClick={() => onPick(date)}
            className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-primary)] text-left text-sm"
          >
            <span>{label}</span>
            <span className="text-xs text-[var(--text-muted)] tabular-nums">{date}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default QuickReschedule;
