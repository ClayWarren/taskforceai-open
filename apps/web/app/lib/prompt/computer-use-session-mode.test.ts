import { beforeEach, describe, expect, it, mock } from 'bun:test';

import '../../../../../tests/setup/dom';

type StorageReadResult =
  | { ok: false; error: { kind: string; message: string } }
  | { ok: true; value: string };

const mockReadStorageItem = mock(
  (): StorageReadResult => ({
    ok: false,
    error: { kind: 'missing', message: 'missing' },
  })
);
const mockWriteStorageItem = mock(() => undefined);

mock.module('@taskforceai/browser-runtime/browser-storage', () => ({
  readStorageItem: mockReadStorageItem,
  writeStorageItem: mockWriteStorageItem,
}));

const loadModule = async () => import('./computer-use-session-mode');

describe('computer-use-session-mode', () => {
  beforeEach(() => {
    mockReadStorageItem.mockReset();
    mockWriteStorageItem.mockReset();
    mockReadStorageItem.mockReturnValue({
      ok: false,
      error: { kind: 'missing', message: 'missing' },
    });
  });

  it('falls back to logged out when storage is missing or invalid', async () => {
    const { readStoredComputerUseSessionMode } = await loadModule();

    expect(readStoredComputerUseSessionMode()).toBe('logged_out');

    mockReadStorageItem.mockReturnValue({ ok: true, value: 'invalid' });
    expect(readStoredComputerUseSessionMode()).toBe('logged_out');
  });

  it('reads valid stored modes and emits updates when persisted', async () => {
    const {
      COMPUTER_USE_SESSION_MODE_EVENT,
      COMPUTER_USE_SESSION_MODE_STORAGE_KEY,
      persistComputerUseSessionMode,
      readStoredComputerUseSessionMode,
    } = await loadModule();
    const listener = mock((event: CustomEvent<{ mode: string }>) => event.detail.mode);
    window.addEventListener(COMPUTER_USE_SESSION_MODE_EVENT, listener as unknown as EventListener);

    try {
      mockReadStorageItem.mockReturnValue({ ok: true, value: 'logged_in' });
      expect(readStoredComputerUseSessionMode()).toBe('logged_in');

      persistComputerUseSessionMode('logged_in');

      expect(mockWriteStorageItem).toHaveBeenCalledWith(
        COMPUTER_USE_SESSION_MODE_STORAGE_KEY,
        'logged_in'
      );
      expect(listener).toHaveBeenCalled();
      expect(listener.mock.results[0]?.value).toBe('logged_in');
    } finally {
      window.removeEventListener(
        COMPUTER_USE_SESSION_MODE_EVENT,
        listener as unknown as EventListener
      );
    }
  });
});
