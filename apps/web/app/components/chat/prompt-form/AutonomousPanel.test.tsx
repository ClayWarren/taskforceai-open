import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'bun:test';

import '../../../../../../tests/setup/dom';

vi.mock('@taskforceai/ui-kit', () => ({
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
});
