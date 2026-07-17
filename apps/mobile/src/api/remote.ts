import { getMobileRemoteClient } from './client';
import { readOrCreateRemoteDeviceCredential } from '../features/desktop-work/pairing/remote-credential';

export type MobileRemoteTarget = Awaited<
  ReturnType<ReturnType<typeof getMobileRemoteClient>['listRemoteConnections']>
>[number];

export const listMobileRemoteConnections = async (
  controllerDeviceId: string
): Promise<MobileRemoteTarget[]> => {
  const deviceCredential = await readOrCreateRemoteDeviceCredential();
  return getMobileRemoteClient().listRemoteConnections({
    deviceId: controllerDeviceId,
    deviceCredential,
  });
};
