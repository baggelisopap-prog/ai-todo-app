import CustomSelect from './CustomSelect';

/**
 * Shared category + priority filter row used by Today, Upcoming, and Calendar views.
 * Fully controlled — the parent owns the selected values and does the actual filtering.
 * Compact single-row layout: each dropdown shows its own name ("Category"/"Priority")
 * as the label while set to "All", then swaps to the picked value once changed.
 */
function FilterBar({ category, onCategoryChange, priority, onPriorityChange, t }) {
  const categoryOptions = [
    { value: 'All', label: t('task.category_label') },
    { value: 'Business', label: t('browse.filter_business') },
    { value: 'Personal', label: t('browse.filter_personal') },
    { value: 'Unknown', label: t('browse.filter_unknown') },
  ];

  const priorityOptions = [
    { value: 'All', label: t('task.priority_label') },
    { value: 'P1', label: 'P1' },
    { value: 'P2', label: 'P2' },
    { value: 'P3', label: 'P3' },
  ];

  return (
    <div className="mb-3 flex gap-2">
      <div className="flex-1 min-w-0">
        <CustomSelect
          compact
          value={category}
          options={categoryOptions}
          onChange={onCategoryChange}
          ariaLabel={t('task.category_label')}
        />
      </div>
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
