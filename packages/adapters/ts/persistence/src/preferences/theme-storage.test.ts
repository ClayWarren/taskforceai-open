import { describe, expect, it, mock } from 'bun:test';

import {
  readStoredThemeModeValue,
  readStoredThemePreferenceResult,
  storeThemeModeValue,
} from './theme-storage';
import { err, ok } from '@taskforceai/client-core/result';

describe('theme storage helpers', () => {
  it('parses allowed theme modes only', () => {
    expect(readStoredThemePreferenceResult(() => ok('dark'))).toEqual({
      ok: true,
      value: 'dark',
    });
    expect(readStoredThemePreferenceResult(() => ok('system'))).toEqual({
      ok: true,
      value: 'system',
    });
    expect(readStoredThemePreferenceResult(() => ok('purple'))).toEqual({
      ok: false,
      error: { kind: 'invalid', message: 'No stored theme preference.' },
    });
  });

  it('reads stored modes through sync or async adapters', async () => {
    await expect(
      readStoredThemeModeValue({
        read: () => null,
      })
    ).resolves.toBeNull();

    await expect(
      readStoredThemeModeValue({
        read: () => 'light',
      })
    ).resolves.toBe('light');

    await expect(
      readStoredThemeModeValue({
        read: async () => 'dark',
      })
    ).resolves.toBe('dark');
  });

  it('returns null and reports read failures', async () => {
    const error = new Error('read failed');
    const onReadError = mock(() => undefined);

    await expect(
      readStoredThemeModeValue(
        {
          read: async () => {
            throw error;
          },
        },
        { onReadError }
      )
    ).resolves.toBeNull();

    expect(onReadError).toHaveBeenCalledWith(error);
  });

  it('stores modes through adapters', async () => {
    const write = mock(() => undefined);

    await storeThemeModeValue({ write }, 'dark');

    expect(write).toHaveBeenCalledWith('dark');
  });

  it('reports write failures', async () => {
    const writeError = new Error('write failed');
    const onWriteError = mock(() => undefined);

    await storeThemeModeValue(
      {
        write: async () => {
          throw writeError;
        },
      },
      'light',
      { onWriteError }
    );

    expect(onWriteError).toHaveBeenCalledWith(writeError, 'light');
  });

  it('reads result-style theme preferences', () => {
    expect(readStoredThemePreferenceResult(() => ok('system'))).toEqual({
      ok: true,
      value: 'system',
    });
    expect(readStoredThemePreferenceResult(() => ok('purple'))).toEqual({
      ok: false,
      error: { kind: 'invalid', message: 'No stored theme preference.' },
    });
    expect(readStoredThemePreferenceResult(() => err({ kind: 'missing' }))).toEqual({
      ok: false,
      error: { kind: 'failed', message: 'Failed to read theme preference.' },
    });
  });
});
