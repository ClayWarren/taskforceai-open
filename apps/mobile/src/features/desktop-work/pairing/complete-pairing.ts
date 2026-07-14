import * as Device from 'expo-device';

import { syncStoredPushTokenWithDesktop } from '../../../notifications/registration';
import { sqliteStorage } from '../../../storage/sqlite-adapter';
import {
  pairWithRemoteCode,
  pingDesktopAppServer,
  type DesktopPairingSession,
} from './client';
import { saveDesktopPairingSession } from './session-store';

export const normalizeRemotePairingCode = (value?: string | null): string => {
  const input = value?.trim() ?? '';
  if (!input) return '';
  try {
    const url = new URL(input);
    return url.searchParams.get('code')?.toUpperCase() ?? '';
  } catch {
    return /^[A-Z2-7]{4}-?[A-Z2-7]{4}$/i.test(input) ? input.toUpperCase() : '';
  }
};

export const completeRemotePairing = async (rawCode: string): Promise<DesktopPairingSession> => {
  const code = normalizeRemotePairingCode(rawCode);
  if (!code) throw new Error('Enter the eight-character pairing code shown on your Mac.');

  const controllerDeviceId = await sqliteStorage.getDeviceId();
  const session = await pairWithRemoteCode({
    code,
    controllerDeviceId,
    controllerName: Device.deviceName?.trim() || 'TaskForceAI Mobile',
  });
  // Pairing authorization has already succeeded at this point. Persist the
  // durable relay identity before probing the Mac so a transient relay timeout
  // cannot leave the desktop paired while the phone forgets the connection.
  await saveDesktopPairingSession(session, session.machineName);
  await pingDesktopAppServer(session);
  await syncStoredPushTokenWithDesktop();
  return session;
};
