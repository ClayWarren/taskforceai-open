import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, mock, vi } from 'bun:test';

import '../../../../../../tests/setup/dom';

let mockSearchParams = new URLSearchParams();
const mockGetSession = vi.fn();
const mockGetSignInUrl = vi.fn();
const mockAuthorizeDeviceLogin = vi.fn();
const assignSpy = vi.fn();

mock.module('../../../components/routing', () => ({
  useSearchParams: vi.fn(() => mockSearchParams),
}));

mock.module('@taskforceai/api-client/auth/auth-client', () => ({
  authClient: {
    getSession: mockGetSession,
    getSignInUrl: mockGetSignInUrl,
  },
}));

mock.module('../../../lib/auth/auth-actions', () => ({
  authorizeDeviceLogin: mockAuthorizeDeviceLogin,
}));

const { DeviceLoginContent } = await import('./page');

describe('DeviceLoginPage', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mockGetSession.mockReset();
    mockGetSignInUrl.mockReset();
    mockAuthorizeDeviceLogin.mockReset();
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

  it('keeps authorization disabled until a signed-in session is ready', async () => {
    mockSearchParams = new URLSearchParams('code=abcd1234');
    mockGetSession.mockResolvedValue(null);

    render(<DeviceLoginContent />);

    const submitButton = await screen.findByRole('button', { name: 'Sign in required' });

    expect(submitButton).toBeDisabled();
    fireEvent.click(submitButton);
    expect(mockAuthorizeDeviceLogin).not.toHaveBeenCalled();
  });

  it('authorizes the normalized device code and shows terminal success feedback', async () => {
    mockSearchParams = new URLSearchParams('code=ab cd-1234');
    mockAuthorizeDeviceLogin.mockResolvedValue({ status: 'success' });

    render(<DeviceLoginContent />);

    const submitButton = await screen.findByRole('button', { name: 'Authorize terminal' });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockAuthorizeDeviceLogin).toHaveBeenCalledWith('ABCD1234');
    });
    expect(
      await screen.findByText('Approved! You can return to the terminal window.')
    ).toBeInTheDocument();
  });

  it('uses desktop-specific authorization feedback for expired codes', async () => {
    mockSearchParams = new URLSearchParams('code=abcd1234&client=desktop');
    mockAuthorizeDeviceLogin.mockResolvedValue({ status: 'expired' });

    render(<DeviceLoginContent />);

    fireEvent.click(await screen.findByRole('button', { name: 'Authorize desktop app' }));

    expect(
      await screen.findByText(
        'That code expired. Return to the desktop app and start sign in again.'
      )
    ).toBeInTheDocument();
  });

  it('normalizes typed codes and clears authorization errors on edit', async () => {
    const user = userEvent.setup({ document: globalThis.document });
    mockSearchParams = new URLSearchParams('code=abcd1234');
    mockAuthorizeDeviceLogin.mockResolvedValue({ status: 'not_found' });

    render(<DeviceLoginContent />);

    fireEvent.click(await screen.findByRole('button', { name: 'Authorize terminal' }));
    expect(
      await screen.findByText('Code not found. Check the terminal and re-enter.')
    ).toBeInTheDocument();

    const input = screen.getByLabelText('Device code');
    await user.clear(input);
    await user.type(input, 'xyz98765');

    await waitFor(() => {
      expect(input).toHaveValue('XYZ9-8765');
    });
    expect(screen.queryByText('Code not found. Check the terminal and re-enter.')).toBeNull();
  });

  it('clears the submit throttle timer when unmounted', async () => {
    mockSearchParams = new URLSearchParams('code=abcd1234');
    mockAuthorizeDeviceLogin.mockResolvedValue({ status: 'success' });
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { unmount } = render(<DeviceLoginContent />);

    fireEvent.click(await screen.findByRole('button', { name: 'Authorize terminal' }));
    await waitFor(() => {
      expect(mockAuthorizeDeviceLogin).toHaveBeenCalled();
    });

    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});
