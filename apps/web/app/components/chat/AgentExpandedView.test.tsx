import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import '../../../../../tests/setup/dom';

const toolUsageListSpy = vi.fn();

vi.mock('./ToolUsageList', () => ({
  default: (props: any) => {
    toolUsageListSpy(props);
    return <div data-testid="tool-usage-list">{props.events.length}</div>;
  },
}));

import AgentExpandedView, { type AgentVisualization } from './AgentExpandedView';

const createEvent = (overrides: Partial<Record<string, unknown>> = {}) => ({
  timestamp: '2026-02-10T10:00:00.000Z',
  agentLabel: 'Planner',
  toolName: 'search',
  arguments: {},
  success: true,
  durationMs: 120,
  ...overrides,
});

const createAgent = (overrides: Partial<AgentVisualization> = {}): AgentVisualization => ({
  id: 1,
  label: 'Planner',
  status: 'PROCESSING...',
  displayStatus: 'Processing',
  progressValue: 0.6,
  state: 'running',
  ...overrides,
});

const clickAgentRow = (label: string) => {
  const row = screen.getByText(label).closest('button');
  if (!row) {
    throw new Error(`Missing agent row for label: ${label}`);
  }
  fireEvent.click(row);
};

describe('AgentExpandedView', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders empty-state placeholder for active and completed flows', () => {
    const onCollapse = vi.fn();
    const { rerender } = render(
      <AgentExpandedView
        agents={[]}
        elapsedSeconds={4}
        modelLabel="HEAVY"
        indicatorState="running"
        toolEvents={[]}
        onCollapse={onCollapse}
      />
    );

    expect(screen.getByText('Agents Working')).toBeDefined();
    expect(screen.getByText('Agents are spinning up...')).toBeDefined();

    rerender(
      <AgentExpandedView
        agents={[]}
        elapsedSeconds={4}
        modelLabel="HEAVY"
        indicatorState="completed"
        toolEvents={[]}
        onCollapse={onCollapse}
      />
    );

    expect(
      screen.getByText('This conversation completed but agent progress data was not saved')
    ).toBeDefined();
  });

  it('renders agent list summary and handles collapse', () => {
    const onCollapse = vi.fn();
    render(
      <AgentExpandedView
        agents={[
          createAgent({ id: 1, label: 'Planner', state: 'running', progressValue: 0.7 }),
          createAgent({ id: 2, label: 'Researcher', state: 'queued', progressValue: 0.05 }),
        ]}
        elapsedSeconds={68}
        modelLabel="HEAVY"
        indicatorState="running"
        toolEvents={[]}
        onCollapse={onCollapse}
      />
    );

    expect(screen.getByText('1 agent running')).toBeDefined();
    expect(screen.getByText('Planner')).toBeDefined();
    expect(screen.getByText('Researcher')).toBeDefined();
    expect(screen.getByText('1m 08s')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }));
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it('describes queued and completed agent summaries without idle copy', () => {
    const { rerender } = render(
      <AgentExpandedView
        agents={[
          createAgent({ id: 0, label: 'AGENT 1', state: 'queued', progressValue: 0.05 }),
          createAgent({ id: 1, label: 'AGENT 2', state: 'queued', progressValue: 0.05 }),
        ]}
        elapsedSeconds={2}
        modelLabel="HEAVY"
        indicatorState="queued"
        toolEvents={[]}
        onCollapse={vi.fn()}
      />
    );

    expect(screen.getByText('2 agents queued')).toBeDefined();
    expect(screen.queryByText('All agents idle')).toBeNull();

    rerender(
      <AgentExpandedView
        agents={[
          createAgent({
            id: 0,
            label: 'AGENT 1',
            state: 'completed',
            progressValue: 1,
            displayStatus: 'Completed',
          }),
          createAgent({
            id: 1,
            label: 'AGENT 2',
            state: 'completed',
            progressValue: 1,
            displayStatus: 'Completed',
          }),
        ]}
        elapsedSeconds={42}
        modelLabel="HEAVY"
        indicatorState="completed"
        toolEvents={[]}
        onCollapse={vi.fn()}
      />
    );

    expect(screen.getByText('2 agents completed')).toBeDefined();
    expect(screen.queryByText('All agents idle')).toBeNull();
  });

  it('labels all-completed active runs as final answer synthesis', () => {
    render(
      <AgentExpandedView
        agents={[
          createAgent({
            id: 0,
            label: 'AGENT 1',
            state: 'completed',
            progressValue: 1,
            displayStatus: 'Completed',
          }),
          createAgent({
            id: 1,
            label: 'AGENT 2',
            state: 'completed',
            progressValue: 1,
            displayStatus: 'Completed',
          }),
        ]}
        elapsedSeconds={95}
        headerText="Synthesizing Answer"
        modelLabel="HEAVY"
        indicatorState="running"
        toolEvents={[]}
        onCollapse={vi.fn()}
      />
    );

    expect(screen.getByText('Synthesizing Answer')).toBeDefined();
    expect(screen.getByText('Synthesizing final answer')).toBeDefined();
    expect(screen.queryByText('2 agents queued')).toBeNull();
  });

  it('renders failed and model-labelled agents with plural active summary', () => {
    render(
      <AgentExpandedView
        agents={[
          createAgent({ id: 3, label: 'Alpha', state: 'running', model: 'openai/gpt-5.5' }),
          createAgent({
            id: 4,
            label: 'Beta',
            state: 'running',
            model: 'anthropic/claude-fable-5',
          }),
          createAgent({
            id: 5,
            label: 'Failure Agent',
            state: 'failed',
            displayStatus: 'Failed',
            progressValue: 0.9,
          }),
        ]}
        elapsedSeconds={0}
        modelLabel="HEAVY"
        indicatorState="failed"
        toolEvents={[]}
        onCollapse={vi.fn()}
      />
    );

    expect(screen.getByText('Agent run failed')).toBeDefined();
    expect(screen.getByText('GPT 5.5')).toBeDefined();
    expect(screen.getByText('Claude Fable 5')).toBeDefined();
    expect(screen.getAllByText('Failed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Searching, reading, and comparing evidence...')).toHaveLength(2);
    expect(screen.getByText('No live activity recorded')).toBeDefined();

    clickAgentRow('GPT 5.5');
    expect(screen.getByLabelText('GPT 5.5 detail')).toBeDefined();
    expect(screen.getByRole('progressbar', { name: 'GPT 5.5 progress' })).toBeDefined();
    expect(screen.getByText('Alpha')).toBeDefined();
  });

  it('shows live agent result previews while tools have not appeared yet', () => {
    render(
      <AgentExpandedView
        agents={[
          createAgent({
            id: 0,
            label: 'AGENT 1',
            state: 'running',
            result: 'Searching current AI news...\nSecond line',
          }),
        ]}
        elapsedSeconds={18}
        modelLabel="HEAVY"
        indicatorState="running"
        toolEvents={[]}
        onCollapse={vi.fn()}
      />
    );

    expect(screen.getByText('Second line')).toBeDefined();
    expect(screen.queryByText('Searching current AI news...')).toBeNull();
    expect(screen.queryByText('Searching, reading, and comparing evidence...')).toBeNull();
  });

  it('shows the freshest live agent line before concrete tool events arrive', () => {
    render(
      <AgentExpandedView
        agents={[
          createAgent({
            id: 0,
            label: 'AGENT 1',
            state: 'running',
            reasoning: 'Planning searches',
            result: 'Searching current AI news...\nComparing OpenAI and Anthropic updates',
          }),
        ]}
        elapsedSeconds={18}
        modelLabel="HEAVY"
        indicatorState="running"
        toolEvents={[]}
        onCollapse={vi.fn()}
      />
    );

    expect(screen.getByText('Comparing OpenAI and Anthropic updates')).toBeDefined();
    expect(screen.queryByText('Searching current AI news...')).toBeNull();
    expect(screen.queryByText('Searching, reading, and comparing evidence...')).toBeNull();
  });

  it('opens detail view, renders reasoning, and returns to list', () => {
    render(
      <AgentExpandedView
        agents={[
          createAgent({
            id: 1,
            label: 'Planner',
            state: 'completed',
            displayStatus: 'Completed',
            progressValue: 1,
            result: 'Line one\nLine two',
          }),
        ]}
        elapsedSeconds={10}
        modelLabel="HEAVY"
        indicatorState="completed"
        toolEvents={[createEvent()]}
        reasoning="Thinking trace"
        searchInteractive={true}
        onShowSources={vi.fn()}
        onCollapse={vi.fn()}
      />
    );

    clickAgentRow('Planner');

    expect(screen.getByLabelText('Planner detail')).toBeDefined();
    const progress = screen.getByRole('progressbar', { name: 'Planner progress' });
    const describedBy = progress.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    if (!describedBy) {
      throw new Error('Expected progress bar aria-describedby id');
    }
    expect(document.getElementById(describedBy)?.textContent).toBe('Completed');
    expect(screen.getByText('Line one')).toBeDefined();
    expect(screen.getByText('Line two')).toBeDefined();
    expect(screen.getByText('Thinking')).toBeDefined();
    expect(screen.getByText('Thinking trace')).toBeDefined();
    expect(screen.getByTestId('tool-usage-list')).toBeDefined();
    expect(toolUsageListSpy.mock.calls.at(-1)?.[0].searchInteractive).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Back to agents' }));
    expect(screen.getByRole('list')).toBeDefined();
  });

  it('shows running and queued detail placeholders', () => {
    const { rerender } = render(
      <AgentExpandedView
        agents={[
          createAgent({
            id: 1,
            label: 'Runner',
            state: 'running',
            displayStatus: 'Running',
            progressValue: 0.4,
            result: undefined,
          }),
        ]}
        elapsedSeconds={5}
        modelLabel="HEAVY"
        indicatorState="running"
        toolEvents={[]}
        onCollapse={vi.fn()}
      />
    );

    clickAgentRow('Runner');
    expect(
      screen.getByText('Runner is planning the approach and collecting context...')
    ).toBeDefined();

    rerender(
      <AgentExpandedView
        agents={[
          createAgent({
            id: 2,
            label: 'Queued agent',
            state: 'queued',
            displayStatus: 'Queued',
            progressValue: 0.05,
            result: undefined,
          }),
        ]}
        elapsedSeconds={5}
        modelLabel="HEAVY"
        indicatorState="queued"
        toolEvents={[]}
        onCollapse={vi.fn()}
      />
    );

    clickAgentRow('Queued agent');
    expect(screen.getByText('Waiting for Queued agent to start...')).toBeDefined();
  });

  it('shows failed agents as waiting placeholders when no result is available', () => {
    render(
      <AgentExpandedView
        agents={[
          createAgent({
            id: 9,
            label: 'Broken agent',
            state: 'failed',
            displayStatus: 'Failed',
            result: undefined,
          }),
        ]}
        elapsedSeconds={5}
        modelLabel="HEAVY"
        indicatorState="failed"
        toolEvents={[]}
        onCollapse={vi.fn()}
      />
    );

    clickAgentRow('Broken agent');
    expect(screen.getByText('Waiting for Broken agent to start...')).toBeDefined();
  });

  it('groups tool events by agent id and by normalized label fallback', () => {
    render(
      <AgentExpandedView
        agents={[
          createAgent({ id: 1, label: 'Planner' }),
          createAgent({ id: 2, label: 'Researcher', state: 'queued', progressValue: 0.1 }),
        ]}
        elapsedSeconds={7}
        modelLabel="HEAVY"
        indicatorState="running"
        toolEvents={
          [
            createEvent({ agentId: 1, agentLabel: 'other' }),
            createEvent({ agentLabel: 'researcher', toolName: 'fetch' }),
            createEvent({ agentLabel: 'unknown', toolName: 'noop' }),
          ] as any
        }
        searchInteractive={false}
        onCollapse={vi.fn()}
      />
    );

    clickAgentRow('Planner');
    const plannerProps = toolUsageListSpy.mock.calls.at(-1)?.[0];
    expect(plannerProps.events).toHaveLength(1);
    expect(plannerProps.events[0].toolName).toBe('search');

    fireEvent.click(screen.getByRole('button', { name: 'Back to agents' }));
    clickAgentRow('Researcher');
    const researcherProps = toolUsageListSpy.mock.calls.at(-1)?.[0];
    expect(researcherProps.events).toHaveLength(1);
    expect(researcherProps.events[0].toolName).toBe('fetch');
  });

  it('matches live tool events by ordinal labels and model labels', () => {
    render(
      <AgentExpandedView
        agents={[
          createAgent({ id: 0, label: 'AGENT 1', model: 'openai/gpt-5.5' }),
          createAgent({ id: 1, label: 'AGENT 2', model: 'xai/grok-4.3' }),
        ]}
        elapsedSeconds={12}
        modelLabel="HEAVY"
        indicatorState="running"
        toolEvents={
          [
            createEvent({ agentLabel: 'agent-2 (researcher)', toolName: 'search_web' }),
            createEvent({ agentLabel: 'openai/gpt-5.5', toolName: 'code_interpreter' }),
          ] as any
        }
        onCollapse={vi.fn()}
      />
    );

    clickAgentRow('AGENT 1');
    const firstProps = toolUsageListSpy.mock.calls.at(-1)?.[0];
    expect(firstProps.events).toHaveLength(1);
    expect(firstProps.events[0].toolName).toBe('code_interpreter');

    fireEvent.click(screen.getByRole('button', { name: 'Back to agents' }));
    clickAgentRow('AGENT 2');
    const secondProps = toolUsageListSpy.mock.calls.at(-1)?.[0];
    expect(secondProps.events).toHaveLength(1);
    expect(secondProps.events[0].toolName).toBe('search_web');
  });

  it('maps internal Sentinel backing model ids to the public label in expanded views', () => {
    render(
      <AgentExpandedView
        agents={[createAgent({ id: 0, label: 'AGENT 1', model: 'moonshotai/kimi-k2.6' })]}
        elapsedSeconds={12}
        modelLabel="HEAVY"
        indicatorState="running"
        toolEvents={[]}
        onCollapse={vi.fn()}
      />
    );

    expect(screen.getByText('Sentinel')).toBeDefined();
    expect(screen.queryByText(/kimi/i)).toBeNull();

    clickAgentRow('Sentinel');
    expect(screen.getByLabelText('Sentinel detail')).toBeDefined();
    expect(screen.getByRole('progressbar', { name: 'Sentinel progress' })).toBeDefined();
  });

  it('summarizes generated media in agent progress instead of rendering markdown payloads', () => {
    render(
      <AgentExpandedView
        agents={[
          createAgent({
            id: 0,
            label: 'AGENT 1',
            result:
              '<video controls preload="metadata" playsinline><source src="https://cdn.example/video.mp4" type="video/mp4"></video>\n\n[Download generated video](https://cdn.example/video.mp4)',
          }),
        ]}
        elapsedSeconds={26}
        modelLabel="GROK IMAGINE VIDEO"
        indicatorState="completed"
        toolEvents={[]}
        onCollapse={vi.fn()}
      />
    );

    expect(screen.getByText('Generated video ready.')).toBeDefined();
    expect(screen.queryByText(/Download generated video/)).toBeNull();

    clickAgentRow('AGENT 1');
    expect(screen.getByText('Generated video ready.')).toBeDefined();
    expect(screen.queryByText(/<video controls/)).toBeNull();
  });

  it('summarizes generated video link-only progress payloads', () => {
    render(
      <AgentExpandedView
        agents={[
          createAgent({
            id: 0,
            label: 'Grok Imagine Video',
            state: 'completed',
            displayStatus: 'Completed',
            progressValue: 1,
            result:
              '[Download generated video](https://vidgen.x.ai/xai-vidgen-bucket/xai-video-123.mp4)',
          }),
        ]}
        elapsedSeconds={26}
        modelLabel="GROK IMAGINE VIDEO"
        indicatorState="completed"
        toolEvents={[]}
        onCollapse={vi.fn()}
      />
    );

    expect(screen.getByText('Generated video ready.')).toBeDefined();
    expect(screen.queryByText(/xai-vidgen-bucket/)).toBeNull();
  });

  it('surfaces unattributed live tool events for single-agent runs', () => {
    render(
      <AgentExpandedView
        agents={[createAgent({ id: 0, label: 'AGENT 1' })]}
        elapsedSeconds={9}
        modelLabel="HEAVY"
        indicatorState="running"
        toolEvents={
          [
            createEvent({ agentLabel: 'Agent', toolName: 'execute_python' }),
            createEvent({ agentLabel: '', toolName: 'search_web' }),
          ] as any
        }
        onCollapse={vi.fn()}
      />
    );

    expect(screen.getByText(/2 tool calls.*latest: search_web/)).toBeDefined();
    clickAgentRow('AGENT 1');
    const detailProps = toolUsageListSpy.mock.calls.at(-1)?.[0];
    expect(detailProps.events.map((event: any) => event.toolName)).toEqual([
      'execute_python',
      'search_web',
    ]);
  });

  it('surfaces unattributed live tool events for running agents in team runs', () => {
    render(
      <AgentExpandedView
        agents={[
          createAgent({ id: 0, label: 'AGENT 1', state: 'running' }),
          createAgent({ id: 1, label: 'AGENT 2', state: 'queued', progressValue: 0.05 }),
        ]}
        elapsedSeconds={14}
        modelLabel="HEAVY"
        indicatorState="running"
        toolEvents={[createEvent({ agentLabel: 'Agent', toolName: 'search_web' })] as any}
        onCollapse={vi.fn()}
      />
    );

    expect(screen.getByText('1 tool call · latest: search_web')).toBeDefined();
    expect(screen.getByText('Waiting for the agent to start...')).toBeDefined();

    clickAgentRow('AGENT 1');
    const detailProps = toolUsageListSpy.mock.calls.at(-1)?.[0];
    expect(detailProps.events.map((event: any) => event.toolName)).toEqual(['search_web']);
  });

  it('describes latest live tool activity in selected running agent detail', () => {
    render(
      <AgentExpandedView
        agents={[createAgent({ id: 0, label: 'AGENT 1', state: 'running', result: undefined })]}
        elapsedSeconds={14}
        modelLabel="HEAVY"
        indicatorState="running"
        toolEvents={
          [
            createEvent({
              agentId: 0,
              agentLabel: 'AGENT 1',
              toolName: 'search_web',
              resultPreview: 'Found results',
            }),
          ] as any
        }
        onCollapse={vi.fn()}
      />
    );

    clickAgentRow('AGENT 1');
    expect(screen.getByText('Latest tool: search_web returned results.')).toBeDefined();
    expect(
      screen.queryByText('AGENT 1 is gathering evidence and comparing findings...')
    ).toBeNull();
  });

  it('clears selected agent if it disappears from the list', () => {
    const onCollapse = vi.fn();
    const { rerender } = render(
      <AgentExpandedView
        agents={[createAgent({ id: 1, label: 'Planner' })]}
        elapsedSeconds={7}
        modelLabel="HEAVY"
        indicatorState="running"
        toolEvents={[]}
        onCollapse={onCollapse}
      />
    );

    clickAgentRow('Planner');
    expect(screen.getByLabelText('Planner detail')).toBeDefined();

    rerender(
      <AgentExpandedView
        agents={[]}
        elapsedSeconds={8}
        modelLabel="HEAVY"
        indicatorState="running"
        toolEvents={[]}
        onCollapse={onCollapse}
      />
    );

    expect(screen.queryByLabelText('Planner detail')).toBeNull();
    expect(screen.getByText('Agents are spinning up...')).toBeDefined();
  });
});
