import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { FinanceScreen } from '../../screens/FinanceScreen';

const mockRefetch = jest.fn(async () => undefined);
const mockUseFinanceDashboardQuery = jest.fn();
const mockSyncMutateAsync = jest.fn(async () => undefined);
const mockDisconnectMutateAsync = jest.fn(async () => undefined);

jest.mock('../../contexts/ThemeContext', () => ({
  __esModule: true,
  useTheme: () => ({
    theme: {
      colors: {
        background: '#000',
        cardBackground: '#111',
        text: '#fff',
      },
    },
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: React.PropsWithChildren) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../components/Icon', () => {
  const react = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    Icon: ({ name }: { name: string }) => react.createElement(Text, null, `icon-${name}`),
  };
});

jest.mock('../../hooks/api/finance', () => ({
  useFinanceDashboardQuery: (...args: unknown[]) => mockUseFinanceDashboardQuery(...args),
  useSyncFinanceMutation: () => ({
    isPending: false,
    mutateAsync: mockSyncMutateAsync,
  }),
  useDisconnectFinanceConnectionMutation: () => ({
    isPending: false,
    mutateAsync: mockDisconnectMutateAsync,
  }),
}));

const dashboard = {
  connected_accounts: true,
  provider_status: 'connected',
  memories: [],
  capabilities: [],
  connections: [
    {
      id: 4,
      provider: 'plaid',
      institution_name: 'Demo Bank',
      last_synced_at: '2026-06-21T12:00:00.000Z',
    },
  ],
  accounts: [
    {
      provider_account_id: 'account-1',
      name: 'Everyday Checking',
      mask: '1234',
      subtype: 'checking',
      current_balance: 1280.5,
      iso_currency_code: 'USD',
    },
  ],
  recent_transactions: [
    {
      provider_transaction_id: 'transaction-1',
      provider_account_id: 'account-1',
      amount: 42.25,
      iso_currency_code: 'USD',
      date: '2026-06-20',
      name: 'Coffee Shop',
      merchant_name: 'Coffee Shop',
      pending: false,
    },
  ],
  recurring_streams: [
    {
      provider_stream_id: 'stream-1',
      provider_account_id: 'account-1',
      stream_type: 'outflow',
      merchant_name: 'Cloud SaaS',
      frequency: 'monthly',
      last_amount: 19,
      iso_currency_code: 'USD',
      status: 'active',
    },
  ],
  privacy: {
    connected_accounts_available: true,
    can_mutate_accounts: true,
    training_controls: 'disabled',
    data_controls: [],
  },
};

describe('FinanceScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseFinanceDashboardQuery.mockReturnValue({
      data: dashboard,
      error: null,
      isError: false,
      isFetching: false,
      isLoading: false,
      refetch: mockRefetch,
    });
  });

  it('renders connected finance dashboard data', async () => {
    const { getByLabelText, getByText } = await render(<FinanceScreen visible={true} onClose={jest.fn()} />);

    expect(getByText('Connected')).toBeTruthy();
    expect(getByText('Demo Bank')).toBeTruthy();
    expect(getByText('Everyday Checking')).toBeTruthy();
    expect(getByText('$1,280.50')).toBeTruthy();
    expect(getByText('Coffee Shop')).toBeTruthy();
    expect(getByText('$42.25')).toBeTruthy();
    expect(getByText('Cloud SaaS')).toBeTruthy();
    expect(getByLabelText('Sync finance data')).toBeTruthy();
  });

  it('syncs finance data from the action button', async () => {
    const { getByLabelText } = await render(<FinanceScreen visible={true} onClose={jest.fn()} />);

    await fireEvent.press(getByLabelText('Sync finance data'));

    await waitFor(() => {
      expect(mockSyncMutateAsync).toHaveBeenCalledTimes(1);
    });
  });

  it('confirms before disconnecting a connection', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const destructive = buttons?.find((button) => button.style === 'destructive');
      destructive?.onPress?.();
    });
    const { getByLabelText } = await render(<FinanceScreen visible={true} onClose={jest.fn()} />);

    await fireEvent.press(getByLabelText('Disconnect Demo Bank'));

    await waitFor(() => {
      expect(mockDisconnectMutateAsync).toHaveBeenCalledWith(4);
    });
    alertSpy.mockRestore();
  });

  it('keeps the connect action honest until native Plaid Link exists', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByLabelText } = await render(<FinanceScreen visible={true} onClose={jest.fn()} />);

    await fireEvent.press(getByLabelText('Connect finance account'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Connect on web or desktop',
      'Mobile can view, sync, and disconnect connected finance accounts. New Plaid connections still require TaskForceAI on web or desktop.'
    );
    alertSpy.mockRestore();
  });
});
