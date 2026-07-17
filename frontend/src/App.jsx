import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getAllTasks, updateTask } from './api';
import BottomNav from './components/BottomNav';
import InboxView from './components/InboxView';
import TodayView from './components/TodayView';
import UpcomingView from './components/UpcomingView';
import CalendarView from './components/CalendarView';
import BrowseView from './components/BrowseView';
import FloatingActionButtons from './components/FloatingActionButtons';
import AddTaskModal from './components/AddTaskModal';
import Toast from './components/Toast';
import SettingsModal from './components/SettingsModal';
import { AgentChatModal } from './components/AgentChatModal';
import { GearIcon, ChatIcon } from './components/icons';

function App() {
  const { t } = useTranslation();

  const [tasks, setTasks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const [activeTab, setActiveTab] = useState('inbox');
  const [expandedTaskId, setExpandedTaskId] = useState(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAgentOpen, setIsAgentOpen] = useState(false);
  const [toast, setToast] = useState(null); // { message, variant, action?, duration? }

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

  // Notification-tap navigation: the app opened fresh via a deep link
  // (?view=...) from the service worker's notificationclick handler, or
  // the app was already open and the service worker posts a message to
  // switch tabs instead of forcing a reload.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get('view');
    if (viewParam) {
      setActiveTab(viewParam);
      window.history.replaceState({}, '', window.location.pathname);
    }

    function handleServiceWorkerMessage(event) {
      if (event.data?.type === 'NAVIGATE' && event.data.view) {
        setActiveTab(event.data.view);
      }
    }
    navigator.serviceWorker?.addEventListener('message', handleServiceWorkerMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', handleServiceWorkerMessage);
  }, []);

  // Developer mode unlock: visiting once with ?dev=1 persists it in
  // localStorage so the hidden Developer settings category stays available
  // on future visits without the query param.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('dev') === '1') {
      localStorage.setItem('dev_mode', 'true');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  function handleTasksAdded(newTasks) {
    setTasks((current) => [...newTasks, ...current]);
    const count = newTasks.length;
    setToast({
      message: count === 1 ? t('toast.added_one') : t('toast.added_many', { count }),
      variant: 'success',
    });
  }

  // Legacy signature: handleShowToast(translationKey, variant) — used throughout
  // TaskCard/views. New signature: handleShowToast({ message, variant, action, duration })
  // — message is already-translated, used by CalendarView for the reschedule/undo toast.
  function handleShowToast(messageOrConfig, variant = 'success') {
    if (typeof messageOrConfig === 'object' && messageOrConfig !== null) {
      setToast({
        message: messageOrConfig.message,
        variant: messageOrConfig.variant || 'success',
        action: messageOrConfig.action,
        duration: messageOrConfig.duration,
      });
      return;
    }
    setToast({ message: t(messageOrConfig), variant });
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

  function handleTaskCreated(task) {
    setTasks((prev) => [...prev, task]);
    setToast({ message: t('toast.added_one'), variant: 'success' });
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
      <button
        onClick={() => setIsAgentOpen(true)}
        className="fixed top-4 left-4 z-30 w-10 h-10 rounded-full bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-[var(--shadow-card)] flex items-center justify-center hover:bg-[var(--bg-hover)] transition-colors"
        aria-label={t('agent.open')}
      >
        <ChatIcon className="w-5 h-5 text-[var(--text-secondary)]" />
      </button>

      <button
        onClick={() => setIsSettingsOpen(true)}
        className="fixed top-4 right-4 z-30 w-10 h-10 rounded-full bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-[var(--shadow-card)] flex items-center justify-center hover:bg-[var(--bg-hover)] transition-colors"
        aria-label={t('settings.open')}
      >
        <GearIcon className="w-5 h-5 text-[var(--text-secondary)]" />
      </button>

      <main className="flex-1 pb-48">
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
            {activeTab === 'calendar' && <CalendarView {...viewProps} onTaskCreated={handleTaskCreated} />}
            {activeTab === 'browse' && <BrowseView {...viewProps} />}
          </>
        )}
      </main>

      {expandedTaskId === null && (
        <FloatingActionButtons
          onAddClick={() => setIsAddModalOpen(true)}
          onVoiceComplete={(newTasks) => handleTasksAdded(newTasks)}
          onPhotoComplete={(newTasks) => handleTasksAdded(newTasks)}
        />
      )}

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

      {toast && (
        <Toast
          message={toast.message}
          variant={toast.variant}
          action={toast.action}
          duration={toast.duration || 3000}
          onDismiss={() => setToast(null)}
        />
      )}

      {isSettingsOpen && (
        <SettingsModal onClose={() => setIsSettingsOpen(false)} />
      )}

      {isAgentOpen && <AgentChatModal onClose={() => setIsAgentOpen(false)} />}
    </div>
  );
}

export default App;
