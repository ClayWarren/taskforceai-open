import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../../tests/setup/dom';

const fetchMemoriesMock = vi.fn();
const createMemoryMock = vi.fn();
const updateMemoryMock = vi.fn();
const deleteMemoryMock = vi.fn();
const loadProfileDataMock = vi.fn();
const loadIntegrationsMock = vi.fn();
const disconnectProfileIntegrationMock = vi.fn();
const exportProfileDataMock = vi.fn();
const deleteProfileAccountMock = vi.fn();
const downloadBlobMock = vi.fn();
const navigateToMock = vi.fn();
const fetchStorageSummaryMock = vi.fn();
const loggerErrorMock = vi.fn();
const preferenceActionsMock = {
  handleMemoryToggle: vi.fn(),
  handleWebSearchToggle: vi.fn(),
  handleCodeExecutionToggle: vi.fn(),
  handleTrustLayerToggle: vi.fn(),
  handleNotificationsToggle: vi.fn(),
  handleThemeChange: vi.fn(),
};
const subscriptionActionsMock = {
  handleCancelSubscription: vi.fn(),
  handleReactivateSubscription: vi.fn(),
  handleUpgrade: vi.fn(),
};
const mcpServersHookMock = {
  handleInspectMcpServer: vi.fn(),
  handleRemoveMcpServer: vi.fn(),
  handleSaveMcpServer: vi.fn(),
  mcpBusyServerName: null,
  mcpServers: [],
  pendingMcpEndpoint: '',
  pendingMcpName: '',
  setPendingMcpEndpoint: vi.fn(),
  setPendingMcpName: vi.fn(),
};

vi.mock('@taskforceai/api-client/api/memories', () => ({
  fetchMemories: fetchMemoriesMock,
  createMemory: createMemoryMock,
  updateMemory: updateMemoryMock,
  deleteMemory: deleteMemoryMock,
}));

vi.mock('@taskforceai/api-client/services/profile-service', () => ({
  loadProfileData: loadProfileDataMock,
  loadIntegrations: loadIntegrationsMock,
  disconnectProfileIntegration: disconnectProfileIntegrationMock,
  exportProfileData: exportProfileDataMock,
  deleteProfileAccount: deleteProfileAccountMock,
}));

vi.mock('@taskforceai/browser-runtime/browser-actions', () => ({
  downloadBlob: downloadBlobMock,
  navigateTo: navigateToMock,
}));

vi.mock('../../api/storage', () => ({
  fetchStorageSummary: fetchStorageSummaryMock,
}));

vi.mock('../../logger', () => ({
  logger: {
    error: loggerErrorMock,
  },
}));

vi.mock('../preferences/useProfilePreferenceActions', () => ({
  useProfilePreferenceActions: vi.fn(() => preferenceActionsMock),
}));

vi.mock('../billing/useProfileSubscriptionActions', () => ({
  useProfileSubscriptionActions: vi.fn(() => subscriptionActionsMock),
}));

vi.mock('../integrations/useProfileMcpServers', () => ({
  useProfileMcpServers: vi.fn(() => mcpServersHookMock),
}));

import { useProfileModalController } from './useProfileModalController';

const memory = {
  id: 1,
  content: 'User prefers concise status updates',
  type: 'preference',
  metadata: null,
  created_at: '2026-06-04T19:00:00Z',
  updated_at: '2026-06-04T20:00:00Z',
};

const updatedMemory = {
  ...memory,
  content: 'User prefers direct updates',
  type: 'fact',
  updated_at: '2026-06-04T21:00:00Z',
};

const renderController = (
  options: Partial<Parameters<typeof useProfileModalController>[0]> = {}
) => {
  const logout = vi.fn();
  const onModalOpen = vi.fn();
  const hook = renderHook((props) => useProfileModalController(props), {
    initialProps: {
      open: true,
      user: { email: 'test@example.com' },
      logout,
      onModalOpen,
      ...options,
    },
  });

  return {
    ...hook,
    logout,
    onModalOpen,
  };
};

