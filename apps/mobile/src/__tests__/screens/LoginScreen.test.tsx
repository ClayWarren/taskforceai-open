import { Alert, Linking } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { LoginScreen } from '../../screens/LoginScreen';

const makeJwtWithExp = (expSeconds: number): string => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds })).toString('base64url');
  return `${header}.${payload}.signature`;
};

const mockRefreshUser = jest.fn(async () => undefined);
const mockSetSession = jest.fn(async () => ({ ok: true }));
const mockSaveProfile = jest.fn(async () => ({ ok: true }));
const mockSignInWithGoogle = jest.fn(async () => ({
  idToken: 'google-id-token',
  accessToken: 'google-access-token',
  user: { email: 'fallback@example.com', name: 'Fallback User' },
}));
const mockSignInWithApple = jest.fn(async () => ({
  identityToken: 'apple-identity-token',
  authorizationCode: 'apple-code',
  email: 'apple@example.com',
  fullName: 'Apple User',
}));
const mockExchangeGoogleToken = jest.fn(async () => ({
  accessToken: 'server-access-token',
  user: {
    id: 'user-1',
    email: 'user@example.com',
    plan: 'pro',
  },
}));
const mockExchangeAppleToken = jest.fn(async () => ({
  accessToken: 'apple-server-token',
  user: {
    id: 'apple-user-1',
    email: 'apple@example.com',
    plan: 'free',
  },
}));
const mockIsAppleSignInAvailable = jest.fn(async () => false);
const mockVerifyAuthenticatorMFALogin = jest.fn(async () => ({
  access_token: 'mfa-server-token',
}));

let mockIsAuthenticated = false;

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    refreshUser: mockRefreshUser,
    isAuthenticated: mockIsAuthenticated,
  }),
}));

jest.mock('../../auth/token-exchange', () => ({
  exchangeGoogleToken: (...args: unknown[]) => mockExchangeGoogleToken(...args),
  exchangeAppleToken: (...args: unknown[]) => mockExchangeAppleToken(...args),
}));

jest.mock('../../utils/google-oauth', () => ({
  signInWithGoogle: (...args: unknown[]) => mockSignInWithGoogle(...args),
}));

jest.mock('../../utils/apple-oauth', () => ({
  isAppleSignInAvailable: () => mockIsAppleSignInAvailable(),
  signInWithApple: (...args: unknown[]) => mockSignInWithApple(...args),
}));

jest.mock('../../storage/sqlite-adapter', () => ({
  sqliteStorage: {
    setSession: (...args: unknown[]) => mockSetSession(...args),
    saveProfile: (...args: unknown[]) => mockSaveProfile(...args),
  },
}));

jest.mock('../../api/client', () => ({
  getMobileClient: () => ({
    verifyAuthenticatorMFALogin: (...args: unknown[]) =>
      mockVerifyAuthenticatorMFALogin(...args),
  }),
}));

jest.mock('../../logger', () => ({
  createModuleLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

jest.mock('../../utils/nativewind', () => ({
  styled: (component: unknown) => component,
}));

jest.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }: { children: React.ReactNode }) => {
    const react = require('react');
    const { View } = require('react-native');
    return react.createElement(View, null, children);
  },
}));

const mockAppleButtonProps = jest.fn();

jest.mock('expo-apple-authentication', () => ({
  AppleAuthenticationButton: (props: { onPress: () => void; pointerEvents?: string }) => {
    mockAppleButtonProps(props);
    const react = require('react');
    const { Text, TouchableOpacity } = require('react-native');
    return react.createElement(
      TouchableOpacity,
      { onPress: props.onPress, pointerEvents: props.pointerEvents, testID: 'login-apple-button' },
      react.createElement(Text, null, 'Continue with Apple')
    );
  },
  AppleAuthenticationButtonType: {
    SIGN_IN: 'SIGN_IN',
  },
  AppleAuthenticationButtonStyle: {
    BLACK: 'BLACK',
    WHITE: 'WHITE',
  },
}));

jest.mock('@taskforceai/contracts/auth/auth-service', () => ({
  buildUserState: ({ email, full_name, plan }: { email: string; full_name: string | null; plan: string }) => ({
    id: 'fallback-user',
    email,
    full_name,
    plan,
  }),
}));

