import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import OptionSheet from './OptionSheet';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { UNFILED, countByWorkspace } from '../utils/workspaces';
import { isVisibleTask } from '../utils/taskDisplay';
import { ALL, needsFind } from '../utils/taskFilters';

/**
 * The app bar's title, which on a phone is the room you are looking at.
 *
 * WHY IT IS THE TITLE. The workspace used to be a row of chips under the bar,
 * costing ~40px on every screen — and past five workspaces the row scrolled
 * sideways, so the selected chip could sit off the right edge and the one
 * control whose job was showing where you are would hide it instead. The owner
 * picked this shape out of three mockups: the room takes the title slot, the
 * row disappears, and the screen's own name is carried by the bottom nav (a
 * highlighted tab with its label) and by the uppercase heading over the list.
 *
 * HOW THE COLOUR WORKS, and it is two devices for one fact:
 *
 *   - On «Όλα» the trigger is PLAIN TEXT. No frame, no dot.
 *   - In a room it becomes a pill FRAMED in that room's colour, with its dot
 *     inside.
 *
 * The SHAPE is what says "I am filtered"; the colour only says which room. That
 * order matters — it means the state is still readable by someone who cannot
 * tell two shades apart, the same reason OptionSheet marks its selection with a
 * tick and not with a coloured row. And a frame rather than a fill because a
 * filled colour bar reads as identity ("this is the Business app") while a
 * frame around something reads as a state you are in and can leave, which is
 * exactly what a workspace became on 2026-09-12.
 *
 * The colour itself is user data — any hex, or none — so it is never used raw:
 * `.ws-frame` in index.css mixes it toward the text colour so that pale yellow
 * on white and navy on black are both still visible. See the comment there.
 *
 * Renders the plain screen title when there are fewer than two workspaces: a
 * picker with one option is a control that cannot do anything, and the title
 * slot has a better use.
 */
function RoomTitle({ title, tasks }) {
  const { t } = useTranslation();
  const { workspaces, activeId, setActiveId } = useWorkspaces();
  const [isOpen, setIsOpen] = useState(false);

  // Live work only, and the whole library rather than what any filter already
  // narrowed to: "Business 212" has to answer "how much is in there", which is
  // the question that makes someone open this picker at all. Same rule as the
  // numbers beside the categories, so the two agree.
  const counts = useMemo(() => {
    const live = (tasks || []).filter((task) => isVisibleTask(task) && !task.is_completed);
    return countByWorkspace(live, workspaces);
  }, [tasks, workspaces]);

  // Hooks run before this, always: an early return above a useMemo is the one
  // thing React does not allow.
  if (workspaces.length < 2) {
    return (
      <h1 className="flex-1 min-w-0 truncate text-lg font-semibold text-[var(--text-primary)]">
        {title}
      </h1>
    );
  }

  const active = workspaces.find((w) => w.record_id === activeId);
  const label = activeId === UNFILED
    ? t('workspace.unfiled')
    : (active ? active.name : t('workspace.all'));

  // «Όλα» is home and gets no decoration. Everything else is a filter and says so.
  const isFiltered = activeId !== null;

  const options = [
    { value: ALL, label: t('workspace.all'), swatch: null, hint: counts.all },
    ...workspaces.map((w) => ({
      value: w.record_id,
      label: w.name,
      swatch: w.color || null,
      hint: counts[w.record_id],
    })),
    // Last, after the real rooms: it is where anything the AI could not place
    // goes to be found.
    { value: UNFILED, label: t('workspace.unfiled'), swatch: null, hint: counts[UNFILED] },
  ];

  return (
    <div className="flex-1 min-w-0">
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        // The accessible name has to say what the control DOES. "Business"
        // alone reads as a heading, and this is a button that changes what the
        // whole screen shows.
        aria-label={t('workspace.pick', { name: label })}
        // --ws-color is read by .ws-frame and .ws-dot. A room with no colour of
        // its own simply does not set it, and the token's own neutral default
        // takes over — which is why there is no "no colour" branch here.
        style={active?.color ? { '--ws-color': active.color } : undefined}
        className={`tap-44 flex items-center gap-2 max-w-full min-w-0 transition-colors ${
          isFiltered
            ? 'ws-frame border-2 rounded-full pl-2.5 pr-2 py-1'
            : 'rounded-md px-0.5 py-1 hover:text-[var(--text-secondary)]'
        }`}
      >
        {isFiltered && (
          <span
            aria-hidden="true"
            className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
              active?.color ? 'ws-dot' : 'border border-[var(--border-medium)]'
            }`}
          />
        )}
        <span className={`min-w-0 truncate font-semibold text-[var(--text-primary)] ${
          isFiltered ? 'text-base' : 'text-lg'
        }`}>
          {label}
        </span>
        <svg
          className="w-4 h-4 flex-shrink-0 text-[var(--text-muted)]"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <OptionSheet
          title={t('workspace.label')}
          options={options}
          value={activeId === null ? ALL : activeId}
          onPick={(value) => {
            setActiveId(value === ALL ? null : value);
            setIsOpen(false);
          }}
          onClose={() => setIsOpen(false)}
          searchable={needsFind(options.length)}
        />
      )}
    </div>
  );
}

export default RoomTitle;
