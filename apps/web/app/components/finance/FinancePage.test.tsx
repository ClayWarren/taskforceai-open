import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../tests/setup/dom';

const navigate = vi.fn();
const writeCapturedPromptDraft = vi.fn();

vi.mock('../routing', () => ({
  useRouter: () => ({ navigate }),
}));

vi.mock('../../lib/prompt/hydration-draft-capture', () => ({
  writeCapturedPromptDraft,
}));

vi.mock('../../lib/profile/ProfileFinanceSection', () => ({
  ProfileFinanceSection: () => <div>finance-dashboard</div>,
}));

import { FinancePage } from './FinancePage';

describe('FinancePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('prefills a starter and continues the question in chat', () => {
    render(<FinancePage />);

    fireEvent.click(screen.getByRole('button', { name: /Subscriptions overview/ }));
    fireEvent.submit(
      screen.getByRole('button', { name: 'Continue finance question in chat' }).closest('form')!
    );

    expect(writeCapturedPromptDraft).toHaveBeenCalledWith(
      'What subscriptions and recurring charges am I currently paying for?'
    );
    expect(navigate).toHaveBeenCalledWith({ to: '/' });
  });

  it('shows dashboard and account navigation with the live finance section', () => {
    render(<FinancePage />);

    expect(screen.getByRole('button', { name: 'dashboard' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    fireEvent.click(screen.getByRole('button', { name: 'accounts' }));
    expect(screen.getByRole('button', { name: 'accounts' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByText('finance-dashboard')).toBeTruthy();
  });
});
