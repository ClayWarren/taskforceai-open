import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../../tests/setup/dom';

vi.mock('@taskforceai/ui-kit', () => ({
  Dialog: ({ children, open }: any) => (open ? <div data-testid="dialog">{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <div>{children}</div>,
}));

import { OrchestrationModal } from './OrchestrationModal';

describe('OrchestrationModal', () => {
  afterEach(() => cleanup());

  const baseProps = {
    isOpen: true,
    onClose: vi.fn(),
    models: [
      { id: 'gpt-4', label: 'GPT-4', badge: 'Pro', usageMultiple: 1 },
      { id: 'gpt-3.5', label: 'GPT-3.5', badge: 'Free', usageMultiple: 0.5 },
    ],
    roleModels: {},
    onRoleModelChange: vi.fn(),
    onBudgetChange: vi.fn(),
    autonomyEnabled: false,
    defaultModelId: 'gpt-4',
    defaultModelLabel: 'GPT-4',
  };

  it('renders base orchestration structure when open', () => {
    render(<OrchestrationModal {...baseProps} />);
    expect(screen.getByTestId('dialog')).toBeTruthy();
    expect(screen.getByText('Custom Orchestration')).toBeTruthy();
    expect(screen.getByText(/assign specialized models/i)).toBeTruthy();
    expect(screen.getByText('Researcher')).toBeTruthy();
    expect(screen.getByText('Analyst')).toBeTruthy();
    expect(screen.getByText('Skeptic')).toBeTruthy();
    expect(screen.getByText('Pragmatist')).toBeTruthy();
    expect(screen.getByText(/boss \/ synthesis/i)).toBeTruthy();
    expect(screen.getByText('Final Result')).toBeTruthy();
    const selects = document.querySelectorAll('select');
    expect(selects.length).toBeGreaterThan(0);
  });

  it('shows autonomy copy and budget input when autonomy enabled', () => {
    render(<OrchestrationModal {...baseProps} autonomyEnabled />);
    expect(screen.getByText(/mission budget/i)).toBeTruthy();
    expect(screen.getByText(/organization budget/i)).toBeTruthy();
  });

  it('shows role slots for the selected agent count', () => {
    render(<OrchestrationModal {...baseProps} agentCount={2} />);
    expect(screen.getByText('Researcher')).toBeTruthy();
    expect(screen.getByText('Analyst')).toBeTruthy();
    expect(screen.queryByText('Skeptic')).toBeNull();
    expect(screen.queryByText('Pragmatist')).toBeNull();
    expect(document.querySelectorAll('select')).toHaveLength(2);
  });
});
