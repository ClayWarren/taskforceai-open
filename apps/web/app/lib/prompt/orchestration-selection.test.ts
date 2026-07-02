import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { type Result, err, ok } from '@taskforceai/shared/result';
import type { StorageError } from '@taskforceai/shared/utils/browser-storage';

const mockReadStorageItem = mock<() => Result<string, StorageError>>(() =>
  err({ kind: 'missing', message: 'Storage key not found.' })
);
const mockWriteStorageItem = mock<() => Result<true, StorageError>>(() => ok(true));

mock.module('@taskforceai/shared/utils/browser-storage', () => ({
  readStorageItem: mockReadStorageItem,
  writeStorageItem: mockWriteStorageItem,
}));

import {
  ORCHESTRATION_STORAGE_KEY,
  persistOrchestrationConfig,
  readStoredOrchestrationConfig,
} from './orchestration-selection';

describe('orchestration-selection', () => {
  beforeEach(() => {
    mockReadStorageItem.mockClear();
    mockWriteStorageItem.mockClear();
    mockReadStorageItem.mockImplementation(() =>
      err({ kind: 'missing', message: 'Storage key not found.' })
    );
    mockWriteStorageItem.mockImplementation(() => ok(true));
  });

  it('reads a stored orchestration config from browser storage', () => {
    const config = {
      roleModels: {
        planner: 'gpt-5',
        engineer: 'claude-sonnet-4',
      },
      budget: 25,
      agentCount: 4,
    };
    mockReadStorageItem.mockReturnValue(ok(JSON.stringify(config)));

    expect(readStoredOrchestrationConfig()).toEqual(config);
    expect(mockReadStorageItem).toHaveBeenCalledWith(ORCHESTRATION_STORAGE_KEY);
  });

  it('returns null when storage is missing or unavailable', () => {
    mockReadStorageItem.mockReturnValue(
      err({ kind: 'unavailable', message: 'Local storage unavailable.' })
    );

    expect(readStoredOrchestrationConfig()).toBeNull();
    expect(mockReadStorageItem).toHaveBeenCalledWith(ORCHESTRATION_STORAGE_KEY);
  });

  it('returns null when the stored orchestration config is invalid', () => {
    mockReadStorageItem.mockReturnValue(ok(JSON.stringify({ roleModels: ['bad'] })));

    expect(readStoredOrchestrationConfig()).toBeNull();
  });

  it('persists orchestration config through browser storage', () => {
    const config = {
      roleModels: {
        researcher: 'gpt-5-mini',
      },
      agentCount: 2,
    };

    persistOrchestrationConfig(config);

    expect(mockWriteStorageItem).toHaveBeenCalledWith(
      ORCHESTRATION_STORAGE_KEY,
      JSON.stringify(config)
    );
  });
});
