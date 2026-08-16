import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getAllTasks, updateTask, connectGoogleCalendar, getProfile } from './api';
import { supabase } from './supabaseClient';
import { LoginScreen } from './components/LoginScreen';
import BottomNav from './components/BottomNav';
import InboxView from './components/InboxView';
import TodayView from './components/TodayView';
import CalendarView from './components/CalendarView';
import BrowseView from './components/BrowseView';
import FloatingActionButtons from './components/FloatingActionButtons';
import AddTaskModal from './components/AddTaskModal';
import Toast from './components/Toast';
import SettingsModal from './components/SettingsModal';
import { AgentChatModal } from './components/AgentChatModal';
import { AppSettingsProvider } from './components/AppSettingsProvider';
import AppBar from './components/AppBar';
import { isVisibleTask } from './utils/taskDisplay';

// The AppBar shows the current screen's name, so the title each view used to
// print inside its own scroll container now lives in one place. Calendar covers
// what used to be two tabs, so it is named for the broader job.
const TAB_TITLE_KEYS = {
  inbox: 'nav.inbox',
  today: 'nav.today',
  calendar: 'nav.calendar',
  browse: 'nav.browse',
};

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

  // Loaded once here rather than by SettingsModal on every open, because the
  // AppBar's avatar needs it too and two components fetching one object is the
  // shape that produced the settings bug (see AppSettingsProvider.jsx).
  // Deliberately non-blocking: the bar falls back to a gear icon until it lands.
  const [profile, setProfile] = useState(null);

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

  useEffect(() => {
    if (!session) return;
    getProfile()
      .then(setProfile)
      .catch(err => console.error('Failed to load profile:', err));
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

  // Must stay identical to InboxView's own filter — a badge that disagrees with
  // the list it points at is worse than no badge.
  const pendingCount = tasks.filter(
    (task) => isVisibleTask(task) && !task.is_completed && !task.approval_status
  ).length;

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

  // The provider sits INSIDE the session check on purpose: every /settings
  // request needs a bearer token, so mounting it above the LoginScreen would
  // fire a guaranteed 401 on every visit by a logged-out user.
  return (
    <AppSettingsProvider>
    <div className="flex flex-col min-h-screen bg-[var(--bg-app)] text-[var(--text-primary)]">
      <AppBar
        title={t(TAB_TITLE_KEYS[activeTab])}
        profile={profile}
        onOpenAgent={() => setIsAgentOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      {/* No pt-* here any more. The old one existed only to push content out
          from under two fixed circular buttons; AppBar is sticky and in flow,
          so it takes its own space. */}
      <main className="flex-1 pb-48">
        {isLoading && (
          <div className="max-w-3xl mx-auto p-4 text-[var(--text-muted)] text-sm italic">
            {t('app.loading_tasks')}
          </div>
        )}

        {error && (
          <div className="max-w-3xl mx-auto p-4">
            <div className="p-4 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-text)]">
              <p className="font-medium">{t('errors.load_tasks_failed')}</p>
              <p className="text-sm mt-1 opacity-80">{error}</p>
            </div>
          </div>
        )}

        {!isLoading && !error && (
          <>
            {activeTab === 'inbox' && <InboxView {...viewProps} />}
            {activeTab === 'today' && <TodayView {...viewProps} />}
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

      <BottomNav activeTab={activeTab} onTabChange={handleTabChange} inboxCount={pendingCount} />

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
        <SettingsModal
          onClose={() => setIsSettingsOpen(false)}
          onShowToast={handleShowToast}
          profile={profile}
          onProfileUpdate={setProfile}
        />
      )}

      {isAgentOpen && (
        <AgentChatModal onClose={() => setIsAgentOpen(false)} onTaskConfirmed={handleAgentActionConfirmed} />
      )}
    </div>
    </AppSettingsProvider>
  );
}

export default App;
