import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { DesktopPairingCard } from '../../screens/settings/sections/DesktopPairingCard';

const mockPairWithDesktopAppServer = jest.fn(async () => ({
  baseUrl: 'http://127.0.0.1:7319',
  rpcPath: '/rpc',
  sessionToken: 'session-token',
  transport: { kind: 'http', encoding: 'json' },
}));
const mockPingDesktopAppServer = jest.fn(async () => ({ ok: true }));
const mockRevokeDesktopPairingSession = jest.fn(async () => undefined);
const mockReadDesktopPairingSession = jest.fn(async () => null);
const mockSaveDesktopPairingSession = jest.fn(async () => undefined);
const mockClearDesktopPairingSession = jest.fn(async () => undefined);
const mockReadDesktopPairingHosts = jest.fn(async () => []);
const mockSelectDesktopPairingHost = jest.fn(async () => storedSession);
const mockSyncStoredPushTokenWithDesktop = jest.fn(async () => undefined);

const storedSession = {
  baseUrl: 'http://127.0.0.1:7319',
  rpcPath: '/rpc',
  sessionToken: 'session-token',
  transport: { kind: 'http', encoding: 'json' },
};

jest.mock('../../desktop-pairing/client', () => {
  const actual = jest.requireActual('../../desktop-pairing/client');
  return {
    ...actual,
    pairWithDesktopAppServer: (...args: unknown[]) => mockPairWithDesktopAppServer(...args),
    pingDesktopAppServer: (...args: unknown[]) => mockPingDesktopAppServer(...args),
    revokeDesktopPairingSession: (...args: unknown[]) =>
      mockRevokeDesktopPairingSession(...args),
  };
});

jest.mock('../../desktop-pairing/session-store', () => ({
  readDesktopPairingSession: () => mockReadDesktopPairingSession(),
  saveDesktopPairingSession: (session: unknown) => mockSaveDesktopPairingSession(session),
  clearDesktopPairingSession: () => mockClearDesktopPairingSession(),
  readDesktopPairingHosts: () => mockReadDesktopPairingHosts(),
  selectDesktopPairingHost: (hostId: string) => mockSelectDesktopPairingHost(hostId),
}));

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
            props.onBarcodeScanned({
              data: 'taskforceai://desktop-pairing?baseUrl=http%3A%2F%2F127.0.0.1%3A7319&pairingCode=qr-code',
            }),
        },
        react.createElement(Text, null, 'Camera')
      ),
    useCameraPermissions: () => [{ granted: true }, jest.fn(async () => ({ granted: true }))],
  };
});

jest.mock('../../notifications/registration', () => ({
  syncStoredPushTokenWithDesktop: () => mockSyncStoredPushTokenWithDesktop(),
}));

jest.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      colors: {
        textMuted: '#9ca3af',
      },
    },
  }),
}));

jest.mock('../../components/ActionButton', () => ({
  ActionButton: ({ children, onPress, disabled, isLoading }: any) => {
    const react = require('react');
    const { Text, TouchableOpacity } = require('react-native');
    return react.createElement(
      TouchableOpacity,
      { onPress, disabled: disabled || isLoading, accessibilityRole: 'button' },
      react.createElement(Text, null, isLoading ? 'Loading' : children)
    );
  },
}));

