import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native/pure';
import { Alert } from 'react-native';

import { SettingsScreen } from '../../screens/SettingsScreen';

const mockRefreshUser = jest.fn(async () => undefined);
const mockUpdateSettings = jest.fn(async () => ({ ok: true }));
const mockSaveProfile = jest.fn(async () => ({ ok: true }));
const mockListArchivedConversations = jest.fn(async () => ({ ok: true, value: [] }));
const mockRestoreConversation = jest.fn(async () => undefined);
const mockClearConversation = jest.fn(async () => undefined);
const mockArchiveAllConversations = jest.fn(async () => undefined);
const mockDeleteAllConversations = jest.fn(async () => undefined);
const mockSetNotificationsEnabled = jest.fn(async () => undefined);
const mockEnsurePushRegistration = jest.fn(async () => ({
  status: 'granted' as const,
  token: 'token-123',
}));
const mockUnregisterPushNotifications = jest.fn(async () => undefined);
const mockUser: any = {
  id: 'user-1',
  email: 'jane_doe@example.com',
  full_name: '',
  plan: 'free',
  message_count: 0,
  subscription_status: null,
  current_period_end: null,
  subscription_source: null,
  memory_enabled: true,
  web_search_enabled: true,
  code_execution_enabled: true,
  trust_layer_enabled: false,
  is_admin: false,
};
const mockAuthValue = {
  user: mockUser,
  refreshUser: mockRefreshUser,
};

jest.mock('../../api/client', () => ({
  getMobileClient: () => ({
    updateSettings: mockUpdateSettings,
    getIntegrations: jest.fn(async () => []),
    disconnectIntegration: jest.fn(async () => undefined),
  }),
}));

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => mockAuthValue,
}));

jest.mock('../../contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    notificationsEnabled: false,
    setNotificationsEnabled: mockSetNotificationsEnabled,
    hasLoadedPreferences: true,
  }),
}));

jest.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      colors: {
        background: '#000000',
        text: '#ffffff',
        textMuted: '#9ca3af',
        border: '#1f2937',
        cardBackground: '#0f172a',
        error: '#ef4444',
        inputBackground: '#111827',
        userBubble: '#2563eb',
        white: '#ffffff',
        primary: '#2563eb',
      },
    },
    isDarkMode: true,
    setThemeMode: jest.fn(async () => undefined),
  }),
}));

jest.mock('../../contexts/SyncContext', () => ({
  useSync: () => ({
    sync: jest.fn(async () => undefined),
    syncState: { lastSyncTime: 0, lastStats: null },
  }),
}));

jest.mock('../../hooks/usePurchases', () => ({
  usePurchases: () => ({
    purchasePlan: jest.fn(),
    restorePurchases: jest.fn(),
    isProcessing: false,
  }),
}));

jest.mock('../../hooks/useProfileActions', () => ({
  useProfileActions: () => ({
    handleLogout: jest.fn(),
    handleDataExport: jest.fn(async () => undefined),
    handleDeleteAccount: jest.fn(),
    openBillingPortal: jest.fn(),
    openPrivacyPolicy: jest.fn(),
    openTermsOfService: jest.fn(),
    openSupportContact: jest.fn(),
    isAccountActionLoading: false,
  }),
}));

jest.mock('../../hooks/api/subscription', () => ({
  useBillingBalanceQuery: () => ({ data: null, isFetching: false }),
  useSubscriptionQuery: () => ({ data: null, isFetching: false }),
  useProductsQuery: () => ({ data: null, isFetching: false }),
}));

jest.mock('../../hooks/api/storage', () => ({
  useStorageSummaryQuery: () => ({
    data: {
      usedBytes: 19_000_000,
      quotaBytes: 40_000_000_000,
      categories: [
        { id: 'files', label: 'Files', bytes: 105_000, count: 1 },
        { id: 'images', label: 'Images', bytes: 18_900_000, count: 45 },
      ],
    },
    isFetching: false,
    error: null,
    refetch: jest.fn(),
  }),
}));

