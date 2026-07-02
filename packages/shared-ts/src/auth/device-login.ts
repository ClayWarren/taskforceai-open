export type DeviceAuthorizeResponse =
  | { status: 'success' }
  | { status: 'unauthorized' }
  | { status: 'expired' }
  | { status: 'not_found' }
  | { status: 'error'; message: string };

export type DeviceLoginUiState = {
  status: 'idle' | 'loading' | 'success' | 'error';
  message: string;
  sessionReady?: boolean;
};

export type DeviceLoginClient = 'terminal' | 'desktop';

export const normalizeDeviceLoginCode = (input: string): string =>
  input
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 8)
    .toUpperCase()
    .replace(/(.{4})/g, '$1-')
    .replace(/-$/, '');

export const stripDeviceLoginCode = (input: string): string =>
  input.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

export const mapAuthorizeDeviceResponse = (
  result: DeviceAuthorizeResponse,
  client: DeviceLoginClient = 'terminal'
): DeviceLoginUiState => {
  const clientName = client === 'desktop' ? 'desktop app' : 'terminal window';
  const codeSource = client === 'desktop' ? 'the desktop app' : 'the terminal';
  if (result.status === 'unauthorized') {
    return {
      status: 'error',
      message: 'Please sign in first, then try again.',
      sessionReady: false,
    };
  }
  if (result.status === 'success') {
    return {
      status: 'success',
      message: `Approved! You can return to the ${clientName}.`,
    };
  }
  if (result.status === 'expired') {
    return {
      status: 'error',
      message:
        client === 'desktop'
          ? 'That code expired. Return to the desktop app and start sign in again.'
          : 'That code expired. Run /login in the terminal to generate a new one.',
    };
  }
  if (result.status === 'not_found') {
    return {
      status: 'error',
      message: `Code not found. Check ${codeSource} and re-enter.`,
    };
  }
  return {
    status: 'error',
    message: result.message,
  };
};

export const isDeviceLoginSubmitDisabled = ({
  status,
  isThrottled,
  isSessionChecking,
  isSessionReady,
  normalizedCodeLength,
}: {
  status: DeviceLoginUiState['status'];
  isThrottled: boolean;
  isSessionChecking: boolean;
  isSessionReady: boolean;
  normalizedCodeLength: number;
}): boolean => {
  if (status === 'loading' || isThrottled || isSessionChecking || !isSessionReady) {
    return true;
  }
  return normalizedCodeLength < 8;
};

export const deviceLoginSubmitLabel = ({
  isSessionChecking,
  isSessionReady,
  status,
  client = 'terminal',
}: {
  isSessionChecking: boolean;
  isSessionReady: boolean;
  status: DeviceLoginUiState['status'];
  client?: DeviceLoginClient;
}): string => {
  if (isSessionChecking) {
    return 'Checking sign-in…';
  }
  if (!isSessionReady) {
    return 'Sign in required';
  }
  if (status === 'loading') {
    return 'Authorizing…';
  }
  return client === 'desktop' ? 'Authorize desktop app' : 'Authorize terminal';
};
