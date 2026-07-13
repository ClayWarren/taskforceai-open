import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeEach, describe, expect, it, mock } from 'bun:test';

import {
  loadStoredMobileMcpServers,
  persistMobileMcpServers,
  subscribeMobileMcpServers,
} from '../../mcp/store';

describe('mobile mcp store', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mock.restore();
  });

  it('loads normalized stored servers and recovers invalid stored data', async () => {
    await AsyncStorage.setItem(
      '@taskforceai:mcp-servers',
      JSON.stringify([
        { name: ' Docs ', endpoint: ' https://docs.example/mcp ', enabled: true },
        { name: '', endpoint: '', enabled: true },
      ])
    );

    await expect(loadStoredMobileMcpServers()).resolves.toEqual([
      { name: 'Docs', endpoint: 'https://docs.example/mcp', enabled: true },
    ]);

    await AsyncStorage.setItem('@taskforceai:mcp-servers', '{"bad":true}');

    await expect(loadStoredMobileMcpServers()).resolves.toEqual([]);
  });

  it('persists, removes, notifies, and unsubscribes listeners', async () => {
    const listener = mock(() => {});
    const unsubscribedListener = mock(() => {});
    const unsubscribe = subscribeMobileMcpServers(listener);
    const unsubscribeSecond = subscribeMobileMcpServers(unsubscribedListener);
    unsubscribeSecond();

    await expect(
      persistMobileMcpServers([
        { name: 'files', endpoint: 'https://files.example/mcp', enabled: false },
      ])
    ).resolves.toEqual([
      { name: 'files', endpoint: 'https://files.example/mcp', enabled: false },
    ]);
    await expect(AsyncStorage.getItem('@taskforceai:mcp-servers')).resolves.toBe(
      JSON.stringify([{ name: 'files', endpoint: 'https://files.example/mcp', enabled: false }])
    );
    expect(listener).toHaveBeenCalledTimes(1);
    expect(unsubscribedListener).not.toHaveBeenCalled();

    await expect(persistMobileMcpServers([])).resolves.toEqual([]);
    await expect(AsyncStorage.getItem('@taskforceai:mcp-servers')).resolves.toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    await persistMobileMcpServers([
      { name: 'docs', endpoint: 'https://docs.example/mcp', enabled: true },
    ]);

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('returns normalized servers when persistence fails', async () => {
    const originalSetItem = AsyncStorage.setItem;
    AsyncStorage.setItem = async () => {
      throw new Error('disk full');
    };

    try {
      await expect(
        persistMobileMcpServers([
          { name: ' Bad ', endpoint: ' https://bad.example/mcp ', enabled: true },
        ])
      ).resolves.toEqual([{ name: 'Bad', endpoint: 'https://bad.example/mcp', enabled: true }]);
    } finally {
      AsyncStorage.setItem = originalSetItem;
    }
  });
});