describe('DesktopPairingCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadDesktopPairingSession.mockResolvedValue(null);
    mockPingDesktopAppServer.mockResolvedValue({ ok: true });
    mockClearDesktopPairingSession.mockResolvedValue(undefined);
    mockRevokeDesktopPairingSession.mockResolvedValue(undefined);
    mockReadDesktopPairingHosts.mockResolvedValue([]);
  });

  it('pairs with a pasted desktop payload', async () => {
    const { getByLabelText, getByText } = await render(<DesktopPairingCard />);

    await fireEvent.changeText(
      getByLabelText('Desktop pairing payload'),
      JSON.stringify({ baseUrl: 'http://127.0.0.1:7319', pairingCode: 'pair-me' })
    );
    await fireEvent.press(getByText('Pair with Desktop'));

    await waitFor(() => {
      expect(mockPairWithDesktopAppServer).toHaveBeenCalledWith({
        baseUrl: 'http://127.0.0.1:7319',
        pairingCode: 'pair-me',
      });
    });
    await waitFor(() => {
      expect(getByText('connected')).toBeTruthy();
      expect(getByText('Connected to http://127.0.0.1:7319')).toBeTruthy();
      expect(
        getByText('Desktop pairing is using plain HTTP. Only continue on a trusted local network.')
      ).toBeTruthy();
      expect(mockSaveDesktopPairingSession).toHaveBeenCalledWith(storedSession);
    });
  });

  it('pairs with a desktop address and manual pairing code', async () => {
    const { getByLabelText, getByText } = await render(<DesktopPairingCard />);
    await fireEvent.changeText(getByLabelText('Desktop pairing address'), 'https://office-mac.example:7319');
    await fireEvent.changeText(getByLabelText('Desktop manual pairing code'), '123456');
    await fireEvent.press(getByText('Pair with Desktop'));
    await waitFor(() =>
      expect(mockPairWithDesktopAppServer).toHaveBeenCalledWith({
        baseUrl: 'https://office-mac.example:7319',
        pairingCode: '123456',
      })
    );
  });

  it('captures a desktop pairing link from the QR scanner', async () => {
    const { getByDisplayValue, getByLabelText } = await render(<DesktopPairingCard />);
    await fireEvent.press(getByLabelText('Scan desktop pairing QR code'));
    await fireEvent.press(getByLabelText('Mock QR capture'));
    expect(
      getByDisplayValue(
        'taskforceai://desktop-pairing?baseUrl=http%3A%2F%2F127.0.0.1%3A7319&pairingCode=qr-code'
      )
    ).toBeTruthy();
  });

  it('restores and pings a saved desktop session', async () => {
    mockReadDesktopPairingSession.mockResolvedValue(storedSession);
    const { getByText } = await render(<DesktopPairingCard />);

    await waitFor(() => {
      expect(mockPingDesktopAppServer).toHaveBeenCalledWith(storedSession);
    });
    expect(getByText('connected')).toBeTruthy();
    expect(getByText('Connected to http://127.0.0.1:7319')).toBeTruthy();
  });

  it('reports stale saved desktop sessions', async () => {
    mockReadDesktopPairingSession.mockResolvedValue(storedSession);
    mockPingDesktopAppServer.mockRejectedValue(new Error('Desktop ping failed with status 401'));
    const { getByText } = await render(<DesktopPairingCard />);

    await waitFor(() => {
      expect(getByText('Desktop ping failed with status 401')).toBeTruthy();
    });
    expect(getByText('error')).toBeTruthy();
  });

  it('reports saved-session read failures', async () => {
    mockReadDesktopPairingSession.mockRejectedValue(new Error('Secure storage is unavailable'));
    const { getByText } = await render(<DesktopPairingCard />);

    await waitFor(() => {
      expect(getByText('Secure storage is unavailable')).toBeTruthy();
    });
    expect(getByText('error')).toBeTruthy();
  });

  it('disconnects a saved desktop session', async () => {
    mockReadDesktopPairingSession
      .mockResolvedValueOnce(storedSession)
      .mockResolvedValueOnce(null);
    const { getByText, queryByText } = await render(<DesktopPairingCard />);

    await waitFor(() => {
      expect(getByText('Disconnect Desktop')).toBeTruthy();
    });
    await fireEvent.press(getByText('Disconnect Desktop'));

    await waitFor(() => {
      expect(mockClearDesktopPairingSession).toHaveBeenCalledTimes(1);
    });
    expect(mockRevokeDesktopPairingSession).toHaveBeenCalledWith(storedSession);
    expect(queryByText('Connected to http://127.0.0.1:7319')).toBeNull();
  });

  it('keeps a saved session visible when clearing it fails', async () => {
    mockReadDesktopPairingSession.mockResolvedValue(storedSession);
    mockClearDesktopPairingSession.mockRejectedValue(new Error('Secure storage write failed'));
    const { getByText } = await render(<DesktopPairingCard />);

    await waitFor(() => expect(getByText('Disconnect Desktop')).toBeTruthy());
    await fireEvent.press(getByText('Disconnect Desktop'));

    await waitFor(() => expect(getByText('Secure storage write failed')).toBeTruthy());
    expect(getByText('Connected to http://127.0.0.1:7319')).toBeTruthy();
  });

  it('prefills a desktop pairing deep link', async () => {
    const link = 'taskforceai://desktop-pairing?payload=%7B%7D';
    const { getByDisplayValue } = await render(<DesktopPairingCard initialPayload={link} />);

    expect(getByDisplayValue(link)).toBeTruthy();
  });

  it('shows parser errors', async () => {
    const { getByLabelText, getByText } = await render(<DesktopPairingCard />);

    await fireEvent.changeText(getByLabelText('Desktop pairing payload'), 'not a link');
    await fireEvent.press(getByText('Pair with Desktop'));

    await waitFor(() => {
      expect(getByText('Desktop pairing payload is not a valid link.')).toBeTruthy();
    });
    expect(mockPairWithDesktopAppServer).not.toHaveBeenCalled();
  });
});
