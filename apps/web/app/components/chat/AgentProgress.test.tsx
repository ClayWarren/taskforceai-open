import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'bun:test';
import '../../../../../tests/setup/dom';

import { useStreaming } from '../../lib/providers/StreamingProvider';
import AgentProgress from './AgentProgress';

vi.mock('../../lib/providers/StreamingProvider', () => ({
  useStreaming: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AgentProgress', () => {
  it('renders nothing when not streaming', () => {
    (useStreaming as any).mockReturnValue({
      isStreaming: false,
      agentStatuses: [],
      agentLabels: [],
    });
    const { container } = render(<AgentProgress />);
    expect(container.firstChild).toBeNull();
  });

  it('renders progress lines for each agent', () => {
    (useStreaming as any).mockReturnValue({
      isStreaming: true,
      agentLabels: [],
      agentStatuses: [
        { status: 'INITIALIZING...' },
        { status: 'PROGRESS:0.5' },
        { status: 'COMPLETED' },
      ],
    });

    render(<AgentProgress />);

    expect(screen.getByText('🤖 Agent Progress')).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('INITIALIZING...')).toBeTruthy();
    expect(screen.getByText('PROGRESS:0.5')).toBeTruthy();
    expect(screen.getByText('COMPLETED')).toBeTruthy();
  });

  it('computes correct progress for special statuses', () => {
    (useStreaming as any).mockReturnValue({
      isStreaming: true,
      agentLabels: [],
      agentStatuses: [{ status: 'PROCESSING...' }],
    });
    render(<AgentProgress />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('60');
  });

  it('shows parallel indicator when multiple agents are active', () => {
    (useStreaming as any).mockReturnValue({
      isStreaming: true,
      agentLabels: [],
      agentStatuses: [{ status: 'INITIALIZING...' }, { status: 'PROCESSING...' }],
    });
    render(<AgentProgress />);
    expect(screen.getByText(/agents working simultaneously/i)).toBeTruthy();
  });

  it('uses agent_id when available for labeling', () => {
    (useStreaming as any).mockReturnValue({
      isStreaming: true,
      agentLabels: [],
      agentStatuses: [{ status: 'PROCESSING...', agent_id: 3 }],
    });
    render(<AgentProgress />);
    expect(screen.getByText('AGENT 04')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'AGENT 04 progress' })).toBeTruthy();
  });

  it('uses configured custom model labels when streaming agent statuses are generic', () => {
    (useStreaming as any).mockReturnValue({
      isStreaming: true,
      agentLabels: ['gpt-5.5', 'claude-fable-5'],
      agentStatuses: [
        { status: 'PROCESSING...', agent_id: 0 },
        { status: 'INITIALIZING...', agent_id: 1 },
      ],
    });

    render(<AgentProgress />);

    expect(screen.getByText('gpt-5.5')).toBeTruthy();
    expect(screen.getByText('claude-fable-5')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'gpt-5.5 progress' })).toBeTruthy();
  });

  it('prefers backend model labels over configured labels', () => {
    (useStreaming as any).mockReturnValue({
      isStreaming: true,
      agentLabels: ['gpt-5.5'],
      agentStatuses: [{ status: 'PROCESSING...', agent_id: 0, model: 'Sentinel' }],
    });

    render(<AgentProgress />);

    expect(screen.getByText('Sentinel')).toBeTruthy();
    expect(screen.queryByText('gpt-5.5')).toBeNull();
  });

  it('maps Sentinel backing ids to the public Sentinel label', () => {
    (useStreaming as any).mockReturnValue({
      isStreaming: true,
      agentLabels: [],
      agentStatuses: [{ status: 'PROCESSING...', agent_id: 0, model: 'moonshotai/kimi-k2.6' }],
    });

    render(<AgentProgress />);

    expect(screen.getByText('Sentinel')).toBeTruthy();
    expect(screen.queryByText(/kimi/i)).toBeNull();
    expect(screen.getByRole('progressbar', { name: 'Sentinel progress' })).toBeTruthy();
  });

  it('handles FAILED status', () => {
    (useStreaming as any).mockReturnValue({
      isStreaming: true,
      agentLabels: [],
      agentStatuses: [{ status: 'FAILED: Error message' }],
    });
    render(<AgentProgress />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
    // Color should be red but styles are inline... actuallybackgroundColor is set.
    // We can check style.backgroundColor if JSDOM supports it.
  });
});
