import * as SecureStore from 'expo-secure-store';

import type { DesktopPairingSession } from './client';

const DESKTOP_PAIRING_SESSION_KEY = 'taskforceai_desktop_pairing_session';

export const readDesktopPairingSession = async (): Promise<DesktopPairingSession | null> => {
  const value = await SecureStore.getItemAsync(DESKTOP_PAIRING_SESSION_KEY);
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (isDesktopPairingSession(parsed)) {
      return parsed;
    }
  } catch {
    // Bad local state is recoverable; clear it and let the user pair again.
  }
  await clearDesktopPairingSession();
  return null;
};

export const saveDesktopPairingSession = (session: DesktopPairingSession): Promise<void> =>
  SecureStore.setItemAsync(DESKTOP_PAIRING_SESSION_KEY, JSON.stringify(session));

export const clearDesktopPairingSession = (): Promise<void> =>
  SecureStore.deleteItemAsync(DESKTOP_PAIRING_SESSION_KEY);

const isDesktopPairingSession = (value: unknown): value is DesktopPairingSession => {
  if (!isRecord(value) || !isRecord(value.transport)) {
    return false;
  }
  return (
    typeof value.baseUrl === 'string' &&
    typeof value.rpcPath === 'string' &&
    typeof value.sessionToken === 'string' &&
    typeof value.transport.kind === 'string' &&
    typeof value.transport.encoding === 'string'
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
