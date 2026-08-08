/**
 * The "nothing here" moment, which every view used to render as one line of
 * italic grey text — the point at which the app has the most room on screen
 * and was saying the least with it.
 *
 * Still deliberately quiet. An empty inbox is good news, not a problem to be
 * solved with an illustration and a call to action, and this app shows an
 * empty state several times a day. So: a muted mark, the existing message
 * unchanged, and an optional one-line hint. No new copy was invented — the
 * strings are the ones the views already passed.
 *
 * `size="inline"` is for the empty *sections* inside an otherwise full screen
 * (Today's "no tasks today" while overdue ones are listed below it), where the
 * full treatment would shout louder than the content around it.
 */
function EmptyState({ message, hint, size = 'page' }) {
  const isInline = size === 'inline';

  return (
    <div className={isInline ? 'py-6 text-center' : 'py-14 px-8 text-center'}>
      <div
        className={`mx-auto mb-3 rounded-full bg-[var(--bg-hover)] flex items-center justify-center ${
          isInline ? 'w-8 h-8' : 'w-12 h-12'
        }`}
        aria-hidden="true"
      >
        <svg
          className={isInline ? 'w-4 h-4' : 'w-6 h-6'}
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--text-muted)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="9 11 12 14 20 6" />
          <path d="M20 12v6a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h9" />
        </svg>
      </div>
      <p className={`text-[var(--text-secondary)] ${isInline ? 'text-sm' : 'text-base'}`}>
        {message}
      </p>
      {hint && (
        <p className="text-xs text-[var(--text-muted)] mt-1">{hint}</p>
      )}
    </div>
  );
}

export default EmptyState;
