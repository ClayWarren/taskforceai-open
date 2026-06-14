import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, mock, vi } from 'bun:test';

import '../../../../../../tests/setup/dom';

let mockSearchParams = new URLSearchParams();
const mockGetSession = vi.fn();
const mockGetSignInUrl = vi.fn();
const assignSpy = vi.fn();

mock.module('../../../components/routing', () => ({
  useSearchParams: vi.fn(() => mockSearchParams),
}));

mock.module('@taskforceai/contracts/auth/auth-client', () => ({
  authClient: {
    getSession: mockGetSession,
    getSignInUrl: mockGetSignInUrl,
  },
}));

mock.module('../../../lib/auth/auth-actions', () => ({
  authorizeDeviceLogin: vi.fn(),
}));

const { DeviceLoginContent } = await import('./page');

describe('DeviceLoginPage', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mockGetSession.mockReset();
    mockGetSignInUrl.mockReset();
    mockSearchParams = new URLSearchParams();
    mockGetSession.mockResolvedValue({
      user: { email: 'user@example.com' },
      expires: new Date(Date.now() + 60_000).toISOString(),
    });
    mockGetSignInUrl.mockReturnValue('/api/v1/auth/login?callbackUrl=%2Flogin%2Fdevice');
    assignSpy.mockReset();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { assign: assignSpy },
    });
  });

  it('prefills and formats the device code from the query string', async () => {
    mockSearchParams = new URLSearchParams('code=abcd1234');

    render(<DeviceLoginContent />);

    await waitFor(() => {
      expect(screen.getByLabelText('Device code')).toHaveValue('ABCD-1234');
    });
  });

  it('checks session state on mount', async () => {
    render(<DeviceLoginContent />);

    await waitFor(() => {
      expect(mockGetSession).toHaveBeenCalled();
    });
  });

  it('starts hosted sign-in when the inline sign-in button is clicked', async () => {
    render(<DeviceLoginContent />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(mockGetSignInUrl).toHaveBeenCalledWith({ callbackUrl: '/login/device' });
    expect(assignSpy).toHaveBeenCalledWith('/api/v1/auth/login?callbackUrl=%2Flogin%2Fdevice');
  });

  it('uses desktop-specific copy when launched from the desktop app', async () => {
    mockSearchParams = new URLSearchParams('code=abcd1234&client=desktop');

    render(<DeviceLoginContent />);

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Sign in to TaskForceAI Desktop' })
      ).toBeInTheDocument();
    });

    expect(screen.getByText('Click Sign in from the TaskForceAI desktop app.')).toBeInTheDocument();
    expect(
      screen.getByText('Authorize the code, then return to the desktop app.')
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Authorize desktop app' })).toBeInTheDocument();
    });
    expect(screen.queryByText(/return to the terminal/i)).not.toBeInTheDocument();
  });
});
