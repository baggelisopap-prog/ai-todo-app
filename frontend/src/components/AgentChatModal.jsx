import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useModalBehavior } from '../hooks/useModalBehavior';
import Markdown from 'react-markdown';
import { askAgent, confirmAgentAction } from '../api';

// Maps a proposed action's field name to the app's existing field-label
// translation key, so cards never hardcode English field names.
const FIELD_LABEL_KEYS = {
  due_date: 'task.due_date_label',
  due_time: 'task.due_time_label',
  priority: 'task.priority_label',
  category: 'task.category_label',
  task_name: 'task.name_placeholder',
  description: 'task.description_label',
};

// Category is the only field whose VALUE also has an existing translation
// (Business/Personal/Unknown/Hostaway); every other field's value is shown
// as-is (dates, times, priority codes, free text).
const CATEGORY_VALUE_KEYS = {
  Business: 'browse.filter_business',
  Personal: 'browse.filter_personal',
  Unknown: 'browse.filter_unknown',
  Hostaway: 'browse.filter_hostaway',
};

// Starter suggestion chips shown only while the conversation is empty —
// translation keys, not hardcoded strings, so both EN and EL render
// naturally (see locales/en.json and locales/el.json). Read-only questions
// only, deliberately no "add a task" chip: creating a task through the
// agent costs a proposal round for what the add-task form does for free
// (see DECISIONS.md).
const SUGGESTION_KEYS = [
  'agent.suggestion_today',
  'agent.suggestion_overdue',
  'agent.suggestion_week',
];

function fieldLabel(t, field) {
  const key = FIELD_LABEL_KEYS[field];
  return key ? t(key) : field;
}

function fieldValue(t, field, value) {
  if (field === 'category' && CATEGORY_VALUE_KEYS[value]) {
    return t(CATEGORY_VALUE_KEYS[value]);
  }
  return value;
}

// Renders the filters the agent actually searched with, as returned under
// `searches`. This exists because the agent was observed narrowing a search
// with a category or a date the user never mentioned, and then reporting "you
// have none" over the result — invisibly. The backend now detects and warns
// the agent about that case, but only the user knows what they actually meant,
// so the filters are shown to them as the last line of defence. Same principle
// as the confirmation cards: make the machine's intent visible before it
// matters, rather than asking the user to trust it.
function describeFilters(t, filters) {
  const parts = [];
  const { keyword, category, priority, date_from: from, date_to: to, include_completed: done } = filters;

  if (keyword) parts.push(t('agent.searched_filter_keyword', { value: keyword }));
  if (category) parts.push(t('agent.searched_filter_category', { value: fieldValue(t, 'category', category) }));
  if (priority) parts.push(t('agent.searched_filter_priority', { value: priority }));
  // A single-day search is the common case and reads badly as "from X until X".
  if (from && to && from === to) parts.push(t('agent.searched_filter_on', { value: from }));
  else {
    if (from) parts.push(t('agent.searched_filter_from', { value: from }));
    if (to) parts.push(t('agent.searched_filter_to', { value: to }));
  }
  if (done) parts.push(t('agent.searched_filter_completed'));

  return parts.length ? parts.join(', ') : t('agent.searched_all_open');
}

function SearchTrace({ searches, t }) {
  if (!searches?.length) return null;

  return (
    <div className="mt-1.5 space-y-0.5">
      {searches.map((search, idx) => (
        <p key={idx} className="text-xs text-[var(--text-muted)]">
          <span className="opacity-70">{t('agent.searched_label')}:</span>{' '}
          {describeFilters(t, search.filters || {})}
          {' · '}
          {t('agent.searched_results', { count: search.total_matches ?? 0 })}
        </p>
      ))}
    </div>
  );
}

