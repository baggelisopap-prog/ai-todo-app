import CustomSelect from './CustomSelect';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { useMembers } from '../hooks/useMembers';
import { UNFILED } from '../utils/workspaces';
import {
  ASSIGNMENT_ALL,
  ASSIGNMENT_MINE,
  ASSIGNMENT_UNASSIGNED,
} from '../utils/assignment';

/**
 * Shared category + priority filter row used by Today, Upcoming, and Calendar views.
 * Fully controlled — the parent owns the selected values and does the actual filtering.
 *
 * The category list is THIS WORKSPACE'S categories, and the control disappears
 * entirely when no workspace is chosen. There is no coherent single list of
 * categories across two workspaces — "μετοχές" and "κήπος" do not belong in one
 * menu — and the chips above are already doing the coarse filtering that the old
 * hardcoded Business/Personal/Unknown/Hostaway dropdown used to do.
 */
function FilterBar({
  category, onCategoryChange,
  priority, onPriorityChange,
  assignment, onAssignmentChange,
  t,
}) {
  const { activeId, categoriesFor } = useWorkspaces();
  const { hasAnyShared, isShared } = useMembers();

  // UNFILED is a view, not a workspace: it has no categories of its own, so the
  // category control stays hidden there too.
  const showCategories = Boolean(activeId) && activeId !== UNFILED;
  const categoryOptions = showCategories
    ? [
        { value: 'All', label: t('workspace.category_label') },
        ...categoriesFor(activeId).map((c) => ({ value: c.record_id, label: c.name })),
        { value: UNFILED, label: t('workspace.unfiled') },
      ]
    : null;

  const priorityOptions = [
    { value: 'All', label: t('task.priority_label') },
    { value: 'P1', label: 'P1' },
    { value: 'P2', label: 'P2' },
    { value: 'P3', label: 'P3' },
  ];

  // Only where more than one person can hold a task.
  //
  // On a solo account every task is yours, so the control would be three
  // buttons that all produce the same list — and it would sit on every screen
  // of an app most of whose users never share anything. This is the same test
  // the handover picker in the task sheet already applies, and the same one
  // Todoist applies: "Only me" exists inside team projects and nowhere else.
  //
  // On "Όλα" (activeId null) the list genuinely mixes workspaces, so the
  // question still makes sense as long as ANY room is shared — hence two
  // different checks rather than one.
  const showAssignment = Boolean(onAssignmentChange)
    && (activeId ? isShared(activeId) : hasAnyShared);

  const assignmentOptions = [
    { value: ASSIGNMENT_ALL, label: t('assignment.all') },
    { value: ASSIGNMENT_MINE, label: t('assignment.mine') },
    { value: ASSIGNMENT_UNASSIGNED, label: t('assignment.unassigned') },
  ];

  return (
    <div className="mb-3 space-y-2">
      <div className="flex gap-2">
        {categoryOptions && (
          <div className="flex-1 min-w-0">
            <CustomSelect
              compact
              value={category}
              options={categoryOptions}
              onChange={onCategoryChange}
              ariaLabel={t('workspace.category_label')}
            />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <CustomSelect
            compact
            value={priority}
            options={priorityOptions}
            onChange={onPriorityChange}
            ariaLabel={t('task.priority_label')}
          />
        </div>
      </div>

      {/* A segmented control rather than a fourth dropdown. Three short,
          mutually exclusive answers that are looked at constantly: putting them
          behind a tap means the current one is invisible until you open it,
          which for "am I looking at everything or only my own?" is the one
          thing you must be able to see without asking. */}
      {showAssignment && (
        <div
          role="group"
          aria-label={t('assignment.label')}
          className="flex rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-input)] p-0.5"
        >
          {assignmentOptions.map((option) => {
            const isActive = (assignment || ASSIGNMENT_ALL) === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={isActive}
                onClick={() => onAssignmentChange(option.value)}
                className={`tap-40 flex-1 min-w-0 truncate rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-[var(--brand-primary)] text-white'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default FilterBar;
