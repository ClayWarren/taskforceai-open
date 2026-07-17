import { describe, expect, it } from 'bun:test';

import {
  createExecutionDisplayViewModel,
  estimateStreamingProgress,
  resolveExecutionAgentVisualizations,
  resolveExecutionReasoning,
  resolveExecutionToolEvents,
} from './agent-progress';

describe('execution display helpers', () => {
  it('prefers replay statuses before stored or streaming statuses', () => {
    const agents = resolveExecutionAgentVisualizations({
      isStreaming: true,
      streamingStatuses: [{ agent_id: 0, status: 'RUNNING' }],
      storedStatuses: [{ agent_id: 1, status: 'COMPLETED' }],
      replayStatuses: [{ agent_id: 2, status: 'FAILED' }],
      uppercaseLabel: true,
    });

    expect(agents).toHaveLength(1);
    expect(agents[0]?.id).toBe(2);
    expect(agents[0]?.label).toBe('AGENT 3');
    expect(agents[0]?.state).toBe('failed');
  });

  it('uses stored statuses when a completed message has persisted progress', () => {
    const agents = resolveExecutionAgentVisualizations({
      isStreaming: false,
      streamingStatuses: [{ agent_id: 0, status: 'RUNNING' }],
      storedStatuses: [{ agent_id: 1, status: 'COMPLETED' }],
    });

    expect(agents.map((agent) => agent.id)).toEqual([1]);
    expect(agents[0]?.state).toBe('completed');
  });

  it('resolves tool events from replay, streaming, stored, then final sources', () => {
    expect(
      resolveExecutionToolEvents({
        isStreaming: false,
        replayEvents: [{ toolName: 'replay' }],
        storedEvents: [{ toolName: 'stored' }],
      })
    ).toEqual([{ toolName: 'replay' }]);

    expect(
      resolveExecutionToolEvents({
        isStreaming: true,
        streamingEvents: [{ toolName: 'streaming' }],
        storedEvents: [{ toolName: 'stored' }],
      })
    ).toEqual([{ toolName: 'streaming' }]);

    expect(
      resolveExecutionToolEvents({
        isStreaming: false,
        storedEvents: [{ toolName: 'stored' }],
        finalEvents: [{ toolName: 'final' }],
      })
    ).toEqual([{ toolName: 'stored' }]);

    expect(
      resolveExecutionToolEvents({
        isStreaming: false,
        storedEvents: [],
        finalEvents: [{ toolName: 'final' }],
      })
    ).toEqual([{ toolName: 'final' }]);
  });

  it('resolves reasoning from the active execution source', () => {
    expect(
      resolveExecutionReasoning({
        isStreaming: true,
        streamingReasoning: 'streaming',
        storedReasoning: 'stored',
      })
    ).toBe('streaming');

    expect(
      resolveExecutionReasoning({
        isStreaming: false,
        storedReasoning: '',
        finalReasoning: 'final',
      })
    ).toBe('final');

    expect(
      resolveExecutionReasoning({
        isStreaming: false,
        replayReasoning: 'replay',
        storedReasoning: 'stored',
      })
    ).toBe('replay');
  });

  it('builds shared execution display state', () => {
    const viewModel = createExecutionDisplayViewModel({
      agents: [
        {
          id: 0,
          label: 'Agent 1',
          status: 'RUNNING',
          displayStatus: 'Running',
          progressValue: 0.5,
          state: 'running',
        },
      ],
      elapsedSeconds: 65,
      modelLabel: 'heavy',
      isStreaming: true,
      toolEvents: [{ toolName: 'computer_use' }],
    });

    expect(viewModel.headerText).toBe('Agents Working');
    expect(viewModel.resolvedModelLabel).toBe('HEAVY');
    expect(viewModel.elapsedLabel).toBe('1m 05s');
    expect(viewModel.progressWidth).toBe('50.0%');
    expect(viewModel.runningCount).toBe(1);
    expect(viewModel.runningAgentLabel).toBe('Agent 1');
    expect(viewModel.shouldShowComputerTheater).toBe(true);
  });

  it('labels completed agents as synthesis while the final answer is still streaming', () => {
    const viewModel = createExecutionDisplayViewModel({
      agents: [
        {
          id: 0,
          label: 'Agent 1',
          status: 'COMPLETED',
          displayStatus: 'Completed',
          progressValue: 1,
          state: 'completed',
        },
        {
          id: 1,
          label: 'Agent 2',
          status: 'COMPLETED',
          displayStatus: 'Completed',
          progressValue: 1,
          state: 'completed',
        },
      ],
      elapsedSeconds: 182,
      isStreaming: true,
    });

    expect(viewModel.headerText).toBe('Synthesizing Answer');
    expect(viewModel.indicatorState).toBe('running');
  });

  it('uses agent snapshot models for completed execution labels', () => {
    const viewModel = createExecutionDisplayViewModel({
      agents: [
        {
          id: 0,
          label: 'Agent 1',
          status: 'COMPLETED',
          displayStatus: 'Completed',
          progressValue: 1,
          state: 'completed',
          model: 'xai/grok-4.5',
        },
        {
          id: 1,
          label: 'Agent 2',
          status: 'COMPLETED',
          displayStatus: 'Completed',
          progressValue: 1,
          state: 'completed',
          model: 'openai/gpt-5.6-sol',
        },
      ],
      elapsedSeconds: 61,
      modelLabel: 'default-selected-model',
      isCompletedSnapshot: true,
    });

    expect(viewModel.resolvedModelLabel).toBe('GROK 4.5 + GPT 5.6 SOL');
  });

  it('continues easing sparse running progress without claiming completion', () => {
    const early = estimateStreamingProgress(0.64, 15, 'running');
    const later = estimateStreamingProgress(0.64, 55, 'running');

    expect(later).toBeGreaterThan(early);
    expect(later).toBeGreaterThan(0.8);
    expect(later).toBeLessThan(0.95);
  });
});
