import { renderHook } from '@testing-library/react';
import { vi } from 'bun:test';
import { err, ok } from '@taskforceai/client-core/result';

import { useConversationState, type UseConversationStateProps } from './useConversationState';
import type { ConversationStore, KeyValueStorage, MessageRecord } from '../shared/types';

export const ACTIVE_CONVERSATION_KEY = 'active-conversation';

export const createConversationStore = (
  overrides: Partial<ConversationStore> = {}
): ConversationStore => ({
  ensureConversation: vi.fn().mockResolvedValue(undefined),
  renameConversation: vi.fn().mockResolvedValue(undefined),
  getConversation: vi
    .fn()
    .mockResolvedValue(err({ kind: 'not_found' as const, message: 'Missing conversation' })),
  getConversationMessages: vi.fn().mockResolvedValue([]),
  upsertMessage: vi.fn().mockResolvedValue(undefined),
  listConversations: vi.fn().mockResolvedValue([]),
  clearConversation: vi.fn().mockResolvedValue(undefined),
  replaceConversationId: vi.fn().mockResolvedValue(undefined),
  enqueuePrompt: vi.fn().mockResolvedValue(undefined),
  updatePromptStatus: vi.fn().mockResolvedValue(undefined),
  removePrompt: vi.fn().mockResolvedValue(undefined),
  listPendingPrompts: vi.fn().mockResolvedValue([]),
  subscribe: vi.fn().mockReturnValue(() => {}),
  ...overrides,
});

type RestorableConversationStoreOptions = {
  title?: string;
  messages?: MessageRecord[];
  getConversationMessages?: ConversationStore['getConversationMessages'];
};

export const createRestorableConversationStore = (
  options: RestorableConversationStoreOptions = {}
): ConversationStore =>
  createConversationStore({
    getConversation: vi.fn().mockImplementation(async (conversationId: string) =>
      ok({
        conversationId,
        title: options.title ?? conversationId,
        createdAt: 1,
        updatedAt: 2,
        lastMessagePreview: null,
      })
    ),
    getConversationMessages:
      options.getConversationMessages ??
      vi
        .fn()
        .mockImplementation(
          async (conversationId: string) =>
            options.messages ?? [
              createMessageRecord(
                `m-${conversationId}`,
                conversationId,
                'assistant',
                conversationId
              ),
            ]
        ),
  });

export const createStorage = (overrides: Partial<KeyValueStorage> = {}): KeyValueStorage => ({
  getItem: vi.fn().mockResolvedValue(null),
  setItem: vi.fn().mockResolvedValue(undefined),
  removeItem: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

export const createMessageRecord = (
  messageId: string,
  conversationId: string,
  role: MessageRecord['role'],
  content: string
): MessageRecord => ({
  messageId,
  conversationId,
  role,
  content,
  isStreaming: false,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

export const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
};

type ConversationStateTestProps = Pick<UseConversationStateProps, 'conversationStore' | 'storage'> &
  Partial<Omit<UseConversationStateProps, 'conversationStore' | 'storage'>>;

export const renderUseConversationState = (props: ConversationStateTestProps) => {
  const authDefaults =
    props.isAuthenticated === undefined && props.sessionStatus === undefined
      ? { isAuthenticated: true, sessionStatus: 'authenticated' as const }
      : {};
  const initialProps: UseConversationStateProps = {
    activeConversationKey: ACTIVE_CONVERSATION_KEY,
    ...authDefaults,
    ...props,
  };
  return renderHook((input: UseConversationStateProps) => useConversationState(input), {
    initialProps,
  });
};
