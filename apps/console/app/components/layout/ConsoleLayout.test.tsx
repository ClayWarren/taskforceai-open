import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

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
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 0;
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('opens and closes the mobile sidebar from layout controls', () => {
    render(<ConsoleLayout />);

    expect(screen.getByTestId('console-sidebar')).toHaveAttribute('data-open', 'false');

    const openNavigation = screen.getByRole('button', {
      name: 'Open navigation',
    });
    expect(openNavigation).toHaveAttribute('aria-expanded', 'false');
    expect(openNavigation).toHaveAttribute('aria-controls', 'console-sidebar');

    fireEvent.click(openNavigation);
    expect(screen.getByTestId('console-sidebar')).toHaveAttribute('data-open', 'true');
    expect(openNavigation).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Close sidebar' }));
    expect(screen.getByTestId('console-sidebar')).toHaveAttribute('data-open', 'false');
    expect(openNavigation).toHaveFocus();
    expect(screen.getByText('Outlet content')).toBeInTheDocument();
    expect(screen.getByRole('main').className).toContain('min-w-0');
  });
});
