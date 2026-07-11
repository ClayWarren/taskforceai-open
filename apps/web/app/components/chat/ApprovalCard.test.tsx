import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../tests/setup/dom';
import { ApprovalCard } from './ApprovalCard';

const withCsrfMock = vi.fn();
const loggerErrorMock = vi.fn();

vi.mock('@taskforceai/api-client/auth/csrf', () => ({
  getCsrfToken: vi.fn(async () => 'csrf-token'),
  withCsrf: withCsrfMock,
}));

vi.mock('../../lib/logger', () => ({
  logger: {
    error: loggerErrorMock,
  },
}));

(global as any).fetch = vi.fn();

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
    withCsrfMock.mockImplementation(async (init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set('X-CSRF-Token', 'csrf-token');
      return { ...init, headers };
    });
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
    (fetch as any).mockResolvedValue({ ok: true } as Response);

    render(<ApprovalCard {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /approve action/i }));

    await waitFor(() => {
      expect(baseProps.onDecision).toHaveBeenCalledWith(true);
    });
  });

  it('applies CSRF headers for approval mutations', async () => {
    (fetch as any).mockResolvedValue({ ok: true } as Response);

    render(<ApprovalCard {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /deny/i }));

    await waitFor(() => {
      expect(withCsrfMock).toHaveBeenCalledWith({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: false }),
      });
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/tasks/task-123/approve',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ approved: false }),
        })
      );
    });
  });

  it('encodes task ids in approval endpoint paths', async () => {
    (fetch as any).mockResolvedValue({ ok: true } as Response);
    const props = {
      ...baseProps,
      taskId: '../task-123',
    };

    render(<ApprovalCard {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /approve action/i }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/v1/tasks/..%2Ftask-123/approve', expect.anything());
    });
  });

  it('calls onDecision with false when denied', async () => {
    (fetch as any).mockResolvedValue({ ok: true } as Response);

    render(<ApprovalCard {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /deny/i }));

    await waitFor(() => {
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

  it('logs failed approval responses without calling onDecision', async () => {
    const onDecision = vi.fn();
    (fetch as any).mockResolvedValue({ ok: false } as Response);

    render(<ApprovalCard {...baseProps} onDecision={onDecision} />);
    fireEvent.click(screen.getByRole('button', { name: /approve action/i }));

    await waitFor(() => {
      expect(loggerErrorMock).toHaveBeenCalledWith(
        'Failed to submit approval decision',
        expect.objectContaining({ taskId: 'task-123' })
      );
      expect(onDecision).not.toHaveBeenCalled();
    });
  });

  it('logs CSRF failures and re-enables decision buttons', async () => {
    withCsrfMock.mockRejectedValue(new Error('csrf unavailable'));

    render(<ApprovalCard {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /deny/i }));

    await waitFor(() => {
      expect(loggerErrorMock).toHaveBeenCalledWith(
        'Failed to submit approval decision',
        expect.objectContaining({ taskId: 'task-123' })
      );
      expect(screen.getByRole('button', { name: /deny/i })).not.toBeDisabled();
    });
  });

  it('disables buttons while loading', async () => {
    let resolveFn: ((value: Response) => void) | undefined;
    (fetch as any).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFn = resolve;
        })
    );

    render(<ApprovalCard {...baseProps} />);

    const approveButton = screen.getByRole('button', { name: /approve action/i });
    const denyButton = screen.getByRole('button', { name: /deny/i });

    fireEvent.click(approveButton);

    await waitFor(() => {
      expect(approveButton).toBeDisabled();
      expect(denyButton).toBeDisabled();
      expect(resolveFn).toBeDefined();
    });

    // Resolve the promise to clean up
    if (!resolveFn) {
      throw new Error('Expected fetch promise resolver to be initialized');
    }
    const resolveFetch = resolveFn;
    await act(async () => {
      resolveFetch({ ok: true } as Response);
      await Promise.resolve();
    });
  });
});
