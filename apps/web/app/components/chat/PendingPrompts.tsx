'use client';

import React, { useCallback, useEffect, useState } from 'react';

import { summarizePendingPrompts } from '@taskforceai/presenters/chat/pending-prompts';
import { logger } from '../../lib/logger';
import { useConversationStore } from '../../lib/platform/PlatformProvider';
import type { PendingPromptRecord as PendingPrompt } from '../../lib/platform/platform-interfaces';

const PendingPrompts: React.FC = () => {
  const conversationStore = useConversationStore();
  const [pendingPrompts, setPendingPrompts] = useState<PendingPrompt[]>([]);
  const [expanded, setExpanded] = useState(false);

  const loadPendingPrompts = useCallback(async () => {
    const prompts = await conversationStore.listPendingPrompts();
    setPendingPrompts(prompts);
  }, [conversationStore]);

  const handleDelete = useCallback(
    async (promptId: number) => {
      try {
        await conversationStore.removePrompt(promptId);
        await loadPendingPrompts();
      } catch (error) {
        logger.error('Failed to delete prompt:', error);
      }
    },
    [conversationStore, loadPendingPrompts]
  );

  useEffect(() => {
    void loadPendingPrompts();
  }, [loadPendingPrompts]);

  useEffect(() => {
    const unsubscribe = conversationStore.subscribe((event) => {
      if (event.type === 'pending-prompts-changed') {
        void loadPendingPrompts();
      }
    });
    return unsubscribe;
  }, [conversationStore, loadPendingPrompts]);

  if (pendingPrompts.length === 0) {
    return null;
  }

  const summary = summarizePendingPrompts(pendingPrompts);

  return (
    <div className="pending-prompts fixed right-4 bottom-20 z-40 max-w-md">
      <div className="overflow-hidden rounded-lg bg-blue-600 text-white shadow-lg">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center justify-between px-4 py-3 transition-colors hover:bg-blue-700"
        >
          <div className="flex items-center gap-2">
            <svg
              className="h-5 w-5"
              fill="currentColor"
              viewBox="0 0 20 20"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
              <path
                fillRule="evenodd"
                d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z"
                clipRule="evenodd"
              />
            </svg>
            <span className="font-medium">{summary.webQueueLabel}</span>
          </div>
          <svg
            className={`h-5 w-5 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="currentColor"
            viewBox="0 0 20 20"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              fillRule="evenodd"
              d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>

        {expanded && (
          <div className="max-h-64 overflow-y-auto bg-white text-gray-900">
            {pendingPrompts.map((prompt) => {
              const statusClass =
                prompt.status === 'queued'
                  ? 'bg-blue-100 text-blue-800'
                  : prompt.status === 'pending'
                    ? 'bg-yellow-100 text-yellow-800'
                    : 'bg-red-100 text-red-800';
              return (
                <div key={prompt.id} className="border-b border-gray-200 px-4 py-3 last:border-b-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{prompt.prompt}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        {new Date(prompt.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`flex-shrink-0 rounded px-2 py-1 text-xs font-medium ${statusClass}`}
                      >
                        {prompt.status}
                      </span>
                      <button
                        onClick={() => {
                          if (typeof prompt.id === 'number') {
                            void handleDelete(prompt.id);
                          }
                        }}
                        className="flex-shrink-0 p-1 text-gray-400 transition-colors hover:text-red-600"
                        title="Delete queued message"
                        aria-label="Delete queued message"
                      >
                        <svg
                          className="h-4 w-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {summary.failedRetryLabel && (
          <div className="border-t border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800">
            {summary.failedRetryLabel}
          </div>
        )}
      </div>
    </div>
  );
};

export default PendingPrompts;