jest.mock('../../storage/sqlite-adapter', () => ({
  sqliteStorage: {
    saveProfile: mockSaveProfile,
  },
}));

jest.mock('../../storage/chat-local-mobile', () => ({
  archiveAllConversations: (...args: unknown[]) => mockArchiveAllConversations(...args),
  clearConversation: (...args: unknown[]) => mockClearConversation(...args),
  deleteAllConversations: (...args: unknown[]) => mockDeleteAllConversations(...args),
  listArchivedConversations: (...args: unknown[]) => mockListArchivedConversations(...args),
  restoreConversation: (...args: unknown[]) => mockRestoreConversation(...args),
}));

jest.mock('../../screens/settings/sections/GeneralSection', () => {
  const reactModule = require('react');
  const { Text, TextInput, TouchableOpacity } = require('react-native');
  return {
    GeneralSection: ({
      editableName,
      onEditableNameChange,
      onSaveName,
    }: {
      editableName: string;
      onEditableNameChange: (value: string) => void;
      onSaveName: () => Promise<void>;
    }) =>
      reactModule.createElement(
        reactModule.Fragment,
        null,
        reactModule.createElement(Text, null, 'General Section'),
        reactModule.createElement(TextInput, {
          value: editableName,
          placeholder: 'Enter your full name',
          onChangeText: onEditableNameChange,
        }),
        reactModule.createElement(
          TouchableOpacity,
          {
            onPress: async () => {
              await onSaveName();
            },
          },
          reactModule.createElement(Text, null, 'Save name')
        )
      ),
    AppearanceSection: () => reactModule.createElement(Text, null, 'Appearance Section'),
  };
});

jest.mock('../../screens/settings/useSettingsIntegrations', () => ({
  useSettingsIntegrations: () => ({
    integrations: [],
    loadingIntegrations: false,
    integrationActionProvider: null,
    mcpServers: [],
    pendingMcpName: '',
    setPendingMcpName: jest.fn(),
    pendingMcpEndpoint: '',
    setPendingMcpEndpoint: jest.fn(),
    mcpActionServer: null,
    handleConnectIntegration: jest.fn(),
    handleDisconnectIntegration: jest.fn(),
    handleAddMcpServer: jest.fn(),
    handleRemoveMcpServer: jest.fn(),
    handleInspectMcpServer: jest.fn(),
  }),
}));

jest.mock('../../notifications/registration', () => ({
  ensurePushRegistration: (...args: unknown[]) => mockEnsurePushRegistration(...args),
  unregisterPushNotifications: (...args: unknown[]) => mockUnregisterPushNotifications(...args),
}));

jest.mock('../../logger', () => ({
  createModuleLogger: () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
  }),
}));

jest.mock('react-i18next', () =>
  require('../helpers/mock-modules').createTranslationMockModule()
);

