import * as SecureStore from 'expo-secure-store';

import { desktopPairingSessionSchema } from './client';
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
  const parsed = desktopPairingSessionSchema.safeParse(value);
  if (!parsed.success) {
    return false;
  }
  return isSafeStoredSession(parsed.data);
};

const isSafeStoredSession = (session: DesktopPairingSession): boolean => {
  try {
    const baseUrl = new URL(session.baseUrl);
    const rpcUrl = new URL(session.rpcPath, 'http://desktop.local');
    return (
      (baseUrl.protocol === 'http:' || baseUrl.protocol === 'https:') &&
      session.rpcPath.startsWith('/') &&
      !session.rpcPath.startsWith('//') &&
      rpcUrl.origin === 'http://desktop.local' &&
      rpcUrl.hash === ''
    );
  } catch {
    return false;
  }
};
