import { parseJsonSchema } from '@taskforceai/shared/json/parse';
import { RNG, systemRNG } from '@taskforceai/shared/random/rng';
import { Clock, systemClock } from '@taskforceai/shared/time/clock';
import { z } from 'zod';

import {
  readStorageItem,
  removeStorageItem,
  writeStorageItem,
} from '@taskforceai/shared/utils/browser-storage';
import { readPlatformLabel } from '@taskforceai/contracts/services/client-metadata';

const SYNC_METADATA_KEY = 'sync_metadata';
const DEVICE_ID_KEY = 'device_id';
const syncMetadataSchema = z.object({
  lastSyncVersion: z.number(),
  lastSyncedAt: z.number().optional(),
});

function generateDeviceId(rng: RNG, clock: Clock): string {
  const random = rng.random().toString(36).substring(2, 15);
  // Using 36 radix for timestamp to be compatible with previous implementation
  const timestamp = clock.now().toString(36);
  const platformResult = readPlatformLabel();
  const platform = platformResult.ok ? platformResult.value : 'unknown';
  return `${platform}-${timestamp}-${random}`;
}

export async function getLastSyncVersionFromStorage(): Promise<number> {
  const metadataResult = readStorageItem(SYNC_METADATA_KEY);
  if (!metadataResult.ok) {
    return 0;
  }
  const parsed = parseJsonSchema(metadataResult.value, syncMetadataSchema);
  return parsed.ok ? parsed.value.lastSyncVersion : 0;
}

export async function setLastSyncVersionInStorage(
  version: number,
  clock: Clock = systemClock
): Promise<void> {
  const metadata = { lastSyncVersion: version, lastSyncedAt: clock.now() };
  const writeResult = writeStorageItem(SYNC_METADATA_KEY, JSON.stringify(metadata));
  if (!writeResult.ok) {
    throw new Error(`Failed to save sync metadata: ${writeResult.error.message}`);
  }
}

export async function getOrCreateDeviceId(
  rng: RNG = systemRNG,
  clock: Clock = systemClock
): Promise<string> {
  const deviceResult = readStorageItem(DEVICE_ID_KEY);
  if (deviceResult.ok) {
    const existing = deviceResult.value.trim();
    if (existing !== '') {
      return existing;
    }
  }
  const deviceId = generateDeviceId(rng, clock);
  const writeResult = writeStorageItem(DEVICE_ID_KEY, deviceId);
  if (!writeResult.ok) {
    return deviceId;
  }
  return deviceId;
}

export async function setDeviceIdInStorage(deviceId: string): Promise<void> {
  const writeResult = writeStorageItem(DEVICE_ID_KEY, deviceId);
  if (!writeResult.ok) {
    throw new Error(`Failed to save device ID: ${writeResult.error.message}`);
  }
}

export async function clearSyncMetadata(): Promise<void> {
  const removeResult = removeStorageItem(SYNC_METADATA_KEY);
  if (!removeResult.ok) {
    throw new Error(`Failed to clear sync metadata: ${removeResult.error.message}`);
  }
}
