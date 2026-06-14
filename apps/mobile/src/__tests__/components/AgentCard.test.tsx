import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

import { AgentCard, AgentCardData } from '../../components/AgentCard';

jest.mock('@taskforceai/design-tokens', () => ({
  colorTokens: {
    dark: {
      primary: '#60a5fa',
      success: '#34d399',
      error: '#f87171',
    },
  },
}));

describe('AgentCard', () => {
  const createAgent = (overrides: Partial<AgentCardData> = {}): AgentCardData => ({
    id: 1,
    label: 'Test Agent',
    status: 'thinking',
    displayStatus: 'Processing request',
    progressValue: 0,
    state: 'queued',
    ...overrides,
  });

  it('renders agent label', () => {
    const agent = createAgent({ label: 'Researcher' });
    const { getByText } = render(<AgentCard agent={agent} />);
    expect(getByText('RESEARCHER')).toBeTruthy();
  });

  it('renders display status', () => {
    const agent = createAgent({ displayStatus: 'Working on task' });
    const { getByText } = render(<AgentCard agent={agent} />);
    expect(getByText('Working on task')).toBeTruthy();
  });

  it('renders with queued state', () => {
    const agent = createAgent({ state: 'queued' });
    const { getByText } = render(<AgentCard agent={agent} />);
    expect(getByText('TEST AGENT')).toBeTruthy();
  });

  it('renders with running state and shows ActivityIndicator', () => {
    const agent = createAgent({ state: 'running' });
    const { UNSAFE_queryByType } = render(<AgentCard agent={agent} />);
    const indicator = UNSAFE_queryByType('ActivityIndicator');
    expect(indicator).toBeTruthy();
  });

  it('does not show ActivityIndicator for completed state', () => {
    const agent = createAgent({ state: 'completed' });
    const { UNSAFE_queryByType } = render(<AgentCard agent={agent} />);
    const indicator = UNSAFE_queryByType('ActivityIndicator');
    expect(indicator).toBeNull();
  });

  it('does not show ActivityIndicator for failed state', () => {
    const agent = createAgent({ state: 'failed' });
    const { UNSAFE_queryByType } = render(<AgentCard agent={agent} />);
    const indicator = UNSAFE_queryByType('ActivityIndicator');
    expect(indicator).toBeNull();
  });

  it('shows progress bar when progressValue > 0', () => {
    const agent = createAgent({ progressValue: 0.5, state: 'running' });
    const { getByText } = render(<AgentCard agent={agent} />);
    expect(getByText('50%')).toBeTruthy();
  });

  it('hides progress bar when progressValue is 0', () => {
    const agent = createAgent({ progressValue: 0, state: 'running' });
    const { queryByText } = render(<AgentCard agent={agent} />);
    expect(queryByText('0%')).toBeNull();
  });

  it('rounds progress percent correctly', () => {
    const agent = createAgent({ progressValue: 0.756, state: 'running' });
    const { getByText } = render(<AgentCard agent={agent} />);
    expect(getByText('76%')).toBeTruthy();
  });

  it('shows result when present', () => {
    const agent = createAgent({ result: 'Task completed successfully' });
    const { getByText } = render(<AgentCard agent={agent} />);
    expect(getByText('Task completed successfully')).toBeTruthy();
  });

  it('hides result when not present', () => {
    const agent = createAgent({ result: undefined });
    const { queryByText } = render(<AgentCard agent={agent} />);
    expect(queryByText('Task completed successfully')).toBeNull();
  });

  it('hides result when empty string', () => {
    const agent = createAgent({ result: '' });
    const { queryByText } = render(<AgentCard agent={agent} />);
    expect(queryByText('Task')).toBeNull();
  });

  it('hides result when whitespace-only string', () => {
    const agent = createAgent({ result: '   ' });
    const { queryByText } = render(<AgentCard agent={agent} />);
    expect(queryByText('Task')).toBeNull();
  });

  it('trims result text', () => {
    const agent = createAgent({ result: '  trimmed result  ' });
    const { getByText } = render(<AgentCard agent={agent} />);
    expect(getByText('trimmed result')).toBeTruthy();
  });

  it('calls onExpand when pressed', () => {
    const onExpand = jest.fn();
    const agent = createAgent();
    const { getByText } = render(<AgentCard agent={agent} onExpand={onExpand} />);
    
    fireEvent.press(getByText('TEST AGENT'));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it('handles undefined onExpand', () => {
    const agent = createAgent();
    const { getByText } = render(<AgentCard agent={agent} />);
    
    expect(() => {
      fireEvent.press(getByText('TEST AGENT'));
    }).not.toThrow();
  });

  it('has correct accessibility hint', () => {
    const agent = createAgent();
    const { getByA11yHint } = render(<AgentCard agent={agent} />);
    
    expect(getByA11yHint('Double tap to view agent details')).toBeTruthy();
  });
});
