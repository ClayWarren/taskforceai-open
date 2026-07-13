import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Alert, Text, TextInput, TouchableOpacity } from 'react-native';

let mockSyncState: {
  lastSyncTime: number;
  lastStats: {
    pushed: { conversations: number; messages: number };
    pulled: { conversations: number; messages: number };
  } | null;
};

const reactNative = require('react-native');
const ReactModule = require('react');
if (!reactNative.Switch) {
  reactNative.Switch = (props: any) => ReactModule.createElement('Switch', props);
}
if (!reactNative.FlatList) {
  reactNative.FlatList = ({ data = [], renderItem, ListEmptyComponent }: any) => {
    if (!data.length && ListEmptyComponent) {
      return ReactModule.isValidElement(ListEmptyComponent)
        ? ListEmptyComponent
        : ReactModule.createElement(ListEmptyComponent);
    }
    return ReactModule.createElement(
      'FlatList',
      null,
      data.map((item: any, index: number) =>
        ReactModule.createElement(
          ReactModule.Fragment,
          { key: item.conversationId ?? index },
          renderItem({ item, index })
        )
      )
    );
  };
}

const mockSetupAuthenticatorMFA = jest.fn(async () => ({ secret: 'SETUPSECRET123456' }));
const mockVerifyAuthenticatorMFA = jest.fn(async () => ({ enabled: true }));
const mockDisableAuthenticatorMFA = jest.fn(async () => ({ enabled: false }));
const mockListArchivedConversations = jest.fn(async () => ({ ok: true, value: [] }));
const mockArchiveAllConversations = jest.fn(async () => undefined);
const mockDeleteAllConversations = jest.fn(async () => undefined);
const mockRestoreConversation = jest.fn(async () => undefined);
const mockClearConversation = jest.fn(async () => undefined);

jest.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      colors: {
        primary: '#0066ff',
        background: '#000000',
        border: '#333333',
        cardBackground: '#111111',
        error: '#ff3b30',
        inputBackground: '#222222',
        text: '#ffffff',
        textMuted: '#999999',
        white: '#ffffff',
      },
    },
  }),
}));

jest.mock('../../contexts/SyncContext', () => ({
  useSync: () => ({
    syncState: mockSyncState,
  }),
}));

jest.mock('react-i18next', () =>
  require('../helpers/mock-modules').createTranslationMockModule()
);

jest.mock('../../logger', () => ({
  createModuleLogger: () => ({
    error: jest.fn(),
  }),
}));

jest.mock('../../components/Icon', () =>
  require('../helpers/mock-modules').createIconMockModule()
);

jest.mock('../../components/ActionButton', () => ({
  ActionButton: ({ children, onPress, disabled, accessibilityLabel }: any) => {
    const react = require('react');
    const { TouchableOpacity: RNTouchableOpacity, Text: RNText } = require('react-native');
    return react.createElement(
      RNTouchableOpacity,
      { onPress, disabled, accessibilityLabel, accessibilityRole: 'button' },
      react.createElement(RNText, null, children)
    );
  },
}));

jest.mock('../../api/client', () => ({
  getMobileClient: () => ({
    setupAuthenticatorMFA: mockSetupAuthenticatorMFA,
    verifyAuthenticatorMFA: mockVerifyAuthenticatorMFA,
    disableAuthenticatorMFA: mockDisableAuthenticatorMFA,
  }),
}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(async () => undefined),
}));

jest.mock('../../storage/chat-local-mobile', () => ({
  archiveAllConversations: (...args: unknown[]) => mockArchiveAllConversations(...args),
  clearConversation: (...args: unknown[]) => mockClearConversation(...args),
  deleteAllConversations: (...args: unknown[]) => mockDeleteAllConversations(...args),
  listArchivedConversations: (...args: unknown[]) => mockListArchivedConversations(...args),
  restoreConversation: (...args: unknown[]) => mockRestoreConversation(...args),
}));

