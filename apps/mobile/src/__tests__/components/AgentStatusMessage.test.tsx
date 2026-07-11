import { render } from '@testing-library/react-native';

import { AgentStatusMessage } from '../../components/MessageBubble/AgentStatusMessage';
import type { Message } from '../../types';

jest.mock('../../components/AgentExecutionPanel', () => ({
  AgentExecutionPanel: ({ agentStatuses, elapsedSeconds }: any) => {
    const React = require('react');
    const { Text } = require('react-native');
    return React.createElement(Text, { testID: 'agent-execution' }, 
      `AgentExecutionPanel: ${agentStatuses?.length || 0} statuses, ${elapsedSeconds}s`
    );
  },
}));

jest.mock('../../components/ToolUsageList', () => ({
  ToolUsageList: ({ toolEvents }: any) => {
    const React = require('react');
    const { Text } = require('react-native');
    return React.createElement(Text, { testID: 'tool-usage-list' }, 
      `ToolUsageList: ${toolEvents?.length || 0} events`
    );
  },
}));

jest.mock('../../components/SourcesList', () => ({
  SourcesList: ({ sources }: any) => {
    const React = require('react');
    const { Text } = require('react-native');
    return React.createElement(Text, { testID: 'sources-list' }, 
      `SourcesList: ${sources?.length || 0} sources`
    );
  },
}));

describe('AgentStatusMessage', () => {
  const createMessage = (overrides: Partial<Message> = {}): Message => ({
    id: 'msg-1',
    role: 'assistant',
    content: '',
    createdAt: Date.now(),
    ...overrides,
  });

  it('returns null for null/undefined message', async () => {
    const { toJSON } = await render(<AgentStatusMessage message={null as any} />);
    expect(toJSON()).toBeNull();
  });

  it('renders baseline agent execution without optional lists or errors', async () => {
    const message = createMessage({ elapsedSeconds: undefined });
    const { getByTestId, getByText, queryByTestId, queryByText } = await render(
      <AgentStatusMessage message={message} />
    );
    expect(getByTestId('agent-execution')).toBeTruthy();
    expect(getByText(/AgentExecutionPanel: 0 statuses, 0s/)).toBeTruthy();
    expect(queryByTestId('sources-list')).toBeNull();
    expect(queryByText('Something went wrong')).toBeNull();
  });

  it('routes agent statuses and suppresses fallback tool list', async () => {
    const message = createMessage({
      agentStatuses: [{ status: 'thinking' }],
      elapsedSeconds: 5,
      toolEvents: [{ toolName: 'test', success: true } as any],
    });
    const { getByTestId, getByText, queryByTestId } = await render(
      <AgentStatusMessage message={message} />
    );
    expect(getByTestId('agent-execution')).toBeTruthy();
    expect(getByText(/AgentExecutionPanel: 1 statuses, 5s/)).toBeTruthy();
    expect(queryByTestId('tool-usage-list')).toBeNull();
  });

  it('renders fallback tools, sources, and error when no agent statuses are present', async () => {
    const message = createMessage({
      toolEvents: [{ toolName: 'test', success: true } as any],
      sources: [{ url: 'https://example.com' }],
      error: 'Warning',
    });
    const { getByTestId, getByText } = await render(<AgentStatusMessage message={message} />);
    expect(getByTestId('agent-execution')).toBeTruthy();
    expect(getByTestId('tool-usage-list')).toBeTruthy();
    expect(getByTestId('sources-list')).toBeTruthy();
    expect(getByText('Warning')).toBeTruthy();
  });

  it('handles empty and undefined agent statuses', async () => {
    const message = createMessage({ agentStatuses: [] });
    const { getByTestId, queryByTestId, rerender } = await render(
      <AgentStatusMessage message={message} />
    );
    expect(getByTestId('agent-execution')).toBeTruthy();
    expect(queryByTestId('tool-usage-list')).toBeNull();

    await rerender(<AgentStatusMessage message={createMessage({ agentStatuses: undefined })} />);
    expect(getByTestId('agent-execution')).toBeTruthy();
  });
});
