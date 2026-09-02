import CustomSelect from './CustomSelect';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { UNFILED } from '../utils/workspaces';

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
function FilterBar({ category, onCategoryChange, priority, onPriorityChange, t }) {
  const { activeId, categoriesFor } = useWorkspaces();

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

  return (
    <div className="mb-3 flex gap-2">
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
  );
}

export default FilterBar;
