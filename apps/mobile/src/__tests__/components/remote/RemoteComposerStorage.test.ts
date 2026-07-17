import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';

const mockEncryptedMetadata = new Map<string, string>();
let mockEncryptedReadError: Error | null = null;
let mockEncryptedWriteError: Error | null = null;

jest.mock('../../../storage/database-manager', () => ({
  dbManager: {
    ensureRawDb: async () => ({
      getFirstAsync: async (_sql: string, params: unknown[]) => {
        if (mockEncryptedReadError) throw mockEncryptedReadError;
        const key = String(params[0]);
        const value = mockEncryptedMetadata.get(key);
        return value === undefined ? null : { key, value };
      },
      runAsync: async (sql: string, params?: unknown[]) => {
        if (mockEncryptedWriteError) throw mockEncryptedWriteError;
        if (sql.startsWith('INSERT')) {
          mockEncryptedMetadata.set(String(params?.[0]), String(params?.[1]));
        } else if (sql.startsWith('DELETE')) {
          mockEncryptedMetadata.delete(String(params?.[0]));
        }
      },
    }),
  },
}));

import {
  enqueueRemoteThreadCreation,
  enqueueRemoteTurn,
  readRemoteDraft,
  readRemoteThreadCreationOutbox,
  readRemoteTurnOutbox,
  remoteTurnInput,
  removeRemoteDraft,
  removeRemoteThreadCreation,
  removeRemoteTurn,
  useRemoteComposerDraft,
  writeRemoteDraft,
  type RemoteThreadCreationOutboxItem,
  type RemoteTurnOutboxItem,
} from '../../../features/desktop-work/remote-composer-storage';

