import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { DesktopPairingCard } from '../../screens/settings/sections/DesktopPairingCard';

const storedSession = {
  baseUrl: 'https://remote.taskforceai/device/mac-1',
  rpcPath: '/rpc',
  sessionToken: 'account-scoped',
  sessionScope: 'mobile-control' as const,
  transport: { kind: 'relay', encoding: 'json' },
  targetDeviceId: 'mac-1',
  controllerDeviceId: 'phone-1',
  deviceCredential: 'a'.repeat(64),
  machineName: 'Clay’s Mac',
};

const target = {
  deviceId: 'mac-1',
  deviceName: 'Clay’s Mac',
  allowConnections: true,
  keepAwake: true,
  lastSeenAt: '2026-07-13T08:00:00Z',
};

const mockPairWithRemoteCode = jest.fn(async () => storedSession);
const mockPingDesktopAppServer = jest.fn(async () => ({ ok: true }));
const mockReadDesktopPairingSession = jest.fn(async () => null as typeof storedSession | null);
const mockSaveDesktopPairingSession = jest.fn(async () => undefined);
const mockClearDesktopPairingSession = jest.fn(async () => undefined);
const mockListRemoteConnections = jest.fn(async () => [target]);
const mockGetDeviceId = jest.fn(async () => 'phone-1');
const mockSyncStoredPushTokenWithDesktop = jest.fn(async () => undefined);

jest.mock('../../desktop-pairing/client', () => ({
  pairWithRemoteCode: (...args: unknown[]) => mockPairWithRemoteCode(...args),
  pingDesktopAppServer: (...args: unknown[]) => mockPingDesktopAppServer(...args),
}));

jest.mock('../../desktop-pairing/remote-credential', () => ({
  readOrCreateRemoteDeviceCredential: async () => 'a'.repeat(64),
}));

jest.mock('../../desktop-pairing/session-store', () => ({
  readDesktopPairingSession: () => mockReadDesktopPairingSession(),
  saveDesktopPairingSession: (...args: unknown[]) => mockSaveDesktopPairingSession(...args),
  clearDesktopPairingSession: () => mockClearDesktopPairingSession(),
}));

jest.mock('../../api/client', () => ({
  getMobileClient: () => ({ listRemoteConnections: mockListRemoteConnections }),
}));

jest.mock('../../storage/sqlite-adapter', () => ({
  sqliteStorage: { getDeviceId: () => mockGetDeviceId() },
}));

jest.mock('../../notifications/registration', () => ({
  syncStoredPushTokenWithDesktop: () => mockSyncStoredPushTokenWithDesktop(),
}));

jest.mock('expo-device', () => ({ deviceName: 'Clay’s iPhone' }));

jest.mock('expo-camera', () => {
  const react = require('react');
  const { Text, TouchableOpacity } = require('react-native');
  return {
    CameraView: (props: any) =>
      react.createElement(
        TouchableOpacity,
        {
          accessibilityLabel: 'Mock QR capture',
          onPress: () =>
            props.onBarcodeScanned({ data: 'taskforceai://remote/pair?code=ABCD-EFGH' }),
        },
        react.createElement(Text, null, 'Camera')
      ),
    useCameraPermissions: () => [{ granted: true }, jest.fn(async () => ({ granted: true }))],
  };
});

jest.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      colors: { border: '#374151', text: '#f9fafb', textMuted: '#9ca3af' },
    },
  }),
}));

jest.mock('../../components/ActionButton', () => ({
  ActionButton: ({ children, onPress, disabled, isLoading, ...props }: any) => {
    const react = require('react');
    const { Text, TouchableOpacity } = require('react-native');
    return react.createElement(
      TouchableOpacity,
      { ...props, onPress, disabled: disabled || isLoading, accessibilityRole: 'button' },
      react.createElement(Text, null, isLoading ? 'Loading' : children)
    );
  },
}));

