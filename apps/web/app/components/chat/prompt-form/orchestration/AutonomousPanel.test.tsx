import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, expect, it, vi } from 'bun:test';

import '../../../../../../../tests/setup/dom';

vi.mock('@taskforceai/ui-kit/dialog', () => ({
  Dialog: ({ children, open }: any) => (open ? <div data-testid="dialog">{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <div>{children}</div>,
}));

import { AutonomousPanel } from './AutonomousPanel';

describe('AutonomousPanel', () => {
  const baseProps = {
    isOpen: true,
    onClose: vi.fn(),
    budget: 10,
    onBudgetChange: vi.fn(),
  };

  it('renders dialog, title, and budget label when open', () => {
    render(<AutonomousPanel {...baseProps} />);
    expect(screen.getAllByTestId('dialog').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Autonomous Mode').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/budget limit/i).length).toBeGreaterThan(0);
  });

  it('parses, clears, and ignores invalid budget input', async () => {
    const onBudgetChange = vi.fn();
    const user = userEvent.setup({ document: globalThis.document });
    const Harness = () => {
      const [budget, setBudget] = React.useState<number | undefined>(10);

      return (
        <AutonomousPanel
          {...baseProps}
          budget={budget}
          onBudgetChange={(nextBudget) => {
            onBudgetChange(nextBudget);
            setBudget(nextBudget);
          }}
        />
      );
    };

    render(<Harness />);
    const input = screen.getByPlaceholderText('No limit');

    await user.clear(input);
    await user.type(input, '12.50');
    expect(onBudgetChange).toHaveBeenLastCalledWith(12.5);

    await user.click(input);
    await user.keyboard('{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}');
    expect(onBudgetChange).toHaveBeenLastCalledWith(undefined);

    const callCountBeforeInvalid = onBudgetChange.mock.calls.length;
    await user.type(input, '-1');
    expect(onBudgetChange).toHaveBeenCalledTimes(callCountBeforeInvalid);
  });

  it('renders streaming spend progress and no-limit state', () => {
    const { rerender } = render(
      <AutonomousPanel {...baseProps} budget={10} currentSpend={2.5} budgetLimit={20} isStreaming />
    );

    expect(screen.getByText('$2.50')).toBeTruthy();
    expect(screen.getByText('$2.50 spent')).toBeTruthy();
    expect(screen.getByText('$17.50 remaining')).toBeTruthy();

    rerender(
      <AutonomousPanel
        {...baseProps}
        budget={undefined}
        currentSpend={2.5}
        budgetLimit={null}
        isStreaming
      />
    );

    expect(screen.getByText(/No budget limit set/i)).toBeTruthy();
  });
});
