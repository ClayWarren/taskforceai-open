import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { AgentExecutionPanel } from '../../components/AgentExecutionPanel';

jest.mock('@taskforceai/design-tokens', () => ({
  colorTokens: {
    dark: {
      primary: '#60a5fa',
      success: '#22c55e',
      error: '#f87171',
    },
  },
}));

jest.mock('../../components/AgentCard', () => ({
  AgentCard: ({ agent, onExpand }: any) => {
    const react = require('react');
    const { Text, TouchableOpacity } = require('react-native');
    return react.createElement(
      TouchableOpacity,
      { onPress: onExpand, accessibilityLabel: `expand-agent-${agent.id}` },
      react.createElement(Text, null, agent.label),
      react.createElement(Text, null, agent.displayStatus)
    );
  },
}));

jest.mock('../../components/ToolUsageList', () => ({
  ToolUsageList: ({ toolEvents }: { toolEvents: unknown[] }) => {
    const react = require('react');
    const { Text } = require('react-native');
    return react.createElement(Text, { testID: 'tool-usage-list' }, `tool-events:${toolEvents.length}`);
  },
}));

jest.mock('../../components/ComputerTheater', () => ({
  ComputerTheater: ({ toolEvents, agentLabel }: { toolEvents: unknown[]; agentLabel?: string }) => {
    const react = require('react');
    const { Text, View } = require('react-native');
    return react.createElement(
      View,
      null,
      react.createElement(Text, { testID: 'computer-theater' }, `computer-events:${toolEvents.length}`),
      react.createElement(Text, { testID: 'computer-theater-agent' }, `agent:${agentLabel ?? 'none'}`)
    );
  },
}));

describe('AgentExecutionPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders compact summary and toggles expanded/collapsed states', () => {
    const { getByText, queryByText } = render(
      <AgentExecutionPanel
        agentStatuses={[
          { agent_id: 0, status: 'RUNNING', progress: 0.4 },
          { agent_id: 1, status: 'QUEUED', progress: 0 },
        ] as any}
        elapsedSeconds={9}
        modelLabel="heavy-plus"
        isStreaming={false}
      />
    );

    expect(getByText('Completed')).toBeTruthy();
    expect(getByText('HEAVY-PLUS')).toBeTruthy();
    expect(getByText('9s')).toBeTruthy();

    fireEvent.press(getByText('EXPAND'));

    expect(getByText('1 agent running')).toBeTruthy();
    expect(getByText('COLLAPSE')).toBeTruthy();

    fireEvent.press(getByText('COLLAPSE'));

    expect(queryByText('1 agent running')).toBeNull();
    expect(getByText('EXPAND')).toBeTruthy();
  });

  it('renders selected agent detail with log lines and reasoning', () => {
    const { getByLabelText, getByText, queryByText } = render(
      <AgentExecutionPanel
        agentStatuses={[
          {
            agent_id: 0,
            status: 'RUNNING',
            progress: 0.65,
            result: 'Line one\n\nLine two',
            reasoning: 'Evaluating alternatives',
          },
        ] as any}
        elapsedSeconds={4}
      />
    );

    fireEvent.press(getByText('EXPAND'));
    fireEvent.press(getByLabelText('expand-agent-0'));

    expect(getByText('AGENT 1')).toBeTruthy();
    expect(getByText('Line one')).toBeTruthy();
    expect(getByText('Line two')).toBeTruthy();
    expect(getByText('Evaluating alternatives')).toBeTruthy();

    fireEvent.press(getByText('Back to agents'));

    expect(queryByText('AGENT 1')).toBeNull();
    expect(getByText('Agent 1')).toBeTruthy();
  });

  it('renders empty-state variants from indicator state', () => {
    const runningEmpty = render(
      <AgentExecutionPanel agentStatuses={[]} elapsedSeconds={0} isStreaming={true} />
    );

    fireEvent.press(runningEmpty.getByText('EXPAND'));
    expect(runningEmpty.getByText('Agents are spinning up...')).toBeTruthy();
    const completedEmpty = render(
      <AgentExecutionPanel agentStatuses={[]} elapsedSeconds={0} isStreaming={false} />
    );

    fireEvent.press(completedEmpty.getByText('EXPAND'));
    expect(completedEmpty.getByText('Agent progress data was not saved')).toBeTruthy();
  });

  it('renders tool usage and computer theater when tool events are present', () => {
    const { getByTestId, getByText } = render(
      <AgentExecutionPanel
        agentStatuses={[
          { agent_id: 0, status: 'RUNNING', progress: 0.3 },
          { agent_id: 1, status: 'QUEUED', progress: 0 },
        ] as any}
        elapsedSeconds={12}
        toolEvents={[
          { toolName: 'computer_use', status: 'running' },
          { toolName: 'search', status: 'completed' },
        ] as any}
        isStreaming={true}
      />
    );

    fireEvent.press(getByText('EXPAND'));

    expect(getByTestId('tool-usage-list')).toBeTruthy();
    expect(getByTestId('computer-theater')).toBeTruthy();
    expect(getByTestId('computer-theater-agent').props.children).toBe('agent:Agent 1');

    const withoutComputerUse = render(
      <AgentExecutionPanel
        agentStatuses={[{ agent_id: 0, status: 'RUNNING', progress: 0.2 }] as any}
        elapsedSeconds={3}
        toolEvents={[{ toolName: 'search', status: 'completed' }] as any}
      />
    );

    fireEvent.press(withoutComputerUse.getByText('EXPAND'));

    expect(withoutComputerUse.getByTestId('tool-usage-list')).toBeTruthy();
    expect(withoutComputerUse.queryByTestId('computer-theater')).toBeNull();
  });

  it('resets selected agent detail if that agent disappears on rerender', () => {
    const { getByLabelText, getByText, queryByText, rerender } = render(
      <AgentExecutionPanel
        agentStatuses={[
          { agent_id: 0, status: 'RUNNING', progress: 0.3 },
          { agent_id: 1, status: 'RUNNING', progress: 0.7 },
        ] as any}
        elapsedSeconds={6}
      />
    );

    fireEvent.press(getByText('EXPAND'));
    fireEvent.press(getByLabelText('expand-agent-1'));

    expect(getByText('AGENT 2')).toBeTruthy();

    rerender(
      <AgentExecutionPanel
        agentStatuses={[{ agent_id: 0, status: 'RUNNING', progress: 0.6 }] as any}
        elapsedSeconds={8}
      />
    );

    expect(queryByText('AGENT 2')).toBeNull();
    expect(getByText('Agent 1')).toBeTruthy();
  });
});
