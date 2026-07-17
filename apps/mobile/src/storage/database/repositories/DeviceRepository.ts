/**
 * Device Repository - Handles device-specific operations
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

/** Device persistence owned by the mobile database package. */
import type { IDeviceStore } from '../storage-adapter';
import { withRepoError } from '../utils';

const DEVICE_ID_KEY = '@taskforceai:device_id';

function generateMobileDeviceId(): string {
  return `mobile-${Crypto.randomUUID()}`;
}

export class DeviceRepository implements IDeviceStore {
  private pendingDeviceId: Promise<string> | null = null;

  async getDeviceId(): Promise<string> {
    if (!this.pendingDeviceId) {
      this.pendingDeviceId = withRepoError('[DeviceRepository] get device ID', async () => {
        let deviceId = await AsyncStorage.getItem(DEVICE_ID_KEY);
        if (!deviceId) {
          deviceId = generateMobileDeviceId();
          await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
        }
        return deviceId;
      });
    }

    const pendingDeviceId = this.pendingDeviceId;
    try {
      return await pendingDeviceId;
    } finally {
      if (this.pendingDeviceId === pendingDeviceId) {
        this.pendingDeviceId = null;
      }
    }
  }

  async setDeviceId(deviceId: string): Promise<void> {
    if (this.pendingDeviceId) {
      await this.pendingDeviceId;
    }
    return withRepoError(
      '[DeviceRepository] set device ID',
      async () => {
        await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
      },
      { deviceId }
    );
  }
}