describe('SettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser.full_name = '';
    mockUser.plan = 'free';
    mockUser.email = 'jane_doe@example.com';
    mockUser.message_count = 0;
    mockUser.current_period_end = null;
  });

  it('navigates into a section and back to the root list', async () => {
    const { getByText, getByLabelText, queryByText } = await render(
      <SettingsScreen visible={true} onClose={jest.fn()} />
    );

    expect(getByText('General')).toBeTruthy();
    await fireEvent.press(getByText('General'));

    expect(getByText('General Section')).toBeTruthy();
    expect(queryByText('Edit profile')).toBeNull();

    await fireEvent.press(getByLabelText('Back'));
    expect(getByText('Edit profile')).toBeTruthy();
  });

  it('opens storage settings from the root list', async () => {
    const { getByText } = await render(<SettingsScreen visible={true} onClose={jest.fn()} />);

    await fireEvent.press(getByText('Storage'));

    expect(getByText('19 MB of 40 GB used')).toBeTruthy();
    expect(getByText('105 KB - 1 file')).toBeTruthy();
    expect(getByText('18.9 MB - 45 images')).toBeTruthy();
  });

  it('opens usage settings from the root list', async () => {
    mockUser.plan = 'pro';
    mockUser.message_count = 12;
    mockUser.current_period_end = '2026-07-12T23:00:00.000Z';
    const { getByText } = await render(<SettingsScreen visible={true} onClose={jest.fn()} />);

    await fireEvent.press(getByText('Usage'));

    expect(getByText('Usage limits')).toBeTruthy();
    expect(getByText('Plan throughput')).toBeTruthy();
    expect(getByText('2 messages per hour')).toBeTruthy();
    expect(getByText('Metered by throughput')).toBeTruthy();
    expect(getByText('Model usage rates')).toBeTruthy();
  });

  it('rolls back push registration when enabling notifications fails remotely', async () => {
    mockUpdateSettings.mockResolvedValueOnce({ ok: false, error: new Error('settings offline') });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByLabelText, getByText } = await render(
      <SettingsScreen visible={true} onClose={jest.fn()} />
    );

    await fireEvent.press(getByText('Notifications'));
    await fireEvent.press(getByLabelText('Tasks notifications: Off'));

    await waitFor(() => {
      expect(mockEnsurePushRegistration).toHaveBeenCalledWith({ promptUser: true });
      expect(mockUpdateSettings).toHaveBeenCalledWith({ notifications_enabled: true });
      expect(mockSetNotificationsEnabled).toHaveBeenCalledWith(false);
      expect(mockUnregisterPushNotifications).toHaveBeenCalledTimes(1);
    });
    alertSpy.mockRestore();
  });

  it('opens connected apps when a desktop pairing payload is pending', async () => {
    const { getByText, getByDisplayValue } = await render(
      <SettingsScreen
        visible={true}
        onClose={jest.fn()}
        desktopPairingPayload="taskforceai://desktop-pairing?payload=%7B%7D"
      />
    );

    expect(getByText('Desktop pairing')).toBeTruthy();
    expect(getByDisplayValue('taskforceai://desktop-pairing?payload=%7B%7D')).toBeTruthy();
  });

  it('shows inferred profile name and saves full name updates', async () => {
    const { getByText, getByDisplayValue, getByPlaceholderText } = await render(
      <SettingsScreen visible={true} onClose={jest.fn()} />
    );

    expect(getByText('Jane Doe')).toBeTruthy();
    expect(getByText('JD')).toBeTruthy();

    await fireEvent.press(getByText('General'));

    expect(getByDisplayValue('Jane Doe')).toBeTruthy();
    const input = getByPlaceholderText('Enter your full name');
    await fireEvent.changeText(input, 'Jane Cooper');
    await fireEvent.press(getByText('Save name'));

    await waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalledWith({ full_name: 'Jane Cooper' });
    });
  });

  it('calls onClose when close button is pressed', async () => {
    const onClose = jest.fn();
    const { getByLabelText } = await render(<SettingsScreen visible={true} onClose={onClose} />);

    await fireEvent.press(getByLabelText('Close settings'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows validation alert and prevents saving blank full name', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    const { getByText, getByPlaceholderText } = await render(
      <SettingsScreen visible={true} onClose={jest.fn()} />
    );

    await fireEvent.press(getByText('General'));

    const input = getByPlaceholderText('Enter your full name');
    await fireEvent.changeText(input, '   ');
    await fireEvent.press(getByText('Save name'));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('Name required', 'Please enter your full name before saving.');
    });
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it('does not call update when full name is unchanged', async () => {
    mockUser.full_name = 'Jane Doe';

    const { getByText } = await render(<SettingsScreen visible={true} onClose={jest.fn()} />);

    await fireEvent.press(getByText('General'));
    await fireEvent.press(getByText('Save name'));

    await waitFor(() => {
      expect(mockUpdateSettings).not.toHaveBeenCalled();
    });
  });
});
