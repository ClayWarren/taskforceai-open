import { describe, expect, it, mock } from 'bun:test';

import {
  configureDesktopApi,
  type DesktopApi,
  getDesktopAppServerAuthStatus,
  waitForTauriBridge,
} from './desktop-api';

describe('desktop-api', () => {
  it('safely reports an unavailable bridge and delegates after desktop configuration', async () => {
    expect(() => getDesktopAppServerAuthStatus()).toThrow(
      'Desktop capabilities are unavailable in the web application.'
    );
    await expect(waitForTauriBridge(500)).resolves.toBe(false);

    const waitForBridge = mock(async () => true);
    configureDesktopApi({ waitForBridge } as unknown as DesktopApi);

    await expect(waitForTauriBridge(250)).resolves.toBe(true);
    expect(waitForBridge).toHaveBeenCalledWith(250);
  });
});