describe('useProfileModalController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadProfileDataMock.mockResolvedValue({
      ok: true,
      value: {
        balance: null,
        subscription: null,
        products: [{ plan: 'pro', price_id: 'price_pro', price_amount: 2000 }],
      },
    });
    loadIntegrationsMock.mockResolvedValue({
      ok: true,
      value: [{ provider: 'github', connected: true }],
    });
    fetchStorageSummaryMock.mockResolvedValue({
      ok: true,
      value: {
        usedBytes: 100,
        quotaBytes: 1000,
        categories: [{ id: 'files', label: 'Files', bytes: 100, count: 1 }],
      },
    });
    fetchMemoriesMock.mockResolvedValue({ ok: true, value: [memory] });
    createMemoryMock.mockResolvedValue({ ok: true, value: true });
    updateMemoryMock.mockResolvedValue({ ok: true, value: updatedMemory });
    deleteMemoryMock.mockResolvedValue({ ok: true, value: true });
    disconnectProfileIntegrationMock.mockResolvedValue({ ok: true, value: true });
    exportProfileDataMock.mockResolvedValue({
      ok: true,
      value: { blob: new Blob(['{}'], { type: 'application/json' }), filename: 'data.json' },
    });
    deleteProfileAccountMock.mockResolvedValue({
      ok: true,
      value: { message: 'Account deleted.' },
    });
    downloadBlobMock.mockReturnValue({ ok: true });
    navigateToMock.mockReturnValue({ ok: true });
    subscriptionActionsMock.handleCancelSubscription.mockResolvedValue(undefined);
  });

  it('loads profile, integrations, storage, and notifies once when opened for a user', async () => {
    const { result, onModalOpen, rerender } = renderController();

    await waitFor(() => expect(loadProfileDataMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.products[0]?.plan).toBe('pro'));
    expect(loadIntegrationsMock).toHaveBeenCalledTimes(1);
    expect(fetchStorageSummaryMock).toHaveBeenCalledTimes(1);
    expect(onModalOpen).toHaveBeenCalledTimes(1);
    expect(result.current.integrations).toEqual([{ provider: 'github', connected: true }]);
    expect(result.current.storageSummary?.usedBytes).toBe(100);

    rerender({ open: true, user: { email: 'test@example.com' }, logout: vi.fn(), onModalOpen });

    expect(loadProfileDataMock).toHaveBeenCalledTimes(1);
    expect(fetchStorageSummaryMock).toHaveBeenCalledTimes(1);
    expect(onModalOpen).toHaveBeenCalledTimes(1);
  });

  it('loads memories from the summary dialog and surfaces load errors', async () => {
    const { result } = renderController();
    await waitFor(() => expect(fetchStorageSummaryMock).toHaveBeenCalled());

    await act(async () => {
      result.current.openMemorySummary();
    });
    await waitFor(() => expect(fetchMemoriesMock).toHaveBeenCalledTimes(1));
    expect(result.current.memorySummaryOpen).toBe(true);
    expect(result.current.memories).toEqual([memory]);

    fetchMemoriesMock.mockResolvedValueOnce({
      ok: false,
      error: { message: 'memories unavailable' },
    });
    await act(async () => {
      await result.current.loadMemories();
    });

    expect(result.current.memoriesError).toBe('memories unavailable');
    expect(loggerErrorMock).toHaveBeenCalledWith('Failed to load memories for profile modal', {
      error: { message: 'memories unavailable' },
    });
  });

  it('creates, updates, and deletes memories with feedback and local state updates', async () => {
    const { result } = renderController();
    await waitFor(() => expect(fetchStorageSummaryMock).toHaveBeenCalled());

    await act(async () => {
      await result.current.openMemorySummary();
    });
    await waitFor(() => expect(result.current.memories).toHaveLength(1));

    await act(async () => {
      await expect(result.current.handleCreateMemory('Remember this', 'fact')).resolves.toBe(true);
    });
    expect(createMemoryMock).toHaveBeenCalledWith({ content: 'Remember this', type: 'fact' });
    expect(result.current.feedbackMessage).toBe('Memory added.');

    await act(async () => {
      await expect(result.current.handleUpdateMemory(1, 'Updated', 'fact')).resolves.toBe(true);
    });
    expect(updateMemoryMock).toHaveBeenCalledWith(1, { content: 'Updated', type: 'fact' });
    expect(result.current.memories[0]).toEqual(updatedMemory);
    expect(result.current.feedbackMessage).toBe('Memory updated.');

    await act(async () => {
      await expect(result.current.handleDeleteMemory(1)).resolves.toBe(true);
    });
    expect(deleteMemoryMock).toHaveBeenCalledWith(1);
    expect(result.current.memories).toEqual([]);
    expect(result.current.feedbackMessage).toBe('Memory deleted.');
  });

  it('returns false and sets error feedback when memory mutations fail', async () => {
    const { result } = renderController();
    await waitFor(() => expect(fetchStorageSummaryMock).toHaveBeenCalled());
    createMemoryMock.mockResolvedValueOnce({ ok: false, error: { message: 'create failed' } });
    updateMemoryMock.mockResolvedValueOnce({ ok: false, error: { message: 'update failed' } });
    deleteMemoryMock.mockResolvedValueOnce({ ok: false, error: { message: 'delete failed' } });

    await act(async () => {
      await expect(result.current.handleCreateMemory('Remember this', 'fact')).resolves.toBe(false);
    });
    expect(result.current.feedbackKind).toBe('error');
    expect(result.current.feedbackMessage).toBe('Failed to add memory.');

    await act(async () => {
      await expect(result.current.handleUpdateMemory(1, 'Updated', 'fact')).resolves.toBe(false);
    });
    expect(result.current.feedbackMessage).toBe('Failed to update memory.');

    await act(async () => {
      await expect(result.current.handleDeleteMemory(1)).resolves.toBe(false);
    });
    expect(result.current.feedbackMessage).toBe('Failed to delete memory.');
    expect(result.current.memoryActionId).toBeNull();
  });

  it('handles data export success and download failures', async () => {
    const { result } = renderController();
    await waitFor(() => expect(fetchStorageSummaryMock).toHaveBeenCalled());

    await act(async () => {
      await result.current.handleDataExport();
    });

    expect(exportProfileDataMock).toHaveBeenCalledWith('test@example.com');
    expect(downloadBlobMock).toHaveBeenCalledWith({
      blob: expect.any(Blob),
      filename: 'data.json',
    });
    expect(result.current.feedbackKind).toBe('success');

    downloadBlobMock.mockReturnValueOnce({ ok: false, error: new Error('download blocked') });
    await act(async () => {
      await result.current.handleDataExport();
    });

    expect(result.current.feedbackKind).toBe('error');
    expect(result.current.feedbackMessage).toBe('Failed to export data. Please try again.');
  });

  it('guards account deletion by email and logs out after a confirmed delete', async () => {
    const { result, logout } = renderController();
    await waitFor(() => expect(fetchStorageSummaryMock).toHaveBeenCalled());

    await act(async () => {
      result.current.setDeleteInput('wrong@example.com');
    });
    await act(async () => {
      await result.current.confirmAndDeleteAccount();
    });
    expect(deleteProfileAccountMock).not.toHaveBeenCalled();
    expect(result.current.feedbackMessage).toBe('Email confirmation failed. Account not deleted.');

    await act(async () => {
      result.current.setDeleteInput('test@example.com');
    });
    await act(async () => {
      await result.current.confirmAndDeleteAccount();
    });

    expect(deleteProfileAccountMock).toHaveBeenCalledWith('test@example.com');
    expect(logout).toHaveBeenCalledTimes(1);
    expect(navigateToMock).toHaveBeenCalledWith('/');
    expect(result.current.deleteInput).toBe('');
    expect(result.current.confirmDeleteOpen).toBe(false);
  });

  it('surfaces account deletion failures', async () => {
    deleteProfileAccountMock.mockResolvedValueOnce({
      ok: false,
      error: { message: 'delete failed' },
    });
    const { result } = renderController();
    await waitFor(() => expect(fetchStorageSummaryMock).toHaveBeenCalled());

    await act(async () => {
      result.current.setDeleteInput('test@example.com');
    });
    await act(async () => {
      await result.current.confirmAndDeleteAccount();
    });

    expect(loggerErrorMock).toHaveBeenCalledWith('Failed to delete account', expect.any(Error));
    expect(result.current.feedbackKind).toBe('error');
    expect(result.current.feedbackMessage).toBe(
      'Failed to delete account. Please contact support.'
    );
    expect(result.current.loading).toBe(false);
  });

  it('surfaces storage loading and artifact navigation failures', async () => {
    fetchStorageSummaryMock.mockResolvedValueOnce({
      ok: false,
      error: new Error('storage unavailable'),
    });
    navigateToMock.mockReturnValueOnce({ ok: false, error: new Error('navigation blocked') });

    const { result } = renderController();
    await waitFor(() => expect(result.current.storageError).toBe('storage unavailable'));
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Failed to load storage summary for profile modal',
      {
        error: new Error('storage unavailable'),
      }
    );

    act(() => {
      result.current.handleManageStorageCategory('files');
    });

    expect(navigateToMock).toHaveBeenCalledWith('/artifacts');
    expect(result.current.feedbackKind).toBe('error');
    expect(result.current.feedbackMessage).toBe('Failed to open artifact library.');
  });

  it('disconnects integrations and reports failures', async () => {
    const { result } = renderController();
    await waitFor(() => expect(fetchStorageSummaryMock).toHaveBeenCalled());

    await act(async () => {
      await result.current.handleDisconnect('github');
    });
    expect(disconnectProfileIntegrationMock).toHaveBeenCalledWith('github');
    expect(loadProfileDataMock).toHaveBeenCalledTimes(2);
    expect(result.current.feedbackKind).toBe('success');
    expect(result.current.feedbackMessage).toBe('github disconnected successfully.');

    disconnectProfileIntegrationMock.mockResolvedValueOnce({
      ok: false,
      error: new Error('disconnect failed'),
    });
    await act(async () => {
      await result.current.handleDisconnect('google-drive');
    });
    expect(result.current.feedbackKind).toBe('error');
    expect(result.current.feedbackMessage).toBe('Failed to disconnect google drive.');
  });

  it('resets transient state when closed', async () => {
    const { result, rerender } = renderController();
    await waitFor(() => expect(fetchStorageSummaryMock).toHaveBeenCalled());

    await act(async () => {
      result.current.openMemorySummary();
      result.current.setDeleteInput('test@example.com');
    });
    await waitFor(() => expect(result.current.memorySummaryOpen).toBe(true));

    rerender({
      open: false,
      user: { email: 'test@example.com' },
      logout: vi.fn(),
      onModalOpen: vi.fn(),
    });

    expect(result.current.memorySummaryOpen).toBe(false);
    expect(result.current.memories).toEqual([]);
    expect(result.current.storageSummary).toBeNull();
    expect(result.current.storageLoading).toBe(false);
  });
});
