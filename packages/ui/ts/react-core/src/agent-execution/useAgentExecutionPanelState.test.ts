import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';
import '../../../../../../tests/setup/dom';

import { useAgentExecutionPanelState } from './useAgentExecutionPanelState';

type TestAgent = {
  id: number;
  label: string;
  status: string;
  state: 'queued' | 'running' | 'completed' | 'failed';
  progressValue: number;
  displayStatus: string;
};

type TestTool = {
  toolName: string;
  status?: string;
};

const agent = (id: number): TestAgent => ({
  id,
  label: `Agent ${id + 1}`,
  status: 'RUNNING',
  state: 'running',
  progressValue: 0.5,
  displayStatus: 'Running',
});

describe('useAgentExecutionPanelState', () => {
  it('auto-expands once for each streaming session', () => {
    const { result, rerender } = renderHook(
      (props: { isStreaming: boolean }) =>
        useAgentExecutionPanelState<TestAgent, TestTool>({
          agents: [agent(0)],
          elapsedSeconds: 3,
          defaultModelLabel: 'HEAVY',
          autoExpandWhenStreaming: true,
          isStreaming: props.isStreaming,
        }),
      { initialProps: { isStreaming: false } }
    );

    expect(result.current.isExpanded).toBe(false);

    rerender({ isStreaming: true });
    expect(result.current.isExpanded).toBe(true);

    act(() => {
      result.current.collapse();
    });
    expect(result.current.isExpanded).toBe(false);

    rerender({ isStreaming: true });
    expect(result.current.isExpanded).toBe(false);

    rerender({ isStreaming: false });
    rerender({ isStreaming: true });
    expect(result.current.isExpanded).toBe(true);
  });

  it('clears the selected agent on collapse and when the agent disappears', () => {
    const { result, rerender } = renderHook(
      (agents: TestAgent[]) =>
        useAgentExecutionPanelState<TestAgent, TestTool>({
          agents,
          elapsedSeconds: 0,
          defaultModelLabel: 'HEAVY',
        }),
      { initialProps: [agent(0), agent(1)] }
    );

    act(() => {
      result.current.expand();
      result.current.selectAgent(1);
    });

    expect(result.current.selectedAgent?.id).toBe(1);

    act(() => {
      result.current.collapse();
    });

    expect(result.current.selectedAgent).toBeNull();
    expect(result.current.isExpanded).toBe(false);

    act(() => {
      result.current.selectAgent(1);
    });
    expect(result.current.selectedAgent?.id).toBe(1);

    rerender([agent(0)]);
    expect(result.current.selectedAgent).toBeNull();
  });
});
