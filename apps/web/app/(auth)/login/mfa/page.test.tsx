import '@testing-library/jest-dom';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../../tests/setup/dom';

const mockPush = vi.fn();
const mockVerifyAuthenticatorMFALogin = vi.fn();
const assignSpy = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock('../../../components/routing', () => ({
  useRouter: vi.fn(() => ({ push: mockPush })),
  useSearchParams: vi.fn(() => mockSearchParams),
}));

vi.mock('@taskforceai/contracts/browserClient', () => ({
  getBrowserClient: vi.fn(() => ({
    verifyAuthenticatorMFALogin: mockVerifyAuthenticatorMFALogin,
  })),
}));

import MFALoginPage from './page';

describe('MFALoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
    mockVerifyAuthenticatorMFALogin.mockResolvedValue({ redirect_url: '/chat' });
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        origin: 'https://app.example.com',
        assign: assignSpy,
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('keeps only digits in the authenticator code field', async () => {
    render(<MFALoginPage />);
    const user = userEvent.setup({ document: globalThis.document });
    const input = screen.getByLabelText('Authenticator code');

    await user.type(input, '12ab 34-56');

    expect(input).toHaveValue('123456');
  });

  it('validates short codes before calling the MFA endpoint', async () => {
    render(<MFALoginPage />);
    const user = userEvent.setup({ document: globalThis.document });

    await user.type(screen.getByLabelText('Authenticator code'), '123');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter the 6-digit code from your authenticator app.'
    );
    expect(mockVerifyAuthenticatorMFALogin).not.toHaveBeenCalled();
  });

  it('verifies the code with the MFA token and redirects to the safe response target', async () => {
    mockSearchParams = new URLSearchParams(
      'mfa_token=mfa-token-1&callbackUrl=%2Fprojects%3Ffrom%3Dmfa'
    );
    mockVerifyAuthenticatorMFALogin.mockResolvedValue({ redirect_url: '/chat?from=mfa' });
    render(<MFALoginPage />);
    const user = userEvent.setup({ document: globalThis.document });

    await user.type(screen.getByLabelText('Authenticator code'), '654321');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(mockVerifyAuthenticatorMFALogin).toHaveBeenCalledWith('654321', 'mfa-token-1');
    });
    expect(assignSpy).toHaveBeenCalledWith('/chat?from=mfa');
  });

  it('falls back to the callback URL when the MFA response has no redirect URL', async () => {
    mockSearchParams = new URLSearchParams('callbackUrl=%2Fprojects%3Fsource%3Dmfa');
    mockVerifyAuthenticatorMFALogin.mockResolvedValue({ redirect_url: null });
    render(<MFALoginPage />);
    const user = userEvent.setup({ document: globalThis.document });

    await user.type(screen.getByLabelText('Authenticator code'), '111222');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(assignSpy).toHaveBeenCalledWith('/projects?source=mfa');
    });
  });

  it('shows an error and re-enables submit when verification fails', async () => {
    mockVerifyAuthenticatorMFALogin.mockRejectedValue(new Error('expired'));
    render(<MFALoginPage />);
    const user = userEvent.setup({ document: globalThis.document });

    await user.type(screen.getByLabelText('Authenticator code'), '999000');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Invalid or expired authenticator code.'
    );
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  it('returns to sign in from the secondary action', () => {
    render(<MFALoginPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));

    expect(mockPush).toHaveBeenCalledWith('/login');
  });
});