import { DataControlsSection } from '../../screens/settings/sections/DataControlsSection';
import { IntegrationsSection } from '../../screens/settings/sections/IntegrationsSection';
import { MemorySummaryModal } from '../../screens/settings/MemorySummaryModal';
import { NotificationsSection } from '../../screens/settings/sections/NotificationsSection';
import { PersonalizationSection } from '../../screens/settings/sections/PersonalizationSection';
import { SecuritySection } from '../../screens/settings/sections/SecuritySection';
import { StorageSection } from '../../screens/settings/sections/StorageSection';
import {
  SubscriptionActions,
  SubscriptionSection,
} from '../../screens/settings/sections/SubscriptionSection';
import { UsageSection } from '../../screens/settings/sections/UsageSection';

const getButtonText = (button: TestRenderer.ReactTestInstance): string | null => {
  try {
    return String(button.findByType(Text).props.children);
  } catch {
    return null;
  }
};

const flushAsyncWork = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const createMemorySummaryState = (overrides: Record<string, unknown> = {}) => ({
  visible: false,
  memories: [],
  loading: false,
  saving: false,
  deletingId: null,
  editingMemoryId: null,
  draft: '',
  error: null,
  open: jest.fn(),
  close: jest.fn(),
  retry: jest.fn(),
  setDraft: jest.fn(),
  submit: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  edit: jest.fn(),
  delete: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  cancelEdit: jest.fn(),
  ...overrides,
});

const createDataControlsProps = (overrides: Record<string, unknown> = {}) => ({
  onClearCache: jest.fn(),
  onForceSync: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  onResetDatabase: jest.fn(),
  archivedChatsVisible: false,
  archivedChats: [],
  archivedChatsLoading: false,
  archivedChatsError: null,
  archivedSearchQuery: '',
  archiveActionId: null,
  onOpenArchivedChats: jest.fn(),
  onCloseArchivedChats: jest.fn(),
  onArchivedSearchChange: jest.fn(),
  onRestoreArchivedChat: jest.fn(),
  onDeleteArchivedChat: jest.fn(),
  onArchiveAllChats: jest.fn(),
  onDeleteAllChats: jest.fn(),
  isAdmin: false,
  ...overrides,
});

