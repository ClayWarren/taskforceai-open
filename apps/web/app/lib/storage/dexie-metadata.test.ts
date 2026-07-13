import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';

import { type Result, err, ok } from '@taskforceai/client-core/result';
import * as browserStorage from '@taskforceai/browser-runtime/browser-storage';
import type { StorageError } from '@taskforceai/browser-runtime/browser-storage';
import {
  clearSyncMetadata,
  getLastSyncVersionFromStorage,
  getOrCreateDeviceId,
  setDeviceIdInStorage,
  setLastSyncVersionInStorage,
} from './dexie-metadata';

const readStorageItemMock = mock<(key: string) => Result<string, StorageError>>((key: string) => {
  const value = localStorage.getItem(key);
  return value === null ? err({ kind: 'missing', message: 'Storage key not found.' }) : ok(value);
});
const writeStorageItemMock = mock<(key: string, value: string) => Result<true, StorageError>>(
  (key: string, value: string) => {
    localStorage.setItem(key, value);
    return ok(true);
  }
);
const removeStorageItemMock = mock<(key: string) => Result<true, StorageError>>((key: string) => {
  localStorage.removeItem(key);
  return ok(true);
});

mock.module('@taskforceai/browser-runtime/browser-storage', () => ({
  readStorageItem: readStorageItemMock,
  writeStorageItem: writeStorageItemMock,
  removeStorageItem: removeStorageItemMock,
}));

describe('dexie-metadata', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    readStorageItemMock.mockImplementation((key: string) => {
      const value = localStorage.getItem(key);
      return value === null
        ? err({ kind: 'missing', message: 'Storage key not found.' })
        : ok(value);
    });
    writeStorageItemMock.mockImplementation((key: string, value: string) => {
      localStorage.setItem(key, value);
      return ok(true);
    });
    removeStorageItemMock.mockImplementation((key: string) => {
      localStorage.removeItem(key);
      return ok(true);
    });
    // Reset globalThis.navigator if needed
    Object.defineProperty(globalThis, 'navigator', {
      value: { platform: 'MacIntel' },
      writable: true,
      configurable: true,
    });
  });

  describe('Sync Version', () => {
    it('returns 0 if no metadata in storage', async () => {
      expect(await getLastSyncVersionFromStorage()).toBe(0);
    });

    it('returns 0 if metadata is invalid JSON', async () => {
      localStorage.setItem('sync_metadata', '{ invalid }');
      expect(await getLastSyncVersionFromStorage()).toBe(0);
    });

    it('returns version from storage', async () => {
      localStorage.setItem('sync_metadata', JSON.stringify({ lastSyncVersion: 42 }));
      expect(await getLastSyncVersionFromStorage()).toBe(42);
    });

    it('sets version in storage', async () => {
      await setLastSyncVersionInStorage(10);
      const stored = JSON.parse(localStorage.getItem('sync_metadata')!);
      expect(stored.lastSyncVersion).toBe(10);
      expect(stored.lastSyncedAt).toBeDefined();
    });

    it('throws error if write fails', async () => {
      vi.spyOn(browserStorage, 'writeStorageItem').mockReturnValue({
        ok: false,
        error: new Error('QuotaExceededError') as any,
      });
      await expect(setLastSyncVersionInStorage(10)).rejects.toThrow(/Failed to save sync metadata/);
    });

    it('clears sync metadata', async () => {
      localStorage.setItem('sync_metadata', 'some data');
      await clearSyncMetadata();
      expect(localStorage.getItem('sync_metadata')).toBeNull();
    });
  });

  describe('Device ID', () => {
    it('creates and returns new device id if not exists', async () => {
      const id = await getOrCreateDeviceId();
      expect(id).toContain('MacIntel-');
      expect(localStorage.getItem('device_id')).toBe(id);
    });

    it('returns existing device id if exists', async () => {
      localStorage.setItem('device_id', 'existing-123');
      const id = await getOrCreateDeviceId();
      expect(id).toBe('existing-123');
    });

    it('regenerates device id when stored value is blank', async () => {
      localStorage.setItem('device_id', '   ');
      const id = await getOrCreateDeviceId();
      expect(id).toContain('MacIntel-');
      expect(localStorage.getItem('device_id')).toBe(id);
    });

    it('sets device id in storage', async () => {
      await setDeviceIdInStorage('manually-set');
      expect(localStorage.getItem('device_id')).toBe('manually-set');
    });

    it('throws when writing device id fails', async () => {
      vi.spyOn(browserStorage, 'writeStorageItem').mockReturnValue({
        ok: false,
        error: new Error('QuotaExceededError') as any,
      });

      await expect(setDeviceIdInStorage('manually-set')).rejects.toThrow(
        /Failed to save device ID/
      );
    });
  });

  describe('Sync metadata cleanup', () => {
    it('clearSyncMetadata removes the item', async () => {
      localStorage.setItem('sync_metadata', 'test');
      await clearSyncMetadata();
      expect(localStorage.getItem('sync_metadata')).toBeNull();
    });

    it('throws when removing sync metadata fails', async () => {
      vi.spyOn(browserStorage, 'removeStorageItem').mockReturnValue({
        ok: false,
        error: new Error('Blocked') as any,
      });

      await expect(clearSyncMetadata()).rejects.toThrow(/Failed to clear sync metadata/);
    });
  });
});