describe('LoginScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAuthenticated = false;
    mockIsAppleSignInAvailable.mockResolvedValue(false);
  });

  it('calls onSuccess when user is already authenticated', async () => {
    mockIsAuthenticated = true;
    const onSuccess = jest.fn();

    render(<LoginScreen onSuccess={onSuccess} />);

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
  });

  it('renders Apple sign-in button when Apple auth is available', async () => {
    mockIsAppleSignInAvailable.mockResolvedValue(true);

    const { getByTestId } = render(<LoginScreen />);

    await waitFor(() => {
      expect(getByTestId('login-apple-button')).toBeTruthy();
    });
    expect(mockAppleButtonProps).toHaveBeenCalledWith(
      expect.objectContaining({
        buttonStyle: 'WHITE',
      })
    );
  });

  it('opens terms, privacy policy, and support links from the login screen', async () => {
    const { getByTestId } = render(<LoginScreen />);

    fireEvent.press(getByTestId('login-terms-link'));
    fireEvent.press(getByTestId('login-privacy-link'));
    fireEvent.press(getByTestId('login-support-link'));

    expect(Linking.openURL).toHaveBeenCalledWith('https://taskforceai.chat/terms');
    expect(Linking.openURL).toHaveBeenCalledWith('https://taskforceai.chat/privacy');
    expect(Linking.openURL).toHaveBeenCalledWith('mailto:support@taskforceai.chat');
  });

  it('lets users continue without creating an account', () => {
    const onContinueAsGuest = jest.fn();
    const { getByTestId, getByText } = render(
      <LoginScreen onContinueAsGuest={onContinueAsGuest} />
    );

    expect(getByText('Sign in to sync your work')).toBeTruthy();

    fireEvent.press(getByTestId('login-guest-button'));

    expect(onContinueAsGuest).toHaveBeenCalledTimes(1);
  });

  it('disables Apple sign-in while an auth request is loading', async () => {
    mockIsAppleSignInAvailable.mockResolvedValue(true);
    const { getByTestId } = render(<LoginScreen />);

    await waitFor(() => {
      expect(getByTestId('login-apple-button')).toBeTruthy();
    });

    mockSignInWithApple.mockImplementationOnce(
      () => new Promise(() => undefined) as never
    );
    fireEvent.press(getByTestId('login-apple-button'));

    await waitFor(() => {
      expect(getByTestId('login-apple-button').props.pointerEvents).toBe('none');
    });
  });

  it('completes Google sign-in and persists auth state', async () => {
    const { getByTestId } = render(<LoginScreen />);

    fireEvent.press(getByTestId('login-google-button'));

    await waitFor(() => {
      expect(mockExchangeGoogleToken).toHaveBeenCalledWith({
        idToken: 'google-id-token',
        accessToken: 'google-access-token',
      });
    });

    await waitFor(() => {
      expect(mockSetSession).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: 'server-access-token',
          expiresAt: expect.any(Number),
          user: {
            id: 'user-1',
            email: 'user@example.com',
            plan: 'pro',
          },
        })
      );
      expect(mockSaveProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'user-1',
          email: 'user@example.com',
          plan: 'pro',
        })
      );
      expect(mockRefreshUser).toHaveBeenCalledWith({ force: true });
    });
  });

  it('uses JWT exp claim for stored session expiry when available', async () => {
    const expSeconds = Math.floor(Date.now() / 1000) + 3600;
    mockExchangeGoogleToken.mockResolvedValueOnce({
      accessToken: makeJwtWithExp(expSeconds),
      user: {
        id: 'jwt-user',
        email: 'jwt@example.com',
        plan: 'pro',
      },
    });

    const { getByTestId } = render(<LoginScreen />);
    fireEvent.press(getByTestId('login-google-button'));

    await waitFor(() => {
      expect(mockSetSession).toHaveBeenCalled();
    });

    const sessionArg = mockSetSession.mock.calls[0]?.[0] as { expiresAt?: number } | undefined;
    expect(sessionArg?.expiresAt).toBe(expSeconds * 1000);
  });

  it('completes Google sign-in after an MFA challenge', async () => {
    mockExchangeGoogleToken.mockResolvedValueOnce({
      mfaRequired: true,
      mfaToken: 'mfa-token-123',
      user: {
        id: 'mfa-user',
        email: 'mfa@example.com',
        plan: 'pro',
      },
    });

    const { getByTestId } = render(<LoginScreen />);

    fireEvent.press(getByTestId('login-google-button'));

    await waitFor(() => {
      expect(getByTestId('login-mfa-code-input')).toBeTruthy();
    });

    fireEvent.changeText(getByTestId('login-mfa-code-input'), '123456');
    fireEvent.press(getByTestId('login-mfa-submit-button'));

    await waitFor(() => {
      expect(mockVerifyAuthenticatorMFALogin).toHaveBeenCalledWith(
        '123456',
        'mfa-token-123'
      );
    });
    expect(mockSetSession).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'mfa-server-token',
        user: {
          id: 'mfa-user',
          email: 'mfa@example.com',
          plan: 'pro',
        },
      })
    );
    expect(mockRefreshUser).toHaveBeenCalledWith({ force: true });
  });

  it('shows Google error alert when ID token is missing', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    mockSignInWithGoogle.mockResolvedValueOnce({
      idToken: '',
      accessToken: 'google-access-token',
      user: { email: 'fallback@example.com', name: 'Fallback User' },
    });

    const { getByTestId } = render(<LoginScreen />);

    fireEvent.press(getByTestId('login-google-button'));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Google Sign-In Failed',
        'Google Sign-In failed: missing ID token'
      );
    });
    expect(mockRefreshUser).not.toHaveBeenCalled();
  });

  it('does not alert when Google auth is cancelled', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    mockSignInWithGoogle.mockRejectedValueOnce(new Error('Authentication cancelled or failed'));

    const { getByTestId } = render(<LoginScreen />);

    fireEvent.press(getByTestId('login-google-button'));

    await waitFor(() => {
      expect(mockSignInWithGoogle).toHaveBeenCalledTimes(1);
    });
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
