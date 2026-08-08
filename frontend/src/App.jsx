import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getAllTasks, updateTask, connectGoogleCalendar } from './api';
import { supabase } from './supabaseClient';
import { LoginScreen } from './components/LoginScreen';
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

  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);

      // Distinguishes "this sign-in was specifically the Connect Calendar
      // flow" (triggered from Settings, see SettingsModal.jsx) from a normal
      // login — a normal Google login also comes back with a provider_token,
      // just without the Calendar scope, so only send tokens to the backend
      // when this flag was deliberately set right before the calendar OAuth
      // redirect.
      const isConnectingCalendar = sessionStorage.getItem('connecting_google_calendar') === 'true';
      if (isConnectingCalendar && newSession?.provider_token && newSession?.provider_refresh_token) {
        sessionStorage.removeItem('connecting_google_calendar');
        connectGoogleCalendar(newSession.provider_token, newSession.provider_refresh_token).catch(err => {
          console.error('Failed to save calendar connection:', err);
        });
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    // Only fetch once a session exists — before that, the backend would
    // just reject the request with 401 since every /tasks* endpoint now
    // requires a valid auth token.
    if (!session) return;

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
  }, [session]);

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

  // After an agent-proposed action is confirmed (AgentChatModal), the
  // backend already returns the fully updated/created task — no need for a
  // fresh GET /tasks, just fold it into state the same way handleUpdateTask
  // and handleTaskCreated already do for their own flows.
  function handleAgentActionConfirmed(task) {
    setTasks((current) => {
      const exists = current.some((t) => t.record_id === task.record_id);
      if (exists) {
        return current.map((t) => (t.record_id === task.record_id ? task : t));
      }
      return [...current, task];
    });
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

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-[var(--text-muted)] text-sm italic">
        {t('auth.loading')}
      </div>
    );
  }
  if (!session) {
    return <LoginScreen />;
  }

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

      {/* pt-14 clears the two fixed buttons above. They are 40px tall at top-4,
          so they occupy y:16→56, and every view opens with p-4 and no offset of
          its own — which put each screen's <h1> at y:16, directly underneath
          the chat icon. Visible on phones only: on a wide viewport the views'
          max-w-3xl container is centred and clears the buttons horizontally. */}
      <main className="flex-1 pt-14 pb-48">
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

      {isAgentOpen && (
        <AgentChatModal onClose={() => setIsAgentOpen(false)} onTaskConfirmed={handleAgentActionConfirmed} />
      )}
    </div>
  );
}

export default App;
