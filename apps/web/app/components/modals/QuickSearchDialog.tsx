'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { logger } from '../../lib/logger';
import { useConversationStore } from '../../lib/platform/PlatformProvider';
import type { ConversationRecord } from '../../lib/platform/platform-interfaces';
import { formatRecentDayLabel } from '@taskforceai/presenters/time/display-format';

interface QuickSearchDialogProps {
  isOpen: boolean;
  isAuthenticated: boolean;
  onClose: () => void;
  onNewChat: () => void;
  onSelect: (record: ConversationRecord) => Promise<void> | void;
}

export const QuickSearchDialog: React.FC<QuickSearchDialogProps> = ({
  isOpen,
  isAuthenticated,
  onClose,
  onNewChat,
  onSelect,
}) => {
  const conversationStore = useConversationStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ConversationRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setSelectedId(null);
      return undefined;
    }

    let canceled = false;
    const loadConversations = async () => {
      setIsLoading(true);
      try {
        const records = await conversationStore.listConversations(40);
        if (!canceled) {
          setResults(records);
        }
      } catch (error) {
        logger.error('Failed to load conversations for quick search', { error });
        if (!canceled) {
          setResults([]);
        }
      } finally {
        if (!canceled) {
          setIsLoading(false);
        }
      }
    };
    void loadConversations();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      canceled = true;
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [conversationStore, isOpen, onClose]);

  const filteredResults = useMemo(() => {
    if (!query) {
      return results;
    }
    const value = query.toLowerCase();
    return results.filter(
      (record) =>
        record.title.toLowerCase().includes(value) ||
        (record.lastMessagePreview ?? '').toLowerCase().includes(value)
    );
  }, [query, results]);

  const formatRecentLabel = useCallback((timestamp: number) => formatRecentDayLabel(timestamp), []);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="quick-search-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Quick search"
      onClick={onClose}
    >
      <div className="quick-search-panel" onClick={(event) => event.stopPropagation()}>
        <div className="quick-search-panel__header">
          <input
            type="search"
            placeholder="Search conversations…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
          />
          <button type="button" onClick={onClose} aria-label="Close search overlay">
            ×
          </button>
        </div>
        <div className="quick-search-panel__body">
          <div className="quick-search-panel__list">
            <div className="quick-search-panel__section">
              <div className="quick-search-panel__section-label">Actions</div>
              <button
                type="button"
                className="quick-search-panel__action"
                onClick={() => {
                  onNewChat();
                  onClose();
                }}
                disabled={!isAuthenticated}
              >
                Create New Private Chat
              </button>
            </div>
            <div className="quick-search-panel__section-label">Recent</div>
            <div className="quick-search-panel__results" role="list">
              {isLoading ? (
                <div className="quick-search-panel__empty">Loading conversations…</div>
              ) : filteredResults.length === 0 ? (
                <div className="quick-search-panel__empty">No matching conversations</div>
              ) : (
                filteredResults.map((record) => (
                  <button
                    key={record.conversationId}
                    type="button"
                    role="listitem"
                    className={`quick-search-panel__result ${
                      selectedId === record.conversationId ? 'is-active' : ''
                    }`}
                    onClick={() => {
                      setSelectedId(record.conversationId);
                      void onSelect(record);
                    }}
                  >
                    <div className="quick-search-panel__result-title">{record.title}</div>
                    <div className="quick-search-panel__result-meta">
                      <span>{formatRecentLabel(record.updatedAt)}</span>
                      {record.lastMessagePreview ? (
                        <span className="quick-search-panel__result-preview">
                          {record.lastMessagePreview}
                        </span>
                      ) : null}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
          <div className="quick-search-panel__preview">
            {selectedId ? (
              <>
                <div className="quick-search-panel__preview-title">Conversation preview</div>
                <p className="quick-search-panel__preview-text">
                  Pick up where you left off or open the conversation to view the full history.
                </p>
              </>
            ) : (
              <div className="quick-search-panel__empty-preview">
                Select a conversation to preview
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