describe('DesktopPairingCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadDesktopPairingSession.mockResolvedValue(null);
    mockListRemoteConnections.mockResolvedValue([target]);
    mockPairWithRemoteCode.mockResolvedValue(storedSession);
  });

  it('loads account-scoped Macs and connects with a one-time code', async () => {
    const { getByLabelText, getByText } = await render(<DesktopPairingCard />);

    await waitFor(() => expect(getByText('Clay’s Mac')).toBeTruthy());
    await fireEvent.changeText(getByLabelText('Remote connection code'), 'ABCD-EFGH');
    await fireEvent.press(getByLabelText('Connect with Remote code'));

    await waitFor(() =>
      expect(mockPairWithRemoteCode).toHaveBeenCalledWith({
        code: 'ABCD-EFGH',
        controllerDeviceId: 'phone-1',
        controllerName: 'Clay’s iPhone',
      })
    );
    expect(mockSaveDesktopPairingSession).toHaveBeenCalledWith(storedSession, 'Clay’s Mac');
    expect(mockSyncStoredPushTokenWithDesktop).toHaveBeenCalledTimes(1);
  });

  it('renders the Remote code input without NativeWind style mapping', async () => {
    const { getByLabelText } = await render(<DesktopPairingCard />);

    const input = getByLabelText('Remote connection code');
    expect(input.props.className).toBeUndefined();
    expect(input.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ flex: 1, minWidth: 0, textAlign: 'center' }),
        expect.objectContaining({ borderColor: '#374151', color: '#f9fafb' }),
      ])
    );
  });

  it('captures a Remote code from the QR scanner', async () => {
    const { getByDisplayValue, getByLabelText } = await render(<DesktopPairingCard />);

    await fireEvent.press(getByLabelText('Scan Remote connection QR code'));
    await fireEvent.press(getByLabelText('Mock QR capture'));

    expect(getByDisplayValue('ABCD-EFGH')).toBeTruthy();
  });

  it('restores a saved Mac and disconnects only the active local selection', async () => {
    mockReadDesktopPairingSession
      .mockResolvedValueOnce(storedSession)
      .mockResolvedValueOnce(null);
    const { getByText, queryByText } = await render(<DesktopPairingCard />);

    await waitFor(() => expect(getByText('Disconnect')).toBeTruthy());
    await fireEvent.press(getByText('Disconnect'));

    await waitFor(() => expect(mockClearDesktopPairingSession).toHaveBeenCalledTimes(1));
    expect(queryByText('Available in Remote')).toBeNull();
  });

  it('connects to an existing paired Mac', async () => {
    const { getByLabelText } = await render(<DesktopPairingCard />);

    const mac = await waitFor(() => getByLabelText('Connect to Clay’s Mac'));
    await fireEvent.press(mac);

    await waitFor(() => expect(mockPingDesktopAppServer).toHaveBeenCalled());
    expect(mockSaveDesktopPairingSession).toHaveBeenCalledWith(
      expect.objectContaining({ targetDeviceId: 'mac-1', controllerDeviceId: 'phone-1' }),
      'Clay’s Mac'
    );
    expect(mockSyncStoredPushTokenWithDesktop).toHaveBeenCalledTimes(1);
  });

  it('prefills a Remote deep link and reports connection-list failures', async () => {
    mockListRemoteConnections.mockRejectedValue(new Error('Remote relay unavailable'));
    const { getByDisplayValue, getByText } = await render(
      <DesktopPairingCard initialPayload="taskforceai://remote/pair?code=WXYZ-2345" />
    );

    expect(getByDisplayValue('WXYZ-2345')).toBeTruthy();
    await waitFor(() => expect(getByText('Remote relay unavailable')).toBeTruthy());
  });

  it('treats an unregistered controller credential as an empty first-pairing state', async () => {
    mockListRemoteConnections.mockRejectedValue(
      Object.assign(new Error('Remote device is not authorized'), { status: 403 })
    );
    const { queryByText } = await render(<DesktopPairingCard />);

    await waitFor(() => expect(mockListRemoteConnections).toHaveBeenCalled());
    expect(queryByText('Remote device is not authorized')).toBeNull();
  });
});
