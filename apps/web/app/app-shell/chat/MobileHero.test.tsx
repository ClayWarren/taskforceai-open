import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, test, vi } from 'bun:test';

import '../../../../../tests/setup/dom';

import { MobileHero } from './MobileHero';

describe('MobileHero', () => {
  const defaultProps = {
    isAuthenticated: false,
    onHamburgerClick: vi.fn(),
    onSignIn: vi.fn(),
  };

  const renderHero = (overrides: Partial<typeof defaultProps> = {}) =>
    render(<MobileHero {...defaultProps} {...overrides} />);

  it('renders unauthenticated view correctly', () => {
    renderHero({ isAuthenticated: false });
    expect(screen.getByText(/Sign in/i)).toBeTruthy();
    expect(screen.queryByText(/Sign up/i)).toBeNull();
    expect(screen.getByText('TaskForceAI')).toBeTruthy();
  });

  it('calls sign in/up handlers', () => {
    const onSignIn = vi.fn();
    renderHero({ isAuthenticated: false, onSignIn });

    fireEvent.click(screen.getByText(/Sign in/i));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  test('renders authenticated view correctly', () => {
    renderHero({ isAuthenticated: true });

    expect(screen.getByLabelText('Open sidebar')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /sign in/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /sign up/i })).toBeNull();
  });

  test('calls hamburger handler', () => {
    renderHero({ isAuthenticated: true });

    fireEvent.click(screen.getByLabelText('Open sidebar'));
    expect(defaultProps.onHamburgerClick).toHaveBeenCalled();
  });
});
