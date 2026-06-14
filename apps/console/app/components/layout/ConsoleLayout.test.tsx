import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../tests/setup/dom';

const mockOutlet = vi.fn(() => <div>Outlet content</div>);

vi.mock('@tanstack/react-router', () => ({
  Outlet: mockOutlet,
}));

vi.mock('./ConsoleSidebar', () => ({
  ConsoleSidebar: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => (
    <aside data-testid="console-sidebar" data-open={String(isOpen)}>
      <button type="button" onClick={onClose}>
        Close sidebar
      </button>
    </aside>
  ),
}));

import { ConsoleLayout } from './ConsoleLayout';

describe('ConsoleLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens and closes the mobile sidebar from layout controls', () => {
    render(<ConsoleLayout />);

    expect(screen.getByTestId('console-sidebar')).toHaveAttribute('data-open', 'false');

    fireEvent.click(screen.getByRole('button', { name: '' }));
    expect(screen.getByTestId('console-sidebar')).toHaveAttribute('data-open', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Close sidebar' }));
    expect(screen.getByTestId('console-sidebar')).toHaveAttribute('data-open', 'false');
    expect(screen.getByText('Outlet content')).toBeInTheDocument();
  });
});
