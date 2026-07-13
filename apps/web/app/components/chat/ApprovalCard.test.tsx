import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../tests/setup/dom';
import { ApprovalCard } from './ApprovalCard';

const submitTaskApprovalDecisionMock = vi.fn();
const loggerErrorMock = vi.fn();

vi.mock('../../lib/api/tasks', () => ({
  submitTaskApprovalDecision: submitTaskApprovalDecisionMock,
}));

vi.mock('../../lib/logger', () => ({
  logger: {
    error: loggerErrorMock,
  },
}));

describe('ApprovalCard', () => {
  const baseProps = {
    taskId: 'task-123',
    approval: {
      agentName: 'TestAgent',
      permission: 'read_file',
      patterns: ['*.txt'],
      metadata: {},
    },
    onDecision: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    submitTaskApprovalDecisionMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders approval request content', () => {
    render(<ApprovalCard {...baseProps} />);
    expect(screen.getByText(/action required/i)).toBeTruthy();
    expect(screen.getByText(/testagent is requesting permission/i)).toBeTruthy();
  });

  it('renders tool request details', () => {
    render(<ApprovalCard {...baseProps} />);
    expect(screen.getByText('read_file')).toBeTruthy();
  });

  it('omits pattern separator when no patterns are provided', () => {
    render(
      <ApprovalCard
        {...baseProps}
        approval={{
          ...baseProps.approval,
          patterns: [],
        }}
      />
    );

    expect(screen.getByText('read_file')).toBeTruthy();
    expect(screen.queryByText('→')).toBeNull();
    expect(screen.queryByText('*.txt')).toBeNull();
  });

  it('renders approve button', () => {
    render(<ApprovalCard {...baseProps} />);
    expect(screen.getByRole('button', { name: /approve action/i })).toBeTruthy();
  });

  it('renders deny button', () => {
    render(<ApprovalCard {...baseProps} />);
    expect(screen.getByRole('button', { name: /deny/i })).toBeTruthy();
  });

  it('calls onDecision with true when approved', async () => {
    render(<ApprovalCard {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /approve action/i }));

    await waitFor(() => {
      expect(submitTaskApprovalDecisionMock).toHaveBeenCalledWith('task-123', { approved: true });
      expect(baseProps.onDecision).toHaveBeenCalledWith(true);
    });
  });

  it('calls onDecision with false when denied', async () => {
    render(<ApprovalCard {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /deny/i }));

    await waitFor(() => {
      expect(submitTaskApprovalDecisionMock).toHaveBeenCalledWith('task-123', { approved: false });
      expect(baseProps.onDecision).toHaveBeenCalledWith(false);
    });
  });

  it('renders metadata when provided', () => {
    const props = {
      ...baseProps,
      approval: {
        ...baseProps.approval,
        metadata: { file: '/test.txt' },
      },
    };
    render(<ApprovalCard {...props} />);
    expect(screen.getByText(/test\.txt/i)).toBeTruthy();
  });

  it('renders proposed changes when approval metadata includes a diff', () => {
    render(
      <ApprovalCard
        {...baseProps}
        approval={{
          ...baseProps.approval,
          metadata: {
            patch: [
              'diff --git a/src/app.ts b/src/app.ts',
              '--- a/src/app.ts',
              '+++ b/src/app.ts',
              '@@ -1 +1 @@',
              '-old',
              '+new',
            ].join('\n'),
          },
        }}
      />
    );

    expect(screen.getByText('Proposed Changes')).toBeTruthy();
    expect(screen.getByText('src/app.ts')).toBeTruthy();
    expect(screen.getByText('+new')).toBeTruthy();
    expect(screen.queryByText(/"patch":/i)).toBeNull();
  });

  it('renders multi-key metadata as formatted JSON', () => {
    render(
      <ApprovalCard
        {...baseProps}
        approval={{
          ...baseProps.approval,
          metadata: { command: 'rm', risk: 'high' },
        }}
      />
    );

    expect(screen.getByText(/"command": "rm"/i)).toBeTruthy();
    expect(screen.getByText(/"risk": "high"/i)).toBeTruthy();
  });

  it('logs submission failures, skips onDecision, and re-enables the buttons', async () => {
    const onDecision = vi.fn();
    submitTaskApprovalDecisionMock.mockRejectedValueOnce(new Error('approval unavailable'));

    render(<ApprovalCard {...baseProps} onDecision={onDecision} />);
    fireEvent.click(screen.getByRole('button', { name: /approve action/i }));

    await waitFor(() => {
      expect(loggerErrorMock).toHaveBeenCalledWith(
        'Failed to submit approval decision',
        expect.objectContaining({ taskId: 'task-123' })
      );
      expect(onDecision).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: /approve action/i })).not.toBeDisabled();
    });
  });

  it('disables buttons while loading', async () => {
    let resolveSubmission: (() => void) | undefined;
    submitTaskApprovalDecisionMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSubmission = resolve;
        })
    );

    render(<ApprovalCard {...baseProps} />);

    const approveButton = screen.getByRole('button', { name: /approve action/i });
    const denyButton = screen.getByRole('button', { name: /deny/i });

    fireEvent.click(approveButton);

    await waitFor(() => {
      expect(approveButton).toBeDisabled();
      expect(denyButton).toBeDisabled();
      expect(resolveSubmission).toBeDefined();
    });

    if (!resolveSubmission) {
      throw new Error('Expected approval promise resolver to be initialized');
    }
    const resolve = resolveSubmission;
    await act(async () => {
      resolve();
    });
  });
});
