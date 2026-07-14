import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, type Mock, vi } from 'bun:test';

import '../../../../../tests/setup/dom';

vi.mock('../../lib/api/tasks', () => ({
  fetchTaskExecutionTrace: vi.fn(),
}));

vi.mock('../../lib/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

import { fetchTaskExecutionTrace } from '../../lib/api/tasks';
import { ExecutionReplay } from './ExecutionReplay';

describe('ExecutionReplay', () => {
  const onFrameUpdate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when loading', () => {
    (fetchTaskExecutionTrace as Mock<any>).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    const { container } = render(
      <ExecutionReplay taskId="task-123" onFrameUpdate={onFrameUpdate} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('returns null when trace has no steps', async () => {
    (fetchTaskExecutionTrace as Mock<any>).mockResolvedValue({
      ok: true,
      value: { steps: [] },
    });

    const { container } = render(
      <ExecutionReplay taskId="task-123" onFrameUpdate={onFrameUpdate} />
    );

    await waitFor(() => {
      expect(fetchTaskExecutionTrace).toHaveBeenCalled();
    });

    // Should still be null because no steps = totalSteps 0 => return null
    expect(container.firstChild).toBeNull();
  });

  it('renders replay UI when trace has steps', async () => {
    (fetchTaskExecutionTrace as Mock<any>).mockResolvedValue({
      ok: true,
      value: {
        steps: [{ AgentID: 'agent-1', Status: 'COMPLETED', Response: 'Result', ToolEvents: [] }],
      },
    });

    render(<ExecutionReplay taskId="task-123" onFrameUpdate={onFrameUpdate} />);

    await waitFor(() => {
      expect(screen.getByText(/execution replay/i)).toBeTruthy();
    });
  });

  it('calls onFrameUpdate with frame data', async () => {
    (fetchTaskExecutionTrace as Mock<any>).mockResolvedValue({
      ok: true,
      value: {
        steps: [{ AgentID: 'agent-1', Status: 'RUNNING', Response: 'Result', ToolEvents: [] }],
      },
    });

    render(<ExecutionReplay taskId="task-123" onFrameUpdate={onFrameUpdate} />);

    await waitFor(() => {
      expect(onFrameUpdate).toHaveBeenCalled();
    });
  });
});
