import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { askAgent } from '../api';

export function AgentChatModal({ onClose }) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);

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
      setMessages(prev => [...prev, { role: 'agent', text: result.answer }]);
    } catch (err) {
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
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap ${
                  msg.role === 'user'
                    ? 'bg-[var(--brand-primary)] text-white'
                    : 'bg-[var(--bg-hover)] text-[var(--text-primary)]'
                }`}
              >
                {msg.text}
              </div>
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
