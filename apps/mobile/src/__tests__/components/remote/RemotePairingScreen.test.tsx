import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import { RemotePairingScreen } from '../../../features/desktop-work/components/RemotePairingScreen';

const mockCompleteRemotePairing = jest.fn(async () => ({ machineName: 'Clay’s Mac' }));

jest.mock('../../../features/desktop-work/pairing/complete-pairing', () => {
  const actual = jest.requireActual('../../../features/desktop-work/pairing/complete-pairing');
  return {
    ...actual,
    completeRemotePairing: (...args: unknown[]) => mockCompleteRemotePairing(...args),
  };
});

jest.mock('expo-camera', () => {
  const react = require('react');
  const { Text, TouchableOpacity } = require('react-native');
  return {
    CameraView: (props: { onBarcodeScanned: (_event: { data: string }) => void }) =>
      react.createElement(
        TouchableOpacity,
        {
          accessibilityLabel: 'Mock Remote QR code',
          onPress: () =>
            props.onBarcodeScanned({
              data: 'taskforceai://remote/pair?code=ABCD-EFGH',
            }),
        },
        react.createElement(Text, null, 'Camera')
      ),
    useCameraPermissions: () => [
      { canAskAgain: true, granted: true },
      jest.fn(async () => ({ canAskAgain: true, granted: true })),
    ],
  };
});

jest.mock('../../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      colors: {
        background: '#07101f',
        border: '#334155',
        cardBackground: '#111827',
        error: '#ef4444',
        inputBackground: '#1f2937',
        primary: '#1688ff',
        text: '#f8fafc',
        textMuted: '#94a3b8',
      },
    },
  }),
}));

jest.mock('../../../components/Icon', () => {
  const react = require('react');
  const { Text } = require('react-native');
  return {
    Icon: ({ name }: { name: string }) => react.createElement(Text, null, `icon-${name}`),
  };
});

describe('RemotePairingScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('pairs immediately after scanning a TaskForceAI Remote QR code', async () => {
    const onClose = jest.fn();
    const onPaired = jest.fn();
    const view = await render(
      <RemotePairingScreen visible onClose={onClose} onPaired={onPaired} />
    );

    await fireEvent.press(view.getByLabelText('Mock Remote QR code'));

    await waitFor(() => expect(mockCompleteRemotePairing).toHaveBeenCalledWith('ABCD-EFGH'));
    expect(onPaired).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('offers manual pairing without leaving the Remote screen', async () => {
    const view = await render(
      <RemotePairingScreen visible onClose={jest.fn()} onPaired={jest.fn()} />
    );

    await fireEvent.press(view.getByLabelText('Pair manually instead'));
    await fireEvent.changeText(view.getByLabelText('Remote pairing code'), 'abcd-efgh');
    await fireEvent.press(view.getByLabelText('Pair with code'));

    await waitFor(() => expect(mockCompleteRemotePairing).toHaveBeenCalledWith('ABCD-EFGH'));
  });
});