describe('Remote composer persistence', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockEncryptedMetadata.clear();
    mockEncryptedReadError = null;
    mockEncryptedWriteError = null;
  });

  it('restores per-composer drafts and defaults safely', async () => {
    await expect(readRemoteDraft('thread:new')).resolves.toEqual({
      input: '',
      planMode: false,
      permissionProfile: 'full_access',
    });

    await writeRemoteDraft('thread:one', {
      input: 'Review the mobile diff',
      planMode: true,
      permissionProfile: 'workspace_write',
    });

    await expect(readRemoteDraft('thread:one')).resolves.toEqual({
      input: 'Review the mobile diff',
      planMode: true,
      permissionProfile: 'workspace_write',
    });
    await expect(
      AsyncStorage.getItem('@taskforceai:remote-composer:v1')
    ).resolves.toBeNull();
    expect(mockEncryptedMetadata.get('remote-composer:v2')).toContain('Review the mobile diff');
  });

  it('migrates legacy plaintext state and removes it after encrypted persistence', async () => {
    await AsyncStorage.setItem(
      '@taskforceai:remote-composer:v1',
      JSON.stringify({
        version: 2,
        drafts: {
          'thread:legacy': {
            input: 'legacy sensitive prompt',
            planMode: false,
            permissionProfile: 'full_access',
          },
        },
        outbox: [],
        creations: [],
      })
    );

    await expect(readRemoteDraft('thread:legacy')).resolves.toMatchObject({
      input: 'legacy sensitive prompt',
    });
    await expect(
      AsyncStorage.getItem('@taskforceai:remote-composer:v1')
    ).resolves.toBeNull();
    expect(mockEncryptedMetadata.get('remote-composer:v2')).toContain('legacy sensitive prompt');
  });

  it('upgrades version-one state and discards malformed legacy storage', async () => {
    await AsyncStorage.setItem(
      '@taskforceai:remote-composer:v1',
      JSON.stringify({
        version: 1,
        drafts: {
          legacy: { input: 'v1 draft', planMode: false, permissionProfile: 'read_only' },
        },
        outbox: [],
      })
    );
    await expect(readRemoteDraft('legacy')).resolves.toMatchObject({ input: 'v1 draft' });

    mockEncryptedMetadata.clear();
    await AsyncStorage.setItem('@taskforceai:remote-composer:v1', '{malformed');
    await expect(readRemoteDraft('legacy')).resolves.toEqual({
      input: '',
      planMode: false,
      permissionProfile: 'full_access',
    });
    await expect(AsyncStorage.getItem('@taskforceai:remote-composer:v1')).resolves.toBeNull();
  });

  it('keeps legacy state recoverable when encrypted migration cannot commit', async () => {
    const legacy = JSON.stringify({
      version: 2,
      drafts: {
        'thread:legacy': {
          input: 'recoverable prompt',
          planMode: false,
          permissionProfile: 'full_access',
        },
      },
      outbox: [],
      creations: [],
    });
    await AsyncStorage.setItem('@taskforceai:remote-composer:v1', legacy);
    mockEncryptedWriteError = new Error('encrypted database unavailable');

    await expect(readRemoteDraft('thread:legacy')).rejects.toThrow(
      'encrypted database unavailable'
    );
    await expect(
      AsyncStorage.getItem('@taskforceai:remote-composer:v1')
    ).resolves.toBe(legacy);
  });

  it('keeps queued turns ordered and idempotent until delivered', async () => {
    const first: RemoteTurnOutboxItem = {
      id: 'message-one',
      threadId: 'thread-1',
      input: 'First',
      modelId: null,
      reasoningEffort: null,
      attachmentIds: [],
      planMode: false,
      permissionProfile: 'full_access',
      createdAt: 1,
    };
    const second = { ...first, id: 'message-two', input: 'Second', createdAt: 2 };

    await enqueueRemoteTurn(second);
    await enqueueRemoteTurn(first);
    await enqueueRemoteTurn(first);
    await expect(readRemoteTurnOutbox('thread-1')).resolves.toEqual([first, second]);

    await removeRemoteTurn(first.id);
    await expect(readRemoteTurnOutbox('thread-1')).resolves.toEqual([second]);
  });

  it('keeps queued thread creations ordered, scoped, and idempotent', async () => {
    const first: RemoteThreadCreationOutboxItem = {
      id: 'creation-one',
      hostId: 'host-one',
      input: 'First',
      taskMode: 'code',
      projectId: null,
      workspaceRoot: null,
      modelId: null,
      reasoningEffort: null,
      attachmentIds: [],
      planMode: false,
      permissionProfile: 'full_access',
      createdAt: 1,
    };
    const second = { ...first, id: 'creation-two', hostId: 'host-two', createdAt: 2 };

    await enqueueRemoteThreadCreation(second);
    await enqueueRemoteThreadCreation(first);
    await enqueueRemoteThreadCreation(first);
    await expect(readRemoteThreadCreationOutbox('host-one')).resolves.toEqual([first]);
    await expect(readRemoteThreadCreationOutbox()).resolves.toEqual([first, second]);
    await removeRemoteThreadCreation(first.id);
    await expect(readRemoteThreadCreationOutbox()).resolves.toEqual([second]);
  });

  it('hydrates and updates the Remote composer hook, including read failures', async () => {
    const hook = await renderHook(() => useRemoteComposerDraft('thread:hook'));
    await waitFor(() => expect(hook.result.current.hydrated).toBe(true));
    await act(async () => {
      hook.result.current.setInput((current) => `${current}message`);
      hook.result.current.setPlanMode(true);
      hook.result.current.setPermissionProfile('workspace_write');
    });
    await waitFor(() =>
      expect(hook.result.current.draft).toEqual({
        input: 'message',
        planMode: true,
        permissionProfile: 'workspace_write',
      })
    );
    await act(async () => hook.result.current.clear());
    await removeRemoteDraft('thread:hook');

    mockEncryptedReadError = new Error('encrypted read failed');
    const failed = await renderHook(() => useRemoteComposerDraft('thread:failed'));
    await waitFor(() => expect(failed.result.current.hydrated).toBe(true));
  });

  it('adds the shared read-only instruction only for Plan turns', () => {
    expect(remoteTurnInput('Inspect this', false)).toBe('Inspect this');
    expect(remoteTurnInput('Inspect this', true)).toContain(
      'Planning mode is enabled for this turn.'
    );
    expect(remoteTurnInput('Inspect this', true)).toContain('User request:\nInspect this');
  });
});
