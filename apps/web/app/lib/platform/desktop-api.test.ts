import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';
import type { SyncClient } from '@taskforceai/sync-client';

import '../../../../../tests/setup/dom';

let csrfToken = '';
let storedToken: { ok: boolean; value?: string } = { ok: false };

vi.mock('@taskforceai/api-client/auth/csrf', () => ({
  getCsrfToken: async () => csrfToken,
}));
vi.mock('@taskforceai/api-client/auth/auth-storage', () => ({
  getStoredToken: () => storedToken,
}));

import {
  callDesktopMcpTool,
  captureDesktopWorkspaceCheckpoint,
  configureDesktopApi,
  createDesktopSyncClient,
  createVoiceGatewayRequestOptions,
  type DesktopApi,
  dispatchDesktopAppServerAuthChanged,
  getDesktopAppServerAuthStatus,
  invokeTauri,
  restoreDesktopWorkspaceCheckpoint,
  waitForTauriBridge,
} from './desktop-api';

describe('desktop-api', () => {
  beforeEach(() => {
    configureDesktopApi(null);
  });

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

  it('delegates typed desktop operations through the configured bridge', async () => {
    const syncClient = {} as SyncClient;
    const createSyncClient = mock(() => syncClient);
    const invoke = mock(async (_command: string, _args?: Record<string, unknown>, parse?: any) =>
      parse ? parse({ value: 7 }) : { value: 7 }
    );
    const callMcpTool = mock(async () => ({ content: 'ok' }));
    const checkpointResult = {
      supported: true,
      conversationId: 'conversation-1',
      capturedAt: 42,
      workspace: '/workspace',
      message: 'Workspace checkpoint saved.',
    };
    const captureWorkspaceCheckpoint = mock(async () => checkpointResult);
    const restoreWorkspaceCheckpoint = mock(async () => checkpointResult);
    const createVoiceOptions = mock(async () => ({ headers: new Headers({ desktop: 'true' }) }));
    configureDesktopApi({
      createSyncClient,
      invoke,
      callMcpTool,
      captureWorkspaceCheckpoint,
      restoreWorkspaceCheckpoint,
      createVoiceGatewayRequestOptions: createVoiceOptions,
    } as unknown as DesktopApi);

    const getToken = () => 'token';
    expect(createDesktopSyncClient('https://sync.test', getToken)).toBe(syncClient);
    expect(createSyncClient).toHaveBeenCalledWith('https://sync.test', getToken, {});
    await expect(
      invokeTauri('status', { verbose: true }, (value: any) => value.value)
    ).resolves.toBe(7);
    await expect(
      callDesktopMcpTool({ name: 'tools', endpoint: 'https://mcp.test', enabled: true }, 'search')
    ).resolves.toEqual({ content: 'ok' });
    await expect(
      captureDesktopWorkspaceCheckpoint({ conversationId: 'conversation-1' })
    ).resolves.toEqual(checkpointResult);
    await expect(
      restoreDesktopWorkspaceCheckpoint({ conversationId: 'conversation-1', beforeTimestamp: 42 })
    ).resolves.toEqual(checkpointResult);
    expect((await createVoiceGatewayRequestOptions('desktop')).headers).toBeInstanceOf(Headers);
  });

  it('builds browser voice headers from CSRF and bearer credentials', async () => {
    csrfToken = '';
    storedToken = { ok: false };
    await expect(createVoiceGatewayRequestOptions('browser')).resolves.toEqual({});

    csrfToken = 'csrf-token';
    storedToken = { ok: true, value: 'access-token' };
    const options = await createVoiceGatewayRequestOptions('browser');
    const headers = new Headers(options.headers);
    expect(headers.get('X-CSRF-Token')).toBe('csrf-token');
    expect(headers.get('authorization')).toBe('Bearer access-token');
  });

  it('dispatches desktop auth changes only when a browser window exists', () => {
    const dispatchEvent = vi.spyOn(window, 'dispatchEvent');
    dispatchDesktopAppServerAuthChanged();
    expect(dispatchEvent).toHaveBeenCalledWith(expect.any(Event));
  });
});
