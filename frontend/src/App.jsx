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
  const [toastVariant, setToastVariant] = useState('success');

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
    setToastVariant('success');
  }

  function handleShowToast(messageKey, variant = 'success') {
    setToastMessage(t(messageKey));
    setToastVariant(variant);
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
    onShowToast: handleShowToast,
  };

  return (
    <div className="flex flex-col min-h-screen bg-[var(--bg-app)] text-[var(--text-primary)]">
      <main className="flex-1 pb-24">
        {isLoading && (
          <div className="max-w-3xl mx-auto p-4 text-[var(--text-muted)] text-sm italic">
            {t('app.loading_tasks')}
          </div>
        )}

        {error && (
          <div className="max-w-3xl mx-auto p-4">
            <div className="p-4 rounded-lg border border-red-200 bg-red-50 text-red-800">
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
        onPhotoComplete={(newTasks) => handleTasksAdded(newTasks)}
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
        <Toast message={toastMessage} variant={toastVariant} onDismiss={() => setToastMessage(null)} />
      )}
    </div>
  );
}

export default App;
