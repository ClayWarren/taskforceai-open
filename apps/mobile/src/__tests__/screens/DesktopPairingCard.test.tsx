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
const mockReadDesktopPairingSession = jest.fn(async () => null);
const mockSaveDesktopPairingSession = jest.fn(async () => undefined);
const mockClearDesktopPairingSession = jest.fn(async () => undefined);

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
  };
});

jest.mock('../../desktop-pairing/session-store', () => ({
  readDesktopPairingSession: () => mockReadDesktopPairingSession(),
  saveDesktopPairingSession: (session: unknown) => mockSaveDesktopPairingSession(session),
  clearDesktopPairingSession: () => mockClearDesktopPairingSession(),
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
  });

  it('pairs with a pasted desktop payload', async () => {
    const { getByLabelText, getByText } = render(<DesktopPairingCard />);

    fireEvent.changeText(
      getByLabelText('Desktop pairing payload'),
      JSON.stringify({ baseUrl: 'http://127.0.0.1:7319', pairingCode: 'pair-me' })
    );
    fireEvent.press(getByText('Pair with Desktop'));

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

  it('restores and pings a saved desktop session', async () => {
    mockReadDesktopPairingSession.mockResolvedValue(storedSession);
    const { getByText } = render(<DesktopPairingCard />);

    await waitFor(() => {
      expect(mockPingDesktopAppServer).toHaveBeenCalledWith(storedSession);
    });
    expect(getByText('connected')).toBeTruthy();
    expect(getByText('Connected to http://127.0.0.1:7319')).toBeTruthy();
  });

  it('reports stale saved desktop sessions', async () => {
    mockReadDesktopPairingSession.mockResolvedValue(storedSession);
    mockPingDesktopAppServer.mockRejectedValue(new Error('Desktop ping failed with status 401'));
    const { getByText } = render(<DesktopPairingCard />);

    await waitFor(() => {
      expect(getByText('Desktop ping failed with status 401')).toBeTruthy();
    });
    expect(getByText('error')).toBeTruthy();
  });

  it('disconnects a saved desktop session', async () => {
    mockReadDesktopPairingSession.mockResolvedValue(storedSession);
    const { getByText, queryByText } = render(<DesktopPairingCard />);

    await waitFor(() => {
      expect(getByText('Disconnect Desktop')).toBeTruthy();
    });
    fireEvent.press(getByText('Disconnect Desktop'));

    await waitFor(() => {
      expect(mockClearDesktopPairingSession).toHaveBeenCalledTimes(1);
    });
    expect(queryByText('Connected to http://127.0.0.1:7319')).toBeNull();
  });

  it('prefills a desktop pairing deep link', () => {
    const link = 'taskforceai://desktop-pairing?payload=%7B%7D';
    const { getByDisplayValue } = render(<DesktopPairingCard initialPayload={link} />);

    expect(getByDisplayValue(link)).toBeTruthy();
  });

  it('shows parser errors', async () => {
    const { getByLabelText, getByText } = render(<DesktopPairingCard />);

    fireEvent.changeText(getByLabelText('Desktop pairing payload'), 'not a link');
    fireEvent.press(getByText('Pair with Desktop'));

    await waitFor(() => {
      expect(getByText('Desktop pairing payload is not a valid link.')).toBeTruthy();
    });
    expect(mockPairWithDesktopAppServer).not.toHaveBeenCalled();
  });
});