function ProposalCard({ action, t, onConfirm, onCancel }) {
  const isBusy = action.status === 'pending';
  const isDone = action.status === 'done';
  const isCancelled = action.status === 'cancelled';
  const canAct = action.status === 'idle' || action.status === 'error';

  if (isDone) {
    return (
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] flex items-start gap-2">
        <span className="text-green-600 dark:text-green-400">✓</span>
        <span>
          <span className="font-medium">{t('agent.action_done')}:</span> {action.resultMessage}
        </span>
      </div>
    );
  }

  if (isCancelled) {
    return (
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-muted)] italic opacity-60">
        {t('agent.action_cancelled')}
      </div>
    );
  }

  return (
    <div className="rounded-lg border-2 border-[var(--brand-primary)]/40 bg-[var(--bg-card)] shadow-[var(--shadow-card)] p-3 text-sm">
      <div className="text-[var(--text-primary)]">
        {action.type === 'complete_task' && (
          <p className="font-medium">{t('agent.proposal_complete', { task_name: action.task_name })}</p>
        )}

        {action.type === 'update_task' && (
          <>
            <p className="font-medium">{action.task_name}</p>
            <ul className="mt-1 space-y-0.5 text-[var(--text-secondary)]">
              {Object.entries(action.fields || {}).map(([field, value]) => (
                <li key={field}>
                  {t('agent.proposal_update', { field: fieldLabel(t, field), value: fieldValue(t, field, value) })}
                </li>
              ))}
            </ul>
          </>
        )}

        {action.type === 'create_task' && (
          <>
            <p className="font-medium">{t('agent.proposal_create', { task_name: action.fields?.task_name })}</p>
            <ul className="mt-1 space-y-0.5 text-[var(--text-secondary)]">
              {Object.entries(action.fields || {})
                .filter(([field, value]) => field !== 'task_name' && value)
                .map(([field, value]) => (
                  <li key={field}>
                    {fieldLabel(t, field)}: {fieldValue(t, field, value)}
                  </li>
                ))}
            </ul>
            <p className="mt-1 text-xs italic text-[var(--text-muted)]">{t('agent.create_needs_approval')}</p>
          </>
        )}
      </div>

      {action.status === 'error' && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">
          {t('agent.action_failed')}: {action.errorMessage}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <button
          onClick={onConfirm}
          disabled={!canAct}
          className="px-3 py-1.5 rounded-md bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] text-white text-xs font-medium disabled:opacity-50"
        >
          {isBusy ? t('agent.action_pending') : t('agent.confirm')}
        </button>
        <button
          onClick={onCancel}
          disabled={!canAct}
          className="px-3 py-1.5 rounded-md border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] text-xs font-medium disabled:opacity-50"
        >
          {t('agent.cancel')}
        </button>
      </div>
    </div>
  );
}

