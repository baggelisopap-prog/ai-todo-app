import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getGoogleCalendarEvents, convertCalendarEventToTask } from '../api';
import { formatDate } from '../utils/formatDate';

function GoogleCalendarEventsView() {
  const { t } = useTranslation();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [convertingId, setConvertingId] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getGoogleCalendarEvents()
      .then(setEvents)
      .catch(err => console.error('Failed to load Google Calendar events:', err))
      .finally(() => setLoading(false));
  }, []);

  async function handleConvert(eventId) {
    setConvertingId(eventId);
    setError(null);
    try {
      await convertCalendarEventToTask(eventId);
      setEvents(current => current.filter(e => e.id !== eventId));
    } catch (err) {
      setError(err.message);
    } finally {
      setConvertingId(null);
    }
  }

  if (loading) {
    return <p className="text-sm text-[var(--text-muted)]">{t('settings.loading')}</p>;
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}

      {events.map(event => (
        <div
          key={event.id}
          className="p-4 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] flex items-center justify-between gap-4"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{event.title}</p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {formatDate(event.start_date, event.start_time)}
            </p>
          </div>
          <button
            onClick={() => handleConvert(event.id)}
            disabled={convertingId === event.id}
            className="flex-shrink-0 px-3 py-1.5 rounded-md bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] text-white text-sm font-medium disabled:opacity-50 w-32 text-center"
          >
            {convertingId === event.id ? t('settings.loading') : t('calendar.make_task')}
          </button>
        </div>
      ))}

      {events.length === 0 && (
        <p className="text-sm text-[var(--text-muted)]">{t('calendar.no_events')}</p>
      )}
    </div>
  );
}

export default GoogleCalendarEventsView;
