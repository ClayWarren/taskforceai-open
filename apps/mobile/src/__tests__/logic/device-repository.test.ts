import { beforeEach, describe, expect, it } from 'bun:test';

import AsyncStorage from '@react-native-async-storage/async-storage';

import { DeviceRepository } from '../../storage/repositories/DeviceRepository';

describe('DeviceRepository', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('generates and persists a crypto-backed mobile device id', async () => {
    const repository = new DeviceRepository();

    const generated = await repository.getDeviceId();

    expect(generated).toBe('mobile-mock-uuid-0000-0000-0000-000000000000');
    await expect(AsyncStorage.getItem('@taskforceai:device_id')).resolves.toBe(generated);
  });

  it('returns a persisted device id', async () => {
    const repository = new DeviceRepository();
    await AsyncStorage.setItem('@taskforceai:device_id', 'device-existing');

    await expect(repository.getDeviceId()).resolves.toBe('device-existing');
  });

  it('shares one generated id across concurrent reads', async () => {
    const repository = new DeviceRepository();
    const setItem = AsyncStorage.setItem as unknown as { mock: { calls: unknown[][] } };
    const callsBefore = setItem.mock.calls.length;

    const [first, second] = await Promise.all([
      repository.getDeviceId(),
      repository.getDeviceId(),
    ]);

    expect(second).toBe(first);
    expect(setItem.mock.calls.length - callsBefore).toBe(1);
  });

  it('persists an explicit device id', async () => {
    const repository = new DeviceRepository();

    await repository.setDeviceId('device-explicit');

    await expect(AsyncStorage.getItem('@taskforceai:device_id')).resolves.toBe(
      'device-explicit'
    );
  });
});
