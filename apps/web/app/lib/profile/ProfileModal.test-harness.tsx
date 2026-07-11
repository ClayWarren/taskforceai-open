import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'bun:test';
import type { ComponentProps } from 'react';

import '../../../../../tests/setup/dom';
import {
  defaultStorageSummaryResult,
  mockCloseAllMcpServers,
  mockCloseMcpServer,
  mockConversationStore,
  mockDiscoverMcpServer,
  mockFetchStorageSummary,
  mockInspectDesktopMcpServer,
  mockPersistWebMcpServers,
  mockReadStoredWebMcpServers,
  mockWaitForTauriBridge,
} from './ProfileModal.test-utils';

export const mockInvokeTauri = vi.fn();
export const mockListenTauriEvent = vi.fn();
export const mockWebMcpManager = vi.fn();

void vi.mock('../platform/PlatformProvider', () => ({
  usePlatformRuntime: vi.fn(() => 'browser'),
  useConversationStore: vi.fn(() => mockConversationStore),
}));

void vi.mock('../providers/AuthProvider', () => ({
  useAuth: vi.fn(),
}));

void vi.mock('@taskforceai/api-client/services/profile-service', () => ({
  loadProfileData: vi.fn(),
  cancelProfileSubscription: vi.fn(),
  deleteProfileAccount: vi.fn(),
  exportProfileData: vi.fn(),
  reactivateProfileSubscription: vi.fn(),
  loadIntegrations: vi.fn(),
  disconnectProfileIntegration: vi.fn(),
}));

void vi.mock('@taskforceai/api-client/services/upgrade-flow', () => ({
  startUpgradeCheckout: vi.fn(),
}));

void vi.mock('@taskforceai/browser-runtime/browser-actions', () => ({
  navigateTo: vi.fn(() => ({ ok: true })),
  downloadBlob: vi.fn(() => ({ ok: true })),
}));

void vi.mock('../mcp/manager', () => ({
  WebMcpManager: mockWebMcpManager,
}));

void vi.mock('../mcp/store', () => ({
  readStoredWebMcpServers: mockReadStoredWebMcpServers,
  persistWebMcpServers: mockPersistWebMcpServers,
}));

void vi.mock('../platform/desktop/bridge', () => ({
  waitForTauriBridge: mockWaitForTauriBridge,
  invokeTauri: mockInvokeTauri,
  listenTauriEvent: mockListenTauriEvent,
}));

void vi.mock('../platform/desktop/mcp', () => ({
  inspectDesktopMcpServer: mockInspectDesktopMcpServer,
}));

void vi.mock('./ProfileDesktopLocalSection', () => ({
  DesktopLocalSection: () => <span>Desktop local settings</span>,
  DesktopBrowserUseSection: () => <span>Browser use settings</span>,
  DesktopComputerUseSection: () => <span>Computer Use settings</span>,
  DesktopAppshotsSection: () => <span>Appshots settings</span>,
  DesktopEnvironmentsSection: () => <span>Environments settings</span>,
  DesktopWorktreesSection: () => <span>Worktrees settings</span>,
}));

void vi.mock('@taskforceai/api-client/api/account', () => ({
  updateUserSettings: vi.fn().mockResolvedValue({ ok: true }),
}));

void vi.mock('@taskforceai/api-client/api/memories', () => ({
  fetchMemories: vi.fn().mockResolvedValue({
    ok: true,
    value: [
      {
        id: 1,
        content: 'User prefers concise updates',
        type: 'preference',
        metadata: null,
        created_at: '2026-06-04T19:00:00Z',
        updated_at: '2026-06-04T20:00:00Z',
      },
    ],
  }),
  createMemory: vi.fn().mockResolvedValue({ ok: true, value: true }),
  updateMemory: vi.fn().mockResolvedValue({
    ok: true,
    value: {
      id: 1,
      content: 'Updated memory',
      type: 'fact',
      metadata: null,
      created_at: '2026-06-04T19:00:00Z',
      updated_at: '2026-06-04T21:00:00Z',
    },
  }),
  deleteMemory: vi.fn().mockResolvedValue({ ok: true, value: true }),
}));

void vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

type ProfileModalComponent = typeof import('./ProfileModal').default;

const { downloadBlob, navigateTo } =
  require('@taskforceai/browser-runtime/browser-actions') as typeof import('@taskforceai/browser-runtime/browser-actions');
const { useAuth } =
  require('../providers/AuthProvider') as typeof import('../providers/AuthProvider');
const { startUpgradeCheckout } =
  require('@taskforceai/api-client/services/upgrade-flow') as typeof import('@taskforceai/api-client/services/upgrade-flow');
const {
  cancelProfileSubscription,
  deleteProfileAccount,
  disconnectProfileIntegration,
  exportProfileData,
  loadIntegrations,
  loadProfileData,
  reactivateProfileSubscription,
} =
  require('@taskforceai/api-client/services/profile-service') as typeof import('@taskforceai/api-client/services/profile-service');
const ProfileModal = require('./ProfileModal').default as ProfileModalComponent;

export const mockUser = {
  email: 'test@example.com',
  plan: 'free',
  message_count: 0,
  theme_preference: 'system',
  notifications_enabled: true,
  memory_enabled: true,
  web_search_enabled: true,
  code_execution_enabled: true,
};

export const mockLogout = vi.fn();
export const mockRefreshUser = vi.fn();
export const proProduct = { plan: 'pro', price_id: 'price_pro', price_amount: 2000 };
export const activeSubscription = { id: 'sub_123', status: 'active', cancel_at_period_end: false };

