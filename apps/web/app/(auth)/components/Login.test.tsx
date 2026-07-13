import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../tests/setup/dom';

const mockReplace = vi.fn();
const mockPush = vi.fn();
const mockRefreshUser = vi.fn();
const mockGetSignInUrl = vi.fn();
let mockSearchParams = new URLSearchParams();
let mockAuthState: { isAuthenticated: boolean; sessionStatus: string } = {
  isAuthenticated: false,
  sessionStatus: 'unauthenticated',
};

vi.mock('../../components/routing', () => ({
  useRouter: vi.fn(() => ({
    push: mockPush,
    replace: mockReplace,
  })),
  useSearchParams: vi.fn(() => mockSearchParams),
}));

vi.mock('@taskforceai/api-client/auth/auth-client', () => ({
  authClient: {
    getSignInUrl: mockGetSignInUrl,
  },
}));

vi.mock('../../lib/providers/AuthProvider', () => ({
  useAuth: vi.fn(() => ({
    ...mockAuthState,
    refreshUser: mockRefreshUser,
  })),
}));

import Login from './Login';

describe('Login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (import.meta.env as Record<string, string | undefined>)['VITE_ENABLE_TEST_LOGIN'] = undefined;
    mockSearchParams = new URLSearchParams();
    mockAuthState = {
      isAuthenticated: false,
      sessionStatus: 'unauthenticated',
    };
    mockGetSignInUrl.mockReturnValue('/api/v1/auth/login?callbackUrl=%2F');
    mockRefreshUser.mockResolvedValue(undefined);
    window.history.replaceState({}, '', '/login');
  });

  it('starts auth sign-in with internal callback and plan when unauthenticated', async () => {
    mockSearchParams = new URLSearchParams('callbackUrl=%2Fchat%3Fsource%3Dlogin&plan=pro');

    render(<Login />);

    await waitFor(() => {
      expect(mockGetSignInUrl).toHaveBeenCalledWith({
        callbackUrl: '/chat?source=login&plan=pro',
      });
    });

    expect(screen.getByText('Redirecting to secure login...')).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('redirects authenticated users to resolved callback target', async () => {
    mockSearchParams = new URLSearchParams('callbackUrl=%2Fchat%3Ffrom%3Dauth&plan=super');
    mockAuthState = {
      isAuthenticated: true,
      sessionStatus: 'authenticated',
    };

    render(<Login />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/chat?from=auth&plan=super');
    });

    expect(mockGetSignInUrl).not.toHaveBeenCalled();
  });

  it('shows URL error and retries sign-in when user clicks Try Again', async () => {
    mockSearchParams = new URLSearchParams('error=OAuthSignin&callbackUrl=%2Fdashboard');

    render(<Login />);

    expect(await screen.findByText('OAuth sign-in failed. Please try again.')).toBeInTheDocument();
    expect(mockGetSignInUrl).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));

    await waitFor(() => {
      expect(mockGetSignInUrl).toHaveBeenCalledWith({
        callbackUrl: '/dashboard',
      });
    });
  });

  it('uses local dev sign-in when enabled', async () => {
    (import.meta.env as Record<string, unknown>)['DEV'] = true;
    (import.meta.env as Record<string, string>)['VITE_ENABLE_TEST_LOGIN'] = 'true';
    mockSearchParams = new URLSearchParams('callbackUrl=%2Fchat');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ ok: true }),
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      render(<Login />);

      expect(screen.getByRole('button', { name: 'Continue locally' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Continue locally' }));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/test-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email: 'local-dev@taskforceai.test' }),
        });
      });
      expect(mockRefreshUser).toHaveBeenCalledWith({ force: true });
      expect(mockReplace).toHaveBeenCalledWith('/chat');
      expect(mockGetSignInUrl).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
