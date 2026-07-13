import * as Device from 'expo-device';

import { syncStoredPushTokenWithDesktop } from '../notifications/registration';
import { sqliteStorage } from '../storage/sqlite-adapter';
import { pairWithRemoteCode, type DesktopPairingSession } from './client';
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
  await saveDesktopPairingSession(session, session.machineName);
  await syncStoredPushTokenWithDesktop();
  return session;
};
