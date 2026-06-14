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
const mockUser = {
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
  is_admin: 'false',
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
    setNotificationsEnabled: jest.fn(async () => undefined),
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
  ensurePushRegistration: jest.fn(async () => ({ status: 'granted', token: 'token-123' })),
  unregisterPushNotifications: jest.fn(async () => undefined),
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
  });

  it('navigates into a section and back to the root list', async () => {
    const { getByText, getByLabelText, queryByText } = render(
      <SettingsScreen visible={true} onClose={jest.fn()} />
    );

    expect(getByText('General')).toBeTruthy();
    fireEvent.press(getByText('General'));

    expect(getByText('General Section')).toBeTruthy();
    expect(queryByText('Edit profile')).toBeNull();

    fireEvent.press(getByLabelText('Back'));
    expect(getByText('Edit profile')).toBeTruthy();
  });

  it('opens storage settings from the root list', async () => {
    const { getByText } = render(<SettingsScreen visible={true} onClose={jest.fn()} />);

    fireEvent.press(getByText('Storage'));

    expect(getByText('19 MB of 40 GB used')).toBeTruthy();
    expect(getByText('105 KB - 1 file')).toBeTruthy();
    expect(getByText('18.9 MB - 45 images')).toBeTruthy();
  });

  it('opens connected apps when a desktop pairing payload is pending', async () => {
    const { getByText, getByDisplayValue } = render(
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
    const { getByText, getByDisplayValue, getByPlaceholderText } = render(
      <SettingsScreen visible={true} onClose={jest.fn()} />
    );

    expect(getByText('Jane Doe')).toBeTruthy();
    expect(getByText('JD')).toBeTruthy();

    fireEvent.press(getByText('General'));

    expect(getByDisplayValue('Jane Doe')).toBeTruthy();
    const input = getByPlaceholderText('Enter your full name');
    fireEvent.changeText(input, 'Jane Cooper');
    fireEvent.press(getByText('Save name'));

    await waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalledWith({ full_name: 'Jane Cooper' });
    });
  });

  it('calls onClose when close button is pressed', async () => {
    const onClose = jest.fn();
    const { getByLabelText } = render(<SettingsScreen visible={true} onClose={onClose} />);

    fireEvent.press(getByLabelText('Close settings'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows validation alert and prevents saving blank full name', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    const { getByText, getByPlaceholderText } = render(
      <SettingsScreen visible={true} onClose={jest.fn()} />
    );

    fireEvent.press(getByText('General'));

    const input = getByPlaceholderText('Enter your full name');
    fireEvent.changeText(input, '   ');
    fireEvent.press(getByText('Save name'));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('Name required', 'Please enter your full name before saving.');
    });
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it('does not call update when full name is unchanged', async () => {
    mockUser.full_name = 'Jane Doe';

    const { getByText } = render(<SettingsScreen visible={true} onClose={jest.fn()} />);

    fireEvent.press(getByText('General'));
    fireEvent.press(getByText('Save name'));

    await waitFor(() => {
      expect(mockUpdateSettings).not.toHaveBeenCalled();
    });
  });
});
