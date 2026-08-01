import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const inFlightActionIds = useRef(new Set());

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  async function handleSend() {
    const question = input.trim();
    if (!question || isLoading) return;

    setMessages(prev => [...prev, { role: 'user', text: question }]);
    setInput('');
    setIsLoading(true);

    try {
      const result = await askAgent(question);
      const actions = (result.proposed_actions || []).map(action => ({ ...action, status: 'idle' }));
      setMessages(prev => [...prev, { role: 'agent', text: result.answer, actions }]);
    } catch {
      setMessages(prev => [...prev, { role: 'agent', text: t('agent.error') }]);
    } finally {
      setIsLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
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
      onClick={onClose}
    >
      <div
        className="w-full md:max-w-lg h-[80vh] md:h-[600px] bg-[var(--bg-modal)] md:rounded-lg rounded-t-2xl shadow-[var(--shadow-modal)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-subtle)]">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">{t('agent.title')}</h2>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label={t('actions.cancel')}>
            ✕
          </button>
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

        <div className="p-3 border-t border-[var(--border-subtle)] flex gap-2">
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
  );
}