export function AgentChatModal({ onClose, onTaskConfirmed }) {
  useModalBehavior(onClose);
  const { t } = useTranslation();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  // The conversation lives exactly as long as the modal is open (or until
  // "New conversation" is tapped) — see resetConversation below. The
  // backend reconstructs history from this id; nothing else is ever sent.
  const [conversationId, setConversationId] = useState(null);
  const messagesEndRef = useRef(null);
  const inFlightActionIds = useRef(new Set());

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  async function sendMessage(question) {
    if (!question || isLoading) return;

    setMessages(prev => [...prev, { role: 'user', text: question }]);
    setInput('');
    setIsLoading(true);

    try {
      const result = await askAgent(question, conversationId);
      setConversationId(result.conversation_id);
      const actions = (result.proposed_actions || []).map(action => ({ ...action, status: 'idle' }));
      setMessages(prev => [
        ...prev,
        { role: 'agent', text: result.answer, actions, searches: result.searches || [] },
      ]);
    } catch {
      setMessages(prev => [...prev, { role: 'agent', text: t('agent.error') }]);
    } finally {
      setIsLoading(false);
    }
  }

  function handleSend() {
    sendMessage(input.trim());
  }

  function handleSuggestionClick(question) {
    setInput(question);
    sendMessage(question);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // Shared by the X close button and "New conversation": un-confirmed
  // proposal cards are ephemeral (kept only in `messages`) and are never
  // restored, so clearing messages here is enough to drop them too.
  function resetConversation() {
    setConversationId(null);
    setMessages([]);
    setInput('');
  }

  function handleClose() {
    resetConversation();
    onClose();
  }

  // Updates a single action's local card state by action_id, wherever it
  // lives in the message list. Never touches any other card.
  function updateAction(actionId, updates) {
    setMessages(prev =>
      prev.map(msg => {
        if (!msg.actions?.some(a => a.action_id === actionId)) return msg;
        return {
          ...msg,
          actions: msg.actions.map(a => (a.action_id === actionId ? { ...a, ...updates } : a)),
        };
      })
    );
  }

  async function handleConfirmAction(action) {
    // Guards double-click and re-confirming an already-done/cancelled card:
    // the ref check is synchronous (closes the gap before React re-renders
    // with the disabled button), the status check covers everything else.
    if (inFlightActionIds.current.has(action.action_id)) return;
    if (action.status !== 'idle' && action.status !== 'error') return;

    inFlightActionIds.current.add(action.action_id);
    updateAction(action.action_id, { status: 'pending', errorMessage: null });

    try {
      const result = await confirmAgentAction({
        action_id: action.action_id,
        type: action.type,
        record_id: action.record_id,
        task_name: action.task_name,
        fields: action.fields,
      });
      updateAction(action.action_id, { status: 'done', resultMessage: result.message });
      if (result.task) {
        onTaskConfirmed?.(result.task);
      }
    } catch (err) {
      updateAction(action.action_id, { status: 'error', errorMessage: err.message });
    } finally {
      inFlightActionIds.current.delete(action.action_id);
    }
  }

  function handleCancelAction(action) {
    if (action.status !== 'idle' && action.status !== 'error') return;
    updateAction(action.action_id, { status: 'cancelled' });
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center p-4"
      onClick={handleClose}
    >
      <div
        className="w-full md:max-w-lg h-[80vh] md:h-[600px] bg-[var(--bg-modal)] md:rounded-lg rounded-t-2xl shadow-[var(--shadow-modal)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-subtle)]">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">{t('agent.title')}</h2>
          <div className="flex items-center gap-3">
            {messages.length > 0 && (
              <button
                onClick={resetConversation}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              >
                {t('agent.new_conversation')}
              </button>
            )}
            <button onClick={handleClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label={t('actions.cancel')}>
              ✕
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <p className="text-sm text-[var(--text-muted)] italic">{t('agent.empty_hint')}</p>
          )}
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div
                className={`max-w-[80%] px-3 py-2 rounded-lg text-sm ${
                  msg.role === 'user'
                    ? 'bg-[var(--brand-primary)] text-white whitespace-pre-wrap'
                    : 'bg-[var(--bg-hover)] text-[var(--text-primary)]'
                }`}
              >
                {msg.role === 'agent' ? (
                  <Markdown
                    components={{
                      p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                      strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                      ul: ({ children }) => <ul className="list-disc list-inside space-y-1 mb-2 last:mb-0">{children}</ul>,
                      ol: ({ children }) => <ol className="list-decimal list-inside space-y-1 mb-2 last:mb-0">{children}</ol>,
                      li: ({ children }) => <li>{children}</li>,
                    }}
                  >
                    {msg.text}
                  </Markdown>
                ) : (
                  msg.text
                )}
              </div>

              {msg.role === 'agent' && <SearchTrace searches={msg.searches} t={t} />}

              {msg.actions?.length > 0 && (
                <div className="w-full max-w-[80%] mt-2 space-y-2">
                  {msg.actions.map(action => (
                    <ProposalCard
                      key={action.action_id}
                      action={action}
                      t={t}
                      onConfirm={() => handleConfirmAction(action)}
                      onCancel={() => handleCancelAction(action)}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-[var(--bg-hover)] px-3 py-2 rounded-lg text-sm text-[var(--text-muted)]">
                {t('agent.thinking')}
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="border-t border-[var(--border-subtle)]">
          {messages.length === 0 && (
            <div className="px-3 pt-3 flex flex-wrap gap-2">
              {SUGGESTION_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleSuggestionClick(t(key))}
                  disabled={isLoading}
                  className="px-3 py-1.5 rounded-full text-sm bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-50"
                >
                  {t(key)}
                </button>
              ))}
            </div>
          )}
          <div className="p-3 flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('agent.input_placeholder')}
              disabled={isLoading}
              className="flex-1 px-3 py-2 rounded-md border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] bg-[var(--bg-card)] disabled:opacity-50"
            />
            <button
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
              className="px-4 py-2 rounded-md bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] text-white font-medium disabled:opacity-50"
            >
              {t('agent.send')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
