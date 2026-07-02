/**
 * Device Repository - Handles device-specific operations
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import type { IDeviceStore } from '../storage-adapter';
import { withRepoError } from '../utils';

const DEVICE_ID_KEY = '@taskforceai:device_id';

function generateMobileDeviceId(): string {
  return `mobile-${Crypto.randomUUID()}`;
}

export class DeviceRepository implements IDeviceStore {
  async getDeviceId(): Promise<string> {
    return withRepoError('[DeviceRepository] get device ID', async () => {
      let deviceId = await AsyncStorage.getItem(DEVICE_ID_KEY);
      if (!deviceId) {
        deviceId = generateMobileDeviceId();
        await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
      }
      return deviceId;
    });
  }

  async setDeviceId(deviceId: string): Promise<void> {
    return withRepoError(
      '[DeviceRepository] set device ID',
      async () => {
        await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
      },
      { deviceId }
    );
  }
}
