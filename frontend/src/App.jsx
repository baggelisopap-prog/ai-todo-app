import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getAllTasks, updateTask } from './api';
import BottomNav from './components/BottomNav';
import InboxView from './components/InboxView';
import TodayView from './components/TodayView';
import UpcomingView from './components/UpcomingView';
import BrowseView from './components/BrowseView';
import FloatingActionButtons from './components/FloatingActionButtons';
import AddTaskModal from './components/AddTaskModal';
import Toast from './components/Toast';

function App() {
  const { t } = useTranslation();

  const [tasks, setTasks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const [activeTab, setActiveTab] = useState('inbox');
  const [expandedTaskId, setExpandedTaskId] = useState(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

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
      count === 1 ? t('toast.added_one') : t('toast.added_many', { count })
    );
  }

  async function handleUpdateTask(recordId, updates) {
    const updatedTask = await updateTask(recordId, updates);
    setTasks((current) =>
      current.map((task) => (task.record_id === recordId ? updatedTask : task))
    );
    return updatedTask;
  }

  function handleTaskDeleted(recordId) {
    setTasks((prev) => prev.filter((task) => task.record_id !== recordId));
  }

  function handleToggleExpand(recordId) {
    setExpandedTaskId((current) => {
      if (recordId === null) return null;
      if (current === recordId) return null;
      return recordId;
    });
  }

  function handleTabChange(tab) {
    setActiveTab(tab);
    setExpandedTaskId(null);
  }

  const viewProps = {
    tasks,
    expandedTaskId,
    onToggleExpand: handleToggleExpand,
    onTaskUpdate: handleUpdateTask,
    onTaskDeleted: handleTaskDeleted,
  };

  return (
    <div className="flex flex-col min-h-screen bg-slate-950 text-slate-100">
      <main className="flex-1 pb-20">
        {isLoading && (
          <div className="max-w-3xl mx-auto px-4 py-6 text-slate-500 text-sm">
            {t('app.loading_tasks')}
          </div>
        )}

        {error && (
          <div className="max-w-3xl mx-auto px-4 py-6">
            <div className="p-4 rounded-lg border border-red-900 bg-red-950 text-red-300">
              <p className="font-medium">{t('errors.load_tasks_failed')}</p>
              <p className="text-sm mt-1 opacity-80">{error}</p>
            </div>
          </div>
        )}

        {!isLoading && !error && (
          <>
            {activeTab === 'inbox' && <InboxView {...viewProps} />}
            {activeTab === 'today' && <TodayView {...viewProps} />}
            {activeTab === 'upcoming' && <UpcomingView {...viewProps} />}
            {activeTab === 'browse' && <BrowseView {...viewProps} />}
          </>
        )}
      </main>

      <FloatingActionButtons
        onAddClick={() => setIsAddModalOpen(true)}
        onVoiceComplete={(newTasks) => handleTasksAdded(newTasks)}
      />

      <BottomNav activeTab={activeTab} onTabChange={handleTabChange} />

      {isAddModalOpen && (
        <AddTaskModal
          onClose={() => setIsAddModalOpen(false)}
          onTasksAdded={(newTasks) => {
            handleTasksAdded(newTasks);
            setIsAddModalOpen(false);
          }}
        />
      )}

      {toastMessage && (
        <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />
      )}
    </div>
  );
}

export default App;