export const mockProfileData = (value: Record<string, unknown>) => {
  (loadProfileData as any).mockResolvedValue({ ok: true, value });
};

export const mockProfileError = (error: unknown) => {
  (loadProfileData as any).mockResolvedValue({ ok: false, error });
};

export const mockPaidProfile = () =>
  mockProfileData({
    subscription: activeSubscription,
    products: [proProduct],
  });

export const resetProfileModalTestHarness = () => {
  vi.resetAllMocks();
  mockFetchStorageSummary.mockResolvedValue(defaultStorageSummaryResult);
  mockWebMcpManager.mockImplementation(() => ({
    close: mockCloseMcpServer,
    closeAll: mockCloseAllMcpServers,
    discover: mockDiscoverMcpServer,
  }));
  const platformProvider = require('../platform/PlatformProvider');
  platformProvider.usePlatformRuntime.mockReturnValue('browser');
  platformProvider.useConversationStore.mockReturnValue(mockConversationStore);
  mockConversationStore.listArchivedConversations.mockResolvedValue([
    {
      conversationId: 'archived-1',
      title: 'Archived Research',
      createdAt: 1710000000000,
      updatedAt: 1710000005000,
      lastMessagePreview: 'Saved for later',
    },
  ]);
  mockConversationStore.restoreConversation.mockResolvedValue(undefined);
  mockConversationStore.clearConversation.mockResolvedValue(undefined);
  mockConversationStore.archiveAllConversations.mockResolvedValue(undefined);
  mockConversationStore.deleteAllConversations.mockResolvedValue(undefined);
  const memoriesApi = require('@taskforceai/api-client/api/memories');
  memoriesApi.fetchMemories.mockResolvedValue({
    ok: true,
    value: [
      {
        id: 1,
        content: 'User prefers concise updates',
        type: 'preference',
        metadata: null,
        created_at: '2026-06-04T19:00:00Z',
        updated_at: '2026-06-04T20:00:00Z',
      },
    ],
  });
  memoriesApi.createMemory.mockResolvedValue({ ok: true, value: true });
  memoriesApi.updateMemory.mockResolvedValue({
    ok: true,
    value: {
      id: 1,
      content: 'Updated memory',
      type: 'fact',
      metadata: null,
      created_at: '2026-06-04T19:00:00Z',
      updated_at: '2026-06-04T21:00:00Z',
    },
  });
  memoriesApi.deleteMemory.mockResolvedValue({ ok: true, value: true });
  (useAuth as any).mockReturnValue({
    user: mockUser,
    logout: mockLogout,
    refreshUser: mockRefreshUser,
  });
  mockProfileData({
    subscription: null,
    products: [proProduct, { plan: 'super', price_id: 'price_super', price_amount: 20000 }],
  });
  (loadIntegrations as any).mockResolvedValue({ ok: true, value: [] });
  (disconnectProfileIntegration as any).mockResolvedValue({ ok: true, value: undefined });
  mockReadStoredWebMcpServers.mockReturnValue([]);
  mockPersistWebMcpServers.mockImplementation((servers: any[]) => servers);
  mockWaitForTauriBridge.mockResolvedValue(false);
  mockDiscoverMcpServer.mockResolvedValue({
    serverName: 'Docs',
    tools: [{ name: 'search' }],
    prompts: [],
    resources: [],
  });
  mockInspectDesktopMcpServer.mockResolvedValue({
    server_name: 'Desktop Docs',
    tools: [],
    prompts: [{ name: 'summarize' }],
    resources: [{ uri: 'file:///tmp/a' }],
  });
  (downloadBlob as any).mockReturnValue({ ok: true });
  (navigateTo as any).mockReturnValue({ ok: true });
};

export const cleanupProfileModalTestHarness = () => {
  cleanup();
};

export const installProfileModalTestHooks = () => {
  beforeEach(resetProfileModalTestHarness);
  afterEach(cleanupProfileModalTestHarness);
};

export const renderOpenProfile = async (
  props: Partial<ComponentProps<typeof ProfileModal>> = {}
) => {
  let view: ReturnType<typeof render> | undefined;
  await act(async () => {
    view = render(<ProfileModal open={true} onOpenChange={() => {}} {...props} />);
  });
  await screen.findByRole('heading', { name: 'General' });
  return view as ReturnType<typeof render>;
};

export const openProfileTab = async (name: string) => {
  await clickText(name);
};

export const clickElement = async (element: Element) => {
  await act(async () => {
    fireEvent.click(element);
  });
};

export const clickText = async (name: string | RegExp) => clickElement(screen.getByText(name));
export const clickFoundText = async (name: string | RegExp) =>
  clickElement(await screen.findByText(name));
export const clickFoundRole = async (name: string | RegExp) =>
  clickElement(await screen.findByRole('button', { name }));
export const inputByLabel = async (label: string, value: string) => {
  await act(async () => {
    fireEvent.input(await screen.findByLabelText(label), { target: { value } });
  });
};

export {
  act,
  cancelProfileSubscription,
  deleteProfileAccount,
  disconnectProfileIntegration,
  downloadBlob,
  exportProfileData,
  fireEvent,
  loadIntegrations,
  loadProfileData,
  mockCloseAllMcpServers,
  mockCloseMcpServer,
  mockConversationStore,
  mockDiscoverMcpServer,
  mockInspectDesktopMcpServer,
  mockPersistWebMcpServers,
  mockReadStoredWebMcpServers,
  mockWaitForTauriBridge,
  navigateTo,
  ProfileModal,
  reactivateProfileSubscription,
  render,
  screen,
  startUpgradeCheckout,
  useAuth,
  waitFor,
};
