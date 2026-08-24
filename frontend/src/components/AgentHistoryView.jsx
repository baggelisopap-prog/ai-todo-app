import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { getAgentConversations, getAgentConversation } from '../api';

/**
 * Past agent conversations, read-only.
 *
 * Two things this screen deliberately does NOT do. It does not let you resume
 * a conversation — that is the one option of the three that re-sends the old
 * messages to the model and is paid for again on every turn, and it was
 * refused for that reason. And it never claims a proposal "happened" unless a
 * decision row says so: `undecided` is its own state, shown as such, because
 * walking away from a card is a different fact from refusing it.
 *
 * Rendered inside AgentChatModal rather than as a modal of its own — it is the
 * same subject as the chat and belongs behind the same close button.
 */

// Confirmed reads as success, cancelled as danger, and undecided stays neutral
// on purpose: not deciding is not a failure, and colouring it like one would
// nag about every card the user reasonably ignored.
const STATUS_STYLE = {
  confirmed: {
    color: 'var(--success-text)',
    background: 'var(--success-bg)',
    borderColor: 'var(--success-border)',
  },
  cancelled: {
    color: 'var(--danger-text)',
    background: 'var(--danger-bg)',
    borderColor: 'var(--danger-border)',
  },
  undecided: {
    color: 'var(--text-muted)',
    background: 'var(--bg-hover)',
    borderColor: 'var(--border-subtle)',
  },
};

function ProposalLine({ proposal, t }) {
  const style = STATUS_STYLE[proposal.status] || STATUS_STYLE.undecided;
  return (
    <div className="flex items-center justify-between gap-2 text-xs py-1">
      <span className="text-[var(--text-secondary)] truncate">
        {proposal.task_name || t(`agent.history.action_${proposal.type}`)}
      </span>
      <span
        className="shrink-0 px-2 py-0.5 rounded-full border"
        style={style}
      >
        {t(`agent.history.status_${proposal.status}`)}
      </span>
    </div>
  );
}

function AgentHistoryView({ onBack }) {
  const { t } = useTranslation();
  const [conversations, setConversations] = useState([]);
  const [openConversation, setOpenConversation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // Which load failed, so Retry retries THAT one: null means the list.
  const [retryId, setRetryId] = useState(null);

  // A .then()/.catch()/.finally() chain with NO synchronous setState in its
  // own body — the same shape RecurrencesView uses, and for the same reason:
  // called straight from an effect, a synchronous setState here trips
  // react-hooks/set-state-in-effect. `loading` starts true instead.
  const loadList = useCallback(() => {
    return getAgentConversations()
      .then((result) => {
        setConversations(result.conversations || []);
        setFailed(false);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  // Only ever called from a click, never from an effect, which is what makes
  // the synchronous setState above the chain safe here and not in loadList.
  function openOne(conversationId) {
    setLoading(true);
    setFailed(false);
    getAgentConversation(conversationId)
      .then((conversation) => {
        setOpenConversation(conversation);
        setRetryId(null);
      })
      .catch(() => {
        setRetryId(conversationId);
        setFailed(true);
      })
      .finally(() => setLoading(false));
  }

  function handleRetry() {
    if (retryId) {
      openOne(retryId);
      return;
    }
    setLoading(true);
    setFailed(false);
    loadList();
  }

  function formatDay(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
  }

  if (loading) {
    return <p className="text-sm text-[var(--text-muted)] p-4">{t('agent.history.loading')}</p>;
  }

  if (failed) {
    return (
      <div className="p-4 space-y-2">
        <p className="text-sm text-[var(--text-muted)]">{t('agent.history.load_failed')}</p>
        <button
          onClick={handleRetry}
          className="text-sm text-[var(--brand-primary)]"
        >
          {t('agent.history.retry')}
        </button>
      </div>
    );
  }

  if (openConversation) {
    return (
      <div className="p-4 space-y-4">
        <button
          onClick={() => setOpenConversation(null)}
          className="text-sm text-[var(--brand-primary)]"
        >
          ← {t('agent.history.back_to_list')}
        </button>

        {openConversation.turns.map((turn) => (
          <div key={turn.run_id} className="space-y-2">
            <div className="flex justify-end">
              <div className="max-w-[80%] px-3 py-2 rounded-lg text-sm bg-[var(--brand-primary)] text-[var(--text-inverse)] whitespace-pre-wrap">
                {turn.question}
              </div>
            </div>
            <div className="flex justify-start">
              <div className="max-w-[80%] px-3 py-2 rounded-lg text-sm bg-[var(--bg-hover)] text-[var(--text-primary)] whitespace-pre-wrap">
                {turn.answer || t('agent.history.no_answer')}
              </div>
            </div>
            {turn.proposals.length > 0 && (
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2">
                {turn.proposals.map((proposal) => (
                  <ProposalLine key={proposal.action_id} proposal={proposal} t={t} />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      <button onClick={onBack} className="text-sm text-[var(--brand-primary)]">
        ← {t('agent.history.back_to_chat')}
      </button>

      {conversations.length === 0 && (
        <p className="text-sm text-[var(--text-muted)] italic">{t('agent.history.empty')}</p>
      )}

      {conversations.map((conversation) => (
        <button
          key={conversation.conversation_id}
          onClick={() => openOne(conversation.conversation_id)}
          className="w-full text-left rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2 hover:bg-[var(--bg-hover)] transition-colors"
        >
          <p className="text-sm text-[var(--text-primary)] truncate">{conversation.title}</p>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {formatDay(conversation.last_at)}
            {' · '}
            {t('agent.history.turns', { count: conversation.turns })}
            {conversation.proposals > 0 && (
              <> {' · '}{t('agent.history.proposals', { count: conversation.proposals })}</>
            )}
          </p>
        </button>
      ))}
    </div>
  );
}

export default AgentHistoryView;
