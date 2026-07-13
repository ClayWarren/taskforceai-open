import { describe, expect, it, mock, beforeEach } from 'bun:test';

const storageState = new Map<string, string>();
let shouldThrowOnSet = false;
let shouldThrowOnGet = false;

mock.module('@react-native-async-storage/async-storage', () => ({
  default: {
    setItem: mock(async (key: string, value: string) => {
      if (shouldThrowOnSet) throw new Error('set failure');
      storageState.set(key, value);
    }),
    getItem: mock(async (key: string) => {
      if (shouldThrowOnGet) throw new Error('get failure');
      return storageState.get(key) ?? null;
    }),
    removeItem: mock(async (key: string) => {
      storageState.delete(key);
    }),
  },
}));

import { storeThemeMode, loadThemeMode } from '../../utils/theme-storage';

describe('Theme storage', () => {
  beforeEach(() => {
    storageState.clear();
    shouldThrowOnSet = false;
    shouldThrowOnGet = false;
  });

  it('persists and loads modes', async () => {
    await storeThemeMode('dark');
    expect(storageState.get('@taskforceai:theme_mode')).toBe('dark');
    
    const mode = await loadThemeMode();
    expect(mode).toBe('dark');
  });

  it('handles errors gracefully', async () => {
    shouldThrowOnGet = true;
    const mode = await loadThemeMode();
    expect(mode).toBeNull(); // Should fall back to null on error
  });

});
