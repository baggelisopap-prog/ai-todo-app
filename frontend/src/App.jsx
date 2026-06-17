import { useState, useEffect, useMemo } from 'react';
import { getAllTasks, updateTask } from './api';
import TaskList from './components/TaskList';
import FilterBar from './components/FilterBar';
import NewTaskInput from './components/NewTaskInput';
import Toast from './components/Toast';

function App() {
  // Data state
  const [tasks, setTasks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filter state
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [sortBy, setSortBy] = useState('newest');
  const [showCompleted, setShowCompleted] = useState(false);
  const [showRejected, setShowRejected] = useState(false);

  // Expand state — only one card open at a time
  const [expandedTaskId, setExpandedTaskId] = useState(null);

  // Toast state
  const [toastMessage, setToastMessage] = useState(null);

  // Fetch tasks on mount
  useEffect(() => {
    async function loadTasks() {
      try {
        setIsLoading(true);
        setError(null);
        const data = await getAllTasks();
        setTasks(data.tasks);
      } catch (err) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    }
    loadTasks();
  }, []);

  function handleTasksAdded(newTasks) {
    setTasks((current) => [...newTasks, ...current]);
    const count = newTasks.length;
    setToastMessage(
      count === 1 ? 'Added 1 task' : `Added ${count} tasks`
    );
  }

  async function handleUpdateTask(recordId, updates) {
    const updatedTask = await updateTask(recordId, updates);
    setTasks((current) =>
      current.map((t) => (t.record_id === recordId ? updatedTask : t))
    );
    return updatedTask;
  }

  // Toggle expand: if same id, collapse; if different, switch; null collapses all
  function handleToggleExpand(recordId) {
    setExpandedTaskId((current) => {
      if (recordId === null) return null;
      if (current === recordId) return null; // collapse if already open
      return recordId; // open this one (auto-collapses any other)
    });
  }

  // Category counts (excludes completed/rejected per current toggle state)
  const categoryCounts = useMemo(() => {
    let relevantTasks = tasks;
    if (!showCompleted) {
      relevantTasks = relevantTasks.filter((t) => !t.is_completed);
    }
    if (!showRejected) {
      relevantTasks = relevantTasks.filter((t) => !t.is_rejected);
    }
    return {
      All: relevantTasks.length,
      Business: relevantTasks.filter((t) => t.category === 'Business').length,
      Personal: relevantTasks.filter((t) => t.category === 'Personal').length,
      Unknown: relevantTasks.filter((t) => t.category === 'Unknown').length,
    };
  }, [tasks, showCompleted, showRejected]);

  const completedCount = useMemo(
    () => tasks.filter((t) => t.is_completed).length,
    [tasks]
  );

  const rejectedCount = useMemo(
    () => tasks.filter((t) => t.is_rejected).length,
    [tasks]
  );

  const filteredTasks = useMemo(() => {
    let result = tasks;
    if (!showCompleted) {
      result = result.filter((t) => !t.is_completed);
    }
    if (!showRejected) {
      result = result.filter((t) => !t.is_rejected);
    }
    if (selectedCategory !== 'All') {
      result = result.filter((t) => t.category === selectedCategory);
    }
    return result;
  }, [tasks, selectedCategory, showCompleted, showRejected]);

  const visibleCount = filteredTasks.length;
  const pendingCount = filteredTasks.filter((t) => !t.approval_status).length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold text-white">AI To-Do</h1>
          <p className="text-sm text-slate-400 mt-1">
            {isLoading
              ? 'Loading...'
              : `${visibleCount} tasks${pendingCount > 0 ? ` · ${pendingCount} pending` : ''}`}
          </p>
        </header>

        {!isLoading && !error && (
          <FilterBar
            categoryCounts={categoryCounts}
            selectedCategory={selectedCategory}
            onSelectCategory={setSelectedCategory}
            sortBy={sortBy}
            onSelectSort={setSortBy}
            showCompleted={showCompleted}
            onToggleCompleted={() => setShowCompleted((v) => !v)}
            completedCount={completedCount}
            showRejected={showRejected}
            onToggleRejected={() => setShowRejected((v) => !v)}
            rejectedCount={rejectedCount}
          />
        )}

        {!isLoading && !error && (
          <NewTaskInput onTasksAdded={handleTasksAdded} />
        )}

        <section>
          {error && (
            <div className="p-4 rounded-lg border border-red-900 bg-red-950 text-red-300">
              <p className="font-medium">Failed to load tasks</p>
              <p className="text-sm mt-1 opacity-80">{error}</p>
            </div>
          )}

          {!error && isLoading && (
            <div className="p-4 text-slate-500 text-sm">Loading tasks...</div>
          )}

          {!error && !isLoading && (
            <TaskList
              tasks={filteredTasks}
              sortBy={sortBy}
              expandedTaskId={expandedTaskId}
              onToggleExpand={handleToggleExpand}
              onUpdateTask={handleUpdateTask}
            />
          )}
        </section>
      </div>

      {toastMessage && (
        <Toast
          message={toastMessage}
          onDismiss={() => setToastMessage(null)}
        />
      )}
    </div>
  );
}

export default App;