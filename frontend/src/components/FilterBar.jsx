/**
 * FilterBar — category tabs, sort buttons, and completed toggle.
 * * All filter state is owned by App. This component is presentational:
 * it receives current values and callbacks via props.
 */
function FilterBar({
  categoryCounts,
  selectedCategory,
  onSelectCategory,
  sortBy,
  onSelectSort,
  showCompleted,
  onToggleCompleted,
  completedCount,
  showRejected,
  onToggleRejected,
  rejectedCount,
}) {
  return (
    <div className="mb-6 space-y-4">
      {/* Category cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <CategoryCard
          label="All"
          count={categoryCounts.All}
          isSelected={selectedCategory === 'All'}
          onClick={() => onSelectCategory('All')}
          accentClass="hover:border-slate-600"
          selectedClass="border-slate-400 bg-slate-800"
        />
        <CategoryCard
          label="Business"
          count={categoryCounts.Business}
          isSelected={selectedCategory === 'Business'}
          onClick={() => onSelectCategory('Business')}
          accentClass="hover:border-blue-700"
          selectedClass="border-blue-500 bg-blue-950"
        />
        <CategoryCard
          label="Personal"
          count={categoryCounts.Personal}
          isSelected={selectedCategory === 'Personal'}
          onClick={() => onSelectCategory('Personal')}
          accentClass="hover:border-purple-700"
          selectedClass="border-purple-500 bg-purple-950"
        />
        <CategoryCard
          label="Unknown"
          count={categoryCounts.Unknown}
          isSelected={selectedCategory === 'Unknown'}
          onClick={() => onSelectCategory('Unknown')}
          accentClass="hover:border-slate-600"
          selectedClass="border-slate-400 bg-slate-800"
        />
      </div>

      {/* Sort buttons */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-400 mr-1">Sort:</span>
        <SortButton
          label="Newest"
          value="newest"
          currentValue={sortBy}
          onClick={onSelectSort}
        />
        <SortButton
          label="Oldest"
          value="oldest"
          currentValue={sortBy}
          onClick={onSelectSort}
        />
        <SortButton
          label="Priority"
          value="priority"
          currentValue={sortBy}
          onClick={onSelectSort}
        />
        <SortButton
          label="Due date"
          value="due_date"
          currentValue={sortBy}
          onClick={onSelectSort}
        />
      </div>

      {/* Show completed / rejected toggles */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onToggleCompleted}
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
            showCompleted
              ? 'border-slate-600 bg-slate-800 text-slate-100'
              : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700'
          }`}
        >
          <span
            className={`w-3 h-3 rounded-sm border ${
              showCompleted
                ? 'border-slate-400 bg-slate-400'
                : 'border-slate-600 bg-transparent'
            }`}
            aria-hidden="true"
          />
          Show completed ({completedCount})
        </button>
        <button
          type="button"
          onClick={onToggleRejected}
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
            showRejected
              ? 'border-red-800 bg-red-950/50 text-red-200'
              : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700'
          }`}
        >
          <span
            className={`w-3 h-3 rounded-sm border ${
              showRejected
                ? 'border-red-400 bg-red-400'
                : 'border-slate-600 bg-transparent'
            }`}
            aria-hidden="true"
          />
          Show rejected ({rejectedCount})
        </button>
      </div>
    </div>
  );
}

/**
 * CategoryCard — a clickable card showing category label and task count.
 */
function CategoryCard({ label, count, isSelected, onClick, accentClass, selectedClass }) {
  const baseClasses =
    'flex flex-col items-center justify-center p-3 rounded-lg border transition-colors cursor-pointer text-center';
  const stateClasses = isSelected
    ? selectedClass
    : `border-slate-800 bg-slate-900 ${accentClass}`;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${baseClasses} ${stateClasses}`}
      aria-pressed={isSelected}
    >
      <span className="text-xs text-slate-400 font-medium uppercase tracking-wide">
        {label}
      </span>
      <span className="text-xl font-semibold text-white mt-0.5">{count}</span>
    </button>
  );
}

/**
 * SortButton — toggle button for a single sort option.
 */
function SortButton({ label, value, currentValue, onClick }) {
  const isActive = currentValue === value;
  const classes = isActive
    ? 'border-slate-500 bg-slate-700 text-white'
    : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700';

  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      className={`inline-flex items-center px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${classes}`}
      aria-pressed={isActive}
    >
      {label}
    </button>
  );
}

export default FilterBar;