describe('Settings sections', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSyncState = {
      lastSyncTime: 0,
      lastStats: null,
    };
  });

  it('wires Data Controls actions', async () => {
    const onClearCache = jest.fn();
    const onForceSync = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const onResetDatabase = jest.fn();
    const alertSpy = jest.spyOn(Alert, 'alert');

    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <DataControlsSection
          {...(createDataControlsProps({
            onClearCache,
            onForceSync,
            onResetDatabase,
            isAdmin: false,
          }) as any)}
        />
      );
    });

    const buttons = renderer!.root.findAllByType(TouchableOpacity);
    const forceSyncButton = buttons.find(
      (button) => button.props.accessibilityLabel === 'mobile.settings.forceSync'
    );
    const clearCacheButton = buttons.find(
      (button) => button.props.accessibilityLabel === 'mobile.settings.clearCache'
    );
    const manageArchivedButton = buttons.find((button) => button.props.accessibilityLabel === 'Manage');
    const archiveAllButton = buttons.find((button) => button.props.accessibilityLabel === 'Archive all');
    const deleteAllButton = buttons.find((button) => button.props.accessibilityLabel === 'Delete all');

    expect(forceSyncButton).toBeDefined();
    expect(clearCacheButton).toBeDefined();
    expect(manageArchivedButton).toBeDefined();
    expect(archiveAllButton).toBeDefined();
    expect(deleteAllButton).toBeDefined();

    await act(async () => {
      forceSyncButton!.props.onPress();
      clearCacheButton!.props.onPress();
      manageArchivedButton!.props.onPress();
      archiveAllButton!.props.onPress();
      deleteAllButton!.props.onPress();
      await flushAsyncWork();
    });

    expect(onForceSync).toHaveBeenCalledTimes(1);
    expect(onClearCache).toHaveBeenCalledTimes(1);
    expect(mockListArchivedConversations).toHaveBeenCalledWith(200);
    expect(mockArchiveAllConversations).toHaveBeenCalledTimes(1);
    const [, , deleteButtons] = alertSpy.mock.calls[0] as [
      string,
      string | undefined,
      Array<{ text: string; onPress?: () => void }>,
    ];
    await act(async () => {
      deleteButtons.find((button) => button.text === 'Delete all')?.onPress?.();
      await flushAsyncWork();
    });
    expect(mockDeleteAllConversations).toHaveBeenCalledTimes(1);
    expect(onResetDatabase).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('renders archived chats modal and row actions', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    mockListArchivedConversations.mockResolvedValueOnce({
      ok: true,
      value: [
        {
          conversationId: 'archived-1',
          title: 'Archived Research',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          lastMessagePreview: 'preview',
        },
      ],
    });

    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <DataControlsSection
          {...(createDataControlsProps() as any)}
        />
      );
    });

    const manageArchivedButton = renderer!.root
      .findAllByType(TouchableOpacity)
      .find((button) => button.props.accessibilityLabel === 'Manage');
    await act(async () => {
      manageArchivedButton!.props.onPress();
      await flushAsyncWork();
    });

    expect(renderer!.root.findAllByType(Text).some((node) => String(node.props.children) === 'Archived Research')).toBe(true);

    const searchInput = renderer!.root.findByType(TextInput);
    act(() => {
      searchInput.props.onChangeText('research');
    });

    const archivedRow = renderer!.root
      .findAllByType(TouchableOpacity)
      .find((button) => button.props.accessibilityLabel === 'Archived Research');
    act(() => {
      archivedRow!.props.onPress();
    });

    const [, , buttons] = alertSpy.mock.calls[0] as [
      string,
      string | undefined,
      Array<{ text: string; onPress?: () => void }>,
    ];
    await act(async () => {
      buttons.find((button) => button.text === 'Restore')?.onPress?.();
      buttons.find((button) => button.text === 'Delete')?.onPress?.();
      await flushAsyncWork();
    });

    expect(mockRestoreConversation).toHaveBeenCalledWith('archived-1');
    expect(mockClearConversation).toHaveBeenCalledWith('archived-1');

    alertSpy.mockRestore();
  });

  it('shows sync stats and admin reset action when available', () => {
    mockSyncState = {
      lastSyncTime: 1700000000000,
      lastStats: {
        pushed: { conversations: 3, messages: 9 },
        pulled: { conversations: 4, messages: 12 },
      },
    };

    const onResetDatabase = jest.fn();

    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <DataControlsSection
          {...(createDataControlsProps({
            onResetDatabase,
            isAdmin: true,
          }) as any)}
        />
      );
    });

    const resetButton = renderer!.root.findAllByType(TouchableOpacity).find(
      (button) => button.props.accessibilityLabel === 'Reset Database'
    );

    expect(resetButton).toBeDefined();
    expect(renderer!.root.findByProps({ accessibilityLabel: 'Sync statistics' })).toBeTruthy();
    expect(renderer!.root.findAllByType(Text).some((node) => String(node.props.children) === 'mobile.settings.lastRun')).toBe(true);

    act(() => {
      resetButton!.props.onPress();
    });

    expect(onResetDatabase).toHaveBeenCalledTimes(1);
  });

  it('wires Connected Apps connect/disconnect actions', () => {
    const onConnect = jest.fn();
    const onDisconnect = jest.fn();

    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <IntegrationsSection
          integrations={[
            { provider: 'google-drive', connected: false },
            { provider: 'github', connected: true },
          ]}
          mcpServers={[]}
          loading={false}
          actionProvider={null}
          pendingMcpName=""
          pendingMcpEndpoint=""
          mcpActionServer={null}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          onPendingMcpNameChange={jest.fn()}
          onPendingMcpEndpointChange={jest.fn()}
          onAddMcpServer={jest.fn()}
          onInspectMcpServer={jest.fn()}
          onRemoveMcpServer={jest.fn()}
        />
      );
    });

    const buttons = renderer!.root.findAllByType(TouchableOpacity);
    const connectButton = buttons.find((button) => getButtonText(button) === 'Connect');
    const disconnectButton = buttons.find((button) => getButtonText(button) === 'Disconnect');

    expect(connectButton).toBeDefined();
    expect(disconnectButton).toBeDefined();

    act(() => {
      connectButton!.props.onPress();
      disconnectButton!.props.onPress();
    });

    expect(onConnect).toHaveBeenCalledWith('google-drive');
    expect(onDisconnect).toHaveBeenCalledWith('github');
  });

  it('renders integrations loading and empty states', () => {
    let loadingRenderer: TestRenderer.ReactTestRenderer;
    act(() => {
      loadingRenderer = TestRenderer.create(
        <IntegrationsSection
          integrations={[]}
          mcpServers={[]}
          loading={true}
          actionProvider={null}
          pendingMcpName=""
          pendingMcpEndpoint=""
          mcpActionServer={null}
          onConnect={jest.fn()}
          onDisconnect={jest.fn()}
          onPendingMcpNameChange={jest.fn()}
          onPendingMcpEndpointChange={jest.fn()}
          onAddMcpServer={jest.fn()}
          onInspectMcpServer={jest.fn()}
          onRemoveMcpServer={jest.fn()}
        />
      );
    });

    expect(loadingRenderer!.root.findByType('ActivityIndicator')).toBeTruthy();

    let emptyRenderer: TestRenderer.ReactTestRenderer;
    act(() => {
      emptyRenderer = TestRenderer.create(
        <IntegrationsSection
          integrations={[]}
          mcpServers={[]}
          loading={false}
          actionProvider={null}
          pendingMcpName=""
          pendingMcpEndpoint=""
          mcpActionServer={null}
          onConnect={jest.fn()}
          onDisconnect={jest.fn()}
          onPendingMcpNameChange={jest.fn()}
          onPendingMcpEndpointChange={jest.fn()}
          onAddMcpServer={jest.fn()}
          onInspectMcpServer={jest.fn()}
          onRemoveMcpServer={jest.fn()}
        />
      );
    });

    expect(
      emptyRenderer!.root.findAllByType(Text).some((node) => node.props.children === 'No connected apps found.')
    ).toBe(true);
  });

  it('renders applicable notification rows and handles toggle failures', async () => {
    const onNotificationsToggle = jest
      .fn<(value: boolean) => Promise<void>>()
      .mockRejectedValue(new Error('toggle failed'));

    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <NotificationsSection
          notificationsEnabled={false}
          updatingNotifications={false}
          onNotificationsToggle={onNotificationsToggle}
        />
      );
    });

    const labels = renderer!.root.findAllByType(Text).map((node) => String(node.props.children));
    expect(labels).toEqual(expect.arrayContaining(['TaskForceAI', 'Responses', 'Tasks', 'Projects', 'Usage']));
    expect(labels).not.toEqual(expect.arrayContaining(['Marketing', 'Personalized tips', 'Group chats', 'Pulse daily updates']));
    expect(labels.filter((label) => label === 'Off')).toHaveLength(5);

    const tasksRow = renderer!.root.findAllByType(TouchableOpacity).find(
      (node) => node.props.accessibilityLabel === 'Tasks notifications: Off'
    );

    await act(async () => {
      await tasksRow!.props.onPress();
    });

    expect(onNotificationsToggle).toHaveBeenCalledWith(true);
    expect(Alert.alert).toHaveBeenCalledWith(
      'mobile.settings.notificationsErrorTitle',
      'mobile.settings.notificationsErrorMessage'
    );
  });

  it('wires authenticator MFA setup and disable actions', async () => {
    const onStatusChange = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <SecuritySection
          authenticatorEnabled={false}
          onStatusChange={onStatusChange}
        />
      );
    });

    const authenticatorSwitch = renderer!.root.findAll((node) => node.type === 'Switch')[0];
    await act(async () => {
      await authenticatorSwitch.props.onValueChange(true);
    });

    expect(mockSetupAuthenticatorMFA).toHaveBeenCalledTimes(1);
    expect(
      renderer!.root
        .findAllByType(Text)
        .some((node) => node.props.children === 'SETUPSECRET123456')
    ).toBe(true);

    const setupInput = renderer!.root.findAllByType(TextInput)[0];
    act(() => {
      setupInput.props.onChangeText('123456');
    });

    const verifyButton = renderer!.root
      .findAllByType(TouchableOpacity)
      .find((button) => getButtonText(button) === 'Verify');

    await act(async () => {
      await verifyButton!.props.onPress();
    });

    expect(mockVerifyAuthenticatorMFA).toHaveBeenCalledWith('123456');
    expect(onStatusChange).toHaveBeenCalledTimes(1);

    await act(async () => {
      renderer!.update(
        <SecuritySection
          authenticatorEnabled={true}
          onStatusChange={onStatusChange}
        />
      );
    });

    const disableSwitch = renderer!.root.findAll((node) => node.type === 'Switch')[0];
    await act(async () => {
      await disableSwitch.props.onValueChange(false);
    });

    const disableInput = renderer!.root.findAllByType(TextInput)[0];
    act(() => {
      disableInput.props.onChangeText('654321');
    });

    const disableButton = renderer!.root
      .findAllByType(TouchableOpacity)
      .find((button) => getButtonText(button) === 'Disable authenticator');

    await act(async () => {
      await disableButton!.props.onPress();
    });

    expect(mockDisableAuthenticatorMFA).toHaveBeenCalledWith('654321');
    expect(onStatusChange).toHaveBeenCalledTimes(2);
  });

  it('wires personalization switches and respects disabled state while updating', async () => {
    const onToggle = jest.fn<(key: string, value: boolean) => Promise<void>>().mockResolvedValue(undefined);
    const memorySummary = createMemorySummaryState();

    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <PersonalizationSection
          personalization={{
            memoryEnabled: true,
            webSearchEnabled: true,
            codeExecutionEnabled: false,
            trustLayerEnabled: false,
          }}
          updatingKey={null}
          onToggle={onToggle as any}
          memorySummary={memorySummary as any}
        />
      );
    });

    const summaryButton = renderer!.root.findByProps({ accessibilityLabel: 'Memory summary' });
    act(() => {
      summaryButton.props.onPress();
    });
    expect(memorySummary.open).toHaveBeenCalledTimes(1);

    const switches = renderer!.root.findAll((node) => node.type === 'Switch');
    await act(async () => {
      await switches[0].props.onValueChange(false);
      await switches[1].props.onValueChange(false);
      await switches[2].props.onValueChange(true);
      await switches[3].props.onValueChange(true);
    });

    expect(onToggle).toHaveBeenCalledWith('memoryEnabled', false);
    expect(onToggle).toHaveBeenCalledWith('webSearchEnabled', false);
    expect(onToggle).toHaveBeenCalledWith('codeExecutionEnabled', true);
    expect(onToggle).toHaveBeenCalledWith('trustLayerEnabled', true);

    act(() => {
      renderer!.update(
        <PersonalizationSection
          personalization={{
            memoryEnabled: true,
            webSearchEnabled: true,
            codeExecutionEnabled: false,
            trustLayerEnabled: false,
          }}
          updatingKey={'memoryEnabled'}
          onToggle={onToggle as any}
          memorySummary={createMemorySummaryState() as any}
        />
      );
    });

    const disabledSwitches = renderer!.root.findAll((node) => node.type === 'Switch');
    expect(disabledSwitches.every((switchNode) => switchNode.props.disabled === true)).toBe(true);
  });

  it('renders memory summary modal actions', async () => {
    const onDraftChange = jest.fn();
    const onSubmit = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const onEdit = jest.fn();
    const onDelete = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const memory = {
      id: 17,
      content: 'User prefers concise mobile summaries.',
      type: 'preference',
      metadata: null,
      created_at: '2026-06-13T12:00:00.000Z',
      updated_at: '2026-06-13T12:30:00.000Z',
    };

    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <MemorySummaryModal
          visible={true}
          memories={[memory]}
          loading={false}
          saving={false}
          deletingId={null}
          editingMemoryId={null}
          draft="remember this"
          error={null}
          onClose={jest.fn()}
          onRetry={jest.fn()}
          onDraftChange={onDraftChange}
          onSubmit={onSubmit}
          onEdit={onEdit}
          onDelete={onDelete}
          onCancelEdit={jest.fn()}
        />
      );
    });

    expect(
      renderer!.root
        .findAllByType(Text)
        .some((node) => node.props.children === 'User prefers concise mobile summaries.')
    ).toBe(true);

    act(() => {
      renderer!.root.findByType(TextInput).props.onChangeText('new memory');
    });
    expect(onDraftChange).toHaveBeenCalledWith('new memory');

    act(() => {
      renderer!.root.findByProps({ accessibilityLabel: 'Edit memory' }).props.onPress();
    });
    expect(onEdit).toHaveBeenCalledWith(memory);

    await act(async () => {
      await renderer!.root.findByProps({ accessibilityLabel: 'Delete memory' }).props.onPress();
    });
    expect(onDelete).toHaveBeenCalledWith(memory);

    await act(async () => {
      await renderer!.root.findByProps({ accessibilityLabel: 'Save memory' }).props.onPress();
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('renders subscription details and mapped subscription source states', () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <SubscriptionSection
          billingBalanceQuery={{
            data: {
              creditBalance: 42.5,
              currentPeriodEnd: 1730000000,
            },
            isFetching: true,
          }}
          user={{
            plan: 'free',
            message_count: 21,
            subscription_status: 'inactive',
            current_period_end: '2026-02-14T00:00:00.000Z',
            subscription_source: 'stripe',
          }}
          subscriptionQuery={{
            data: {
              subscription: {
                status: 'active',
                current_period_end: 1730000000,
                subscription_source: 'play_store',
              },
            },
            isFetching: true,
          }}
        />
      );
    });

    const textNodes = renderer!.root.findAllByType(Text).map((node) => String(node.props.children));

    expect(textNodes).toContain('FREE');
    expect(textNodes).toContain('21 used · 0 remaining this week');
    expect(textNodes).toContain('$42.50');
    expect(textNodes).toContain('active');
    expect(textNodes).toContain('Google Play Store');
    expect(textNodes).toContain('Refreshing subscription...');
  });

  it('renders usage limits, model rates, credits, and upgrade action', () => {
    const onPurchasePlan = jest.fn();
    const onManageBilling = jest.fn();
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <UsageSection
          user={{
            plan: 'free',
            message_count: 1,
            current_period_end: '2026-07-12T23:00:00.000Z',
          }}
          billingBalanceQuery={{
            data: {
              creditBalance: 3.5,
              currentPeriodEnd: 1783906800,
            },
            isFetching: false,
          }}
          subscriptionQuery={{
            data: null,
            isFetching: false,
          }}
          isProcessing={false}
          proPriceLabel={'$20'}
          superPriceLabel={'$200'}
          onPurchasePlan={onPurchasePlan as any}
          onManageBilling={onManageBilling}
        />
      );
    });

    const textNodes = renderer!.root.findAllByType(Text).map((node) =>
      Array.isArray(node.props.children)
        ? node.props.children.join('')
        : String(node.props.children)
    );

    expect(textNodes).toContain('Usage limits');
    expect(textNodes).toContain('Weekly task credits');
    expect(textNodes).toContain('100% used');
    expect(textNodes).toContain('1 of 1 used');
    expect(textNodes).toContain('Model cost tiers');
    expect(textNodes).toContain('Sentinel');
    expect(textNodes).toContain('$$');
    expect(textNodes).toContain('$3.50');

    const upgradeButton = renderer!.root
      .findAllByType(TouchableOpacity)
      .find((button) => getButtonText(button) === 'Upgrade');
    act(() => {
      upgradeButton!.props.onPress();
    });

    expect(onPurchasePlan).toHaveBeenCalledWith('pro');
    expect(onManageBilling).not.toHaveBeenCalled();
  });

  it('wires subscription actions for free and paid plans', () => {
    const onPurchasePlan = jest.fn();
    const onRestorePurchases = jest.fn();
    const onManageBilling = jest.fn();

    let freeRenderer: TestRenderer.ReactTestRenderer;
    act(() => {
      freeRenderer = TestRenderer.create(
        <SubscriptionActions
          userPlan={'free'}
          isProcessing={false}
          proPriceLabel={'$20'}
          superPriceLabel={'$50'}
          onPurchasePlan={onPurchasePlan as any}
          onRestorePurchases={onRestorePurchases}
          onManageBilling={onManageBilling}
        />
      );
    });

    const freeButtons = freeRenderer!.root.findAllByType(TouchableOpacity);
    const proButton = freeButtons.find((button) => getButtonText(button) === 'Subscribe to Pro');
    const superButton = freeButtons.find((button) => getButtonText(button) === 'Subscribe to Super');
    const freeRestoreButton = freeButtons.find(
      (button) => getButtonText(button) === 'Restore Purchases'
    );
    const billingButton = freeButtons.find(
      (button) => getButtonText(button) === 'Manage Billing'
    );

    act(() => {
      proButton!.props.onPress();
      superButton!.props.onPress();
      freeRestoreButton!.props.onPress();
      billingButton!.props.onPress();
    });

    expect(onPurchasePlan).toHaveBeenCalledWith('pro');
    expect(onPurchasePlan).toHaveBeenCalledWith('super');
    expect(onRestorePurchases).toHaveBeenCalledTimes(1);
    expect(onManageBilling).toHaveBeenCalledTimes(1);
    const freeTextNodes = freeRenderer!.root.findAllByType(Text).map((node) =>
      Array.isArray(node.props.children)
        ? node.props.children.join('')
        : String(node.props.children)
    );
    expect(freeTextNodes).toContain('Billed $20 monthly');
    expect(freeTextNodes).toContain('Billed $50 monthly');
    expect(freeTextNodes.some((text) => text.includes('The billed amount shown above'))).toBe(true);

    let paidRenderer: TestRenderer.ReactTestRenderer;
    act(() => {
      paidRenderer = TestRenderer.create(
        <SubscriptionActions
          userPlan={'pro'}
          isProcessing={false}
          proPriceLabel={null}
          superPriceLabel={null}
          onPurchasePlan={onPurchasePlan as any}
          onRestorePurchases={onRestorePurchases}
          onManageBilling={onManageBilling}
        />
      );
    });

    const restoreButton = paidRenderer!.root
      .findAllByType(TouchableOpacity)
      .find((button) => getButtonText(button) === 'Restore Purchases');

    act(() => {
      restoreButton!.props.onPress();
    });

    expect(onRestorePurchases).toHaveBeenCalledTimes(2);
  });

  it('renders storage usage and category summaries', () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <StorageSection
          summary={{
            usedBytes: 19_000_000,
            quotaBytes: 40_000_000_000,
            categories: [
              { id: 'files', label: 'Files', bytes: 105_000, count: 1 },
              { id: 'images', label: 'Images', bytes: 18_900_000, count: 45 },
            ],
          }}
          loading={false}
          error={null}
          onRetry={jest.fn()}
        />
      );
    });

    const textNodes = renderer!.root.findAllByType(Text).map((node) => String(node.props.children));

    expect(textNodes).toContain('19 MB of 40 GB used');
    expect(textNodes).toContain('Files');
    expect(textNodes).toContain('105 KB - 1 file');
    expect(textNodes).toContain('Images');
    expect(textNodes).toContain('18.9 MB - 45 images');
  });

  it('wires storage retry on load failures', () => {
    const onRetry = jest.fn();
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <StorageSection
          summary={null}
          loading={false}
          error="Failed to load storage usage"
          onRetry={onRetry}
        />
      );
    });

    const retryButton = renderer!.root
      .findAllByType(TouchableOpacity)
      .find((button) => getButtonText(button) === 'Retry');

    expect(retryButton).toBeDefined();

    act(() => {
      retryButton!.props.onPress();
    });

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
