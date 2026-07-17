import { renderHook } from '@testing-library/react';
import React from 'react';
import { vi } from 'bun:test';

import {
  useManagedStreamingMessages,
  type ManagedStreamingPersistence,
} from './useManagedStreamingMessages';

export type TestMessage = {
  id: string;
  role: 'assistant';
  content: string;
  isStreaming: boolean;
  isAgentStatus?: boolean;
  sources?: string[];
  toolEvents?: string[];
  agentStatuses?: string[];
  elapsedSeconds?: number;
  pendingApproval?: string;
  error?: string | null;
  trace_id?: string;
};

export type TestPersistence = ManagedStreamingPersistence<string, string, string, string>;

let idCounter = 0;

export const resetManagedStreamingTestIds = (): void => {
  idCounter = 0;
};

void vi.mock('@taskforceai/client-runtime/id', () => ({
  createId: (prefix: string) => {
    idCounter += 1;
    return `${prefix}-${idCounter}`;
  },
}));

export const createPlaceholders = ({
  statusMessageId,
  contentMessageId,
}: {
  statusMessageId: string;
  contentMessageId: string;
}) => ({
  statusPlaceholder: {
    id: statusMessageId,
    role: 'assistant' as const,
    content: '',
    isStreaming: true,
    isAgentStatus: true,
    sources: [],
    toolEvents: [],
    agentStatuses: [],
  },
  contentPlaceholder: {
    id: contentMessageId,
    role: 'assistant' as const,
    content: '',
    isStreaming: true,
    isAgentStatus: false,
    sources: [],
    toolEvents: [],
    agentStatuses: [],
  },
});

export const createPersistence = (overrides: Partial<TestPersistence> = {}): TestPersistence => ({
  persistPlaceholderPair: vi.fn().mockResolvedValue(undefined),
  rollbackPlaceholderPair: vi.fn().mockResolvedValue(undefined),
  persistLiveContent: vi.fn().mockResolvedValue(undefined),
  persistLiveStatus: vi.fn().mockResolvedValue(undefined),
  persistToolEvents: vi.fn().mockResolvedValue(undefined),
  persistAgentStatuses: vi.fn().mockResolvedValue(undefined),
  flushBeforeFinalState: vi.fn().mockResolvedValue(undefined),
  flushBeforeErrorState: vi.fn().mockResolvedValue(undefined),
  persistFinalState: vi.fn().mockResolvedValue(undefined),
  persistErrorState: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

export type HookOptions = Parameters<
  typeof useManagedStreamingMessages<TestMessage, string, string, string, string>
>[0];

export const createOptions = (overrides: Partial<HookOptions> = {}): HookOptions => ({
  isStreaming: true,
  streamContent: '',
  finalResponse: null,
  errorMessage: null,
  conversationId: 'conversation-1',
  ensureActiveConversation: vi.fn().mockResolvedValue('conversation-1'),
  setMessages: vi.fn(),
  sources: [],
  finalSources: [],
  toolEvents: [],
  finalToolEvents: [],
  elapsedSeconds: 0,
  agentStatuses: [],
  pendingApproval: null,
  traceId: null,
  finalizeFrom: 'prop',
  createPlaceholders,
  persistence: createPersistence(),
  logger: { debug: vi.fn(), error: vi.fn() },
  ...overrides,
});

export const renderManagedStreamingHook = (initialOptions: HookOptions) =>
  renderHook(
    (options: HookOptions) => {
      const [messages, setMessages] = React.useState<TestMessage[]>([]);
      const streamingState = useManagedStreamingMessages<
        TestMessage,
        string,
        string,
        string,
        string
      >({
        ...options,
        setMessages,
      });
      return { messages, streamingState };
    },
    { initialProps: initialOptions }
  );
