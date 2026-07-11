import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { createMockMessage } from '#tests/fixtures/client-messages';

import { MessageBubble, areMessageBubblePropsEqual } from '../components/MessageBubble';
import { ThemeProvider } from '../contexts/ThemeContext';

const THEME_KEY = '@taskforceai:theme_mode';
const mockAsyncState: Record<string, string | null> = {
  [THEME_KEY]: null,
};

jest.mock('../components/MessageBubble/AgentStatusMessage', () => ({
  AgentStatusMessage: ({ message }: any) => {
    const ReactMod = require('react');
    const { Text: TextComp } = require('react-native');
    return ReactMod.createElement(TextComp, { testID: 'agent-status-message' }, `Agent: ${message.id}`);
  },
}));

jest.mock('../components/MessageBubble/StandardMessage', () => ({
  StandardMessage: ({ message }: any) => {
    const ReactMod = require('react');
    const { Text: TextComp } = require('react-native');
    return ReactMod.createElement(TextComp, { testID: 'standard-message' }, `Standard: ${message.content}`);
  },
}));

globalThis.registerTestMock('expo-glass-effect', () => {
  const ReactMod = require('react');
  return {
    GlassView: ({ children, className, style }: any) =>
      ReactMod.createElement('View', { className, style, testID: 'glass-view' }, children),
  };
});

globalThis.registerTestMock('@/utils/theme-storage', () => ({
  loadThemeMode: async () => mockAsyncState[THEME_KEY] ?? null,
  storeThemeMode: async (mode: string) => {
    mockAsyncState[THEME_KEY] = mode;
  },
  clearThemeMode: async () => {
    mockAsyncState[THEME_KEY] = null;
  },
}));

describe('MessageBubble', () => {
  const renderWithProviders = async (ui: React.ReactElement) => {
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <ThemeProvider>
          {ui}
        </ThemeProvider>
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    return renderer!;
  };

  const mockUserMessage = createMockMessage({
    id: '1',
    role: 'user',
    content: 'Hello AI',
  });

  const mockAssistantMessage = createMockMessage({
    id: '2',
    role: 'assistant',
    content: 'Hello Human',
  });

  const mockAgentStatusMessage = createMockMessage({
    id: '3',
    role: 'assistant',
    content: '',
    isAgentStatus: true,
  });

  it('renders user message correctly', async () => {
    const renderer = await renderWithProviders(
      <MessageBubble message={mockUserMessage} />
    );
    const root = renderer.root;
    const texts = root.findAllByType(Text);
    const contentText = texts.find(t => t.props.children?.toString().includes('Hello AI'));
    expect(contentText).toBeDefined();
  });

  it('renders assistant message correctly', async () => {
    const renderer = await renderWithProviders(
      <MessageBubble message={mockAssistantMessage} />
    );
    const root = renderer.root;
    const texts = root.findAllByType(Text);
    const contentText = texts.find(t => t.props.children?.toString().includes('Hello Human'));
    expect(contentText).toBeDefined();
  });

  it('renders agent status message with AgentStatusMessage component', async () => {
    const renderer = await renderWithProviders(
      <MessageBubble message={mockAgentStatusMessage} />
    );
    const root = renderer.root;
    expect(root.findByProps({ testID: 'agent-status-message' })).toBeDefined();
  });

  it('renders standard message with StandardMessage component', async () => {
    const renderer = await renderWithProviders(
      <MessageBubble message={mockAssistantMessage} />
    );
    const root = renderer.root;
    expect(root.findByProps({ testID: 'standard-message' })).toBeDefined();
  });

  it('memoizes correctly when message props are equal', async () => {
    const common = {
      id: '1',
      role: 'assistant' as const,
      content: 'Test',
      isStreaming: false,
      updatedAt: 1000,
      createdAt: 1000,
    };

    const message1 = createMockMessage(common);
    const message2 = createMockMessage(common);

    const renderer1 = await renderWithProviders(<MessageBubble message={message1} />);
    const renderer2 = await renderWithProviders(<MessageBubble message={message2} />);

    expect(renderer1.toJSON()).toEqual(renderer2.toJSON());
  });

  it('treats unchanged nested message arrays as equal without stringifying them', () => {
    const args = { query: 'mobile performance' };
    const message = createMockMessage({
      id: 'nested-equal',
      role: 'assistant',
      content: 'Result',
      sources: [{ url: 'https://example.com', title: 'Example', snippet: 'Snippet' }],
      toolEvents: [
        {
          invocationId: 'tool-1',
          agentLabel: 'Researcher',
          toolName: 'web_search',
          arguments: args,
          status: 'completed',
          success: true,
          durationMs: 12,
          resultPreview: 'Found result',
          sources: [{ url: 'https://tool.example', title: 'Tool' }],
        },
      ],
      agentStatuses: [
        {
          agent_id: 1,
          status: 'completed',
          progress: 100,
          result: 'Done',
          model: 'gpt',
        },
      ],
    });
    const nextMessage = {
      ...message,
      sources: message.sources?.map((source) => ({ ...source })),
      toolEvents: message.toolEvents?.map((event) => ({
        ...event,
        sources: event.sources?.map((source) => ({ ...source })),
      })),
      agentStatuses: message.agentStatuses?.map((status) => ({ ...status })),
    };

    expect(areMessageBubblePropsEqual({ message }, { message: nextMessage })).toBe(true);
  });

  it('re-renders when private chat state changes', () => {
    expect(
      areMessageBubblePropsEqual(
        { message: mockAssistantMessage, privateChat: false },
        { message: mockAssistantMessage, privateChat: true }
      )
    ).toBe(false);
  });

  it('detects same-length nested message array changes', () => {
    const message = createMockMessage({
      id: 'nested-different',
      role: 'assistant',
      content: 'Result',
      sources: [{ url: 'https://example.com/a', title: 'A' }],
      toolEvents: [
        {
          invocationId: 'tool-1',
          agentLabel: 'Researcher',
          toolName: 'web_search',
          arguments: 'query',
          status: 'completed',
          success: true,
          durationMs: 12,
          resultPreview: 'Found result',
        },
      ],
      agentStatuses: [{ agent_id: 1, status: 'running', progress: 50 }],
    });

    expect(
      areMessageBubblePropsEqual(
        { message },
        {
          message: {
            ...message,
            sources: [{ url: 'https://example.com/b', title: 'B' }],
          },
        }
      )
    ).toBe(false);
    expect(
      areMessageBubblePropsEqual(
        { message },
        {
          message: {
            ...message,
            toolEvents: message.toolEvents?.map((event) => ({
              ...event,
              resultPreview: 'Different result',
            })),
          },
        }
      )
    ).toBe(false);
    expect(
      areMessageBubblePropsEqual(
        { message },
        {
          message: {
            ...message,
            agentStatuses: [{ agent_id: 1, status: 'completed', progress: 100 }],
          },
        }
      )
    ).toBe(false);
  });
});
