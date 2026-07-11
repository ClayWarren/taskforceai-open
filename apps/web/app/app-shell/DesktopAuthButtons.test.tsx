import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'bun:test';

import { DesktopAuthButtons } from './DesktopAuthButtons';

describe('DesktopAuthButtons', () => {
  const defaultProps = {
    onSignIn: vi.fn(),
  };

  const renderButtons = (overrides: Partial<typeof defaultProps> = {}) =>
    render(<DesktopAuthButtons {...defaultProps} {...overrides} />);

  it('renders Sign in button', () => {
    renderButtons();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeTruthy();
  });

  it('calls onSignIn when Sign in button is clicked', () => {
    const onSignIn = vi.fn();
    renderButtons({ onSignIn });

    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });
});
