import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'bun:test';

import { logger } from '../../lib/logger';
import { submitIssueReportWithVersion } from '../../lib/support/issue-report';
import ReportIssueModal from './ReportIssueModal';

const fillTextarea = (textarea: HTMLElement, value: string) => {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  valueSetter?.call(textarea, value);
  fireEvent.input(textarea, { target: { value } });
};

// Mock logger
const loggerMock = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
};

vi.mock('../../lib/logger', () => ({
  logger: loggerMock,
}));

vi.mock('../../lib/support/issue-report', () => ({
  submitIssueReportWithVersion: vi.fn(),
}));

describe('ReportIssueModal', () => {
  beforeEach(() => {
    loggerMock.info.mockClear();
    loggerMock.error.mockClear();
    (submitIssueReportWithVersion as any).mockReset();
  });

  test('does not render when not open', () => {
    render(<ReportIssueModal open={false} onOpenChange={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('renders when open', () => {
    render(<ReportIssueModal open={true} onOpenChange={() => {}} />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Report an issue')).toBeTruthy();
  });

  test('validates input before enabling submit', async () => {
    const user = userEvent.setup();
    render(<ReportIssueModal open={true} onOpenChange={() => {}} />);

    const submitButton = screen.getByRole('button', { name: 'Send' });
    expect(submitButton.hasAttribute('disabled')).toBe(true);

    // Select category
    const categorySelect = screen.getByLabelText('Feedback type');
    await user.selectOptions(categorySelect, 'ui_bug');

    expect(submitButton.hasAttribute('disabled')).toBe(true); // Still disabled (no description)

    // Enter short description
    const descriptionInput = screen.getByLabelText('Your feedback');
    fillTextarea(descriptionInput, 'Too short');

    expect(submitButton.hasAttribute('disabled')).toBe(true); // Still disabled (too short)

    // Enter long description
    fillTextarea(descriptionInput, 'This is a valid description that is long enough to submit.');

    await waitFor(() => {
      expect(submitButton.hasAttribute('disabled')).toBe(false); // Enabled
    });
  });

  test('submits form data successfully', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    (submitIssueReportWithVersion as any).mockResolvedValue({ ok: true, value: undefined });
    render(
      <ReportIssueModal
        open={true}
        onOpenChange={onOpenChange}
        context={{ conversationId: '123' }}
      />
    );

    // Fill form
    await user.selectOptions(screen.getByLabelText('Feedback type'), 'ui_bug');
    const textarea = screen.getByRole('textbox', { name: 'Your feedback' });
    fillTextarea(textarea, 'This is a valid description.');

    // Check if enabled
    const submitButton = screen.getByRole('button', { name: 'Send' });
    await waitFor(() => {
      expect(submitButton.hasAttribute('disabled')).toBe(false);
    });

    // Submit
    await user.click(submitButton);

    await waitFor(() => {
      expect(submitIssueReportWithVersion).toHaveBeenCalledTimes(1);
    });

    expect(submitIssueReportWithVersion).toHaveBeenCalledWith({
      category: 'ui_bug',
      description: 'This is a valid description.',
      context: { conversationId: '123' },
    });

    await waitFor(() => {
      expect(screen.getByText(/Thanks for the report/)).toBeTruthy();
    });
  });

  test('handles submission error', async () => {
    const user = userEvent.setup();
    (submitIssueReportWithVersion as any).mockResolvedValue({
      ok: false,
      error: { kind: 'submit_failed', message: 'Server error' },
    });

    render(<ReportIssueModal open={true} onOpenChange={() => {}} />);

    // Fill form
    await user.selectOptions(screen.getByLabelText('Feedback type'), 'ui_bug');
    fillTextarea(screen.getByLabelText('Your feedback'), 'This is a valid description.');

    // Submit
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeTruthy();
    });

    expect(logger.error).toHaveBeenCalled();
  });

  test('closes modal on cancel', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<ReportIssueModal open={true} onOpenChange={onOpenChange} />);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
