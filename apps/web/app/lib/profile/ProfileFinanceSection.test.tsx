import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../tests/setup/dom';
import { getBrowserClient } from '@taskforceai/contracts/browserClient';
import { ProfileFinanceSection } from './ProfileFinanceSection';

vi.mock('@taskforceai/contracts/browserClient', () => ({
  getBrowserClient: vi.fn(),
}));

const dashboard = {
  connected_accounts: true,
  provider_status: 'connected',
  memories: [],
  capabilities: [],
  connections: [
    {
      id: 2,
      provider: 'plaid',
      institution_name: 'Demo Bank',
      last_synced_at: '2026-06-06T18:00:00Z',
    },
  ],
  accounts: [
    {
      provider_account_id: 'account-1',
      name: 'Checking',
      mask: '1234',
      subtype: 'checking',
      current_balance: 512.25,
      iso_currency_code: 'USD',
    },
  ],
  recent_transactions: [
    {
      provider_transaction_id: 'transaction-1',
      provider_account_id: 'account-1',
      amount: 18.5,
      iso_currency_code: 'USD',
      date: '2026-06-06',
      name: 'Coffee',
      merchant_name: 'Cafe',
      pending: false,
    },
  ],
  recurring_streams: [],
  privacy: {
    connected_accounts_available: true,
    can_mutate_accounts: false,
    training_controls: 'uses account-level data controls',
    data_controls: [],
  },
};

describe('ProfileFinanceSection', () => {
  const client = {
    getFinanceDashboard: vi.fn(),
    createFinanceLinkToken: vi.fn(),
    exchangeFinancePublicToken: vi.fn(),
    syncFinanceData: vi.fn(),
    disconnectFinanceConnection: vi.fn(),
  };

  beforeEach(() => {
    vi.resetAllMocks();
    (getBrowserClient as any).mockReturnValue(client);
    client.getFinanceDashboard.mockResolvedValue(dashboard);
    client.createFinanceLinkToken.mockResolvedValue({
      link_token: 'link-sandbox',
      expiration: '2026-06-06T20:00:00Z',
    });
    client.exchangeFinancePublicToken.mockResolvedValue(undefined);
    client.syncFinanceData.mockResolvedValue(undefined);
    client.disconnectFinanceConnection.mockResolvedValue(undefined);
    (window as any).Plaid = {
      create: vi.fn(({ onSuccess }) => ({
        open: () =>
          onSuccess('public-sandbox', {
            institution: { institution_id: 'ins_123', name: 'Demo Bank' },
          }),
        exit: vi.fn(),
      })),
    };
  });

  afterEach(() => {
    cleanup();
    delete (window as any).Plaid;
  });

  const renderFinanceSection = async () => {
    let view: ReturnType<typeof render> | undefined;
    await act(async () => {
      view = render(<ProfileFinanceSection />);
    });
    return view as ReturnType<typeof render>;
  };

  it('renders connected finance data', async () => {
    await renderFinanceSection();

    expect(await screen.findByText('Demo Bank')).toBeDefined();
    expect(screen.getByText('Checking')).toBeDefined();
    expect(screen.getByText('Cafe')).toBeDefined();
    expect(screen.getByText('$512.25')).toBeDefined();
  });

  it('connects through Plaid Link and syncs', async () => {
    await renderFinanceSection();

    await screen.findByText('Demo Bank');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Connect account' }));
    });

    await waitFor(() =>
      expect(client.exchangeFinancePublicToken).toHaveBeenCalledWith({
        public_token: 'public-sandbox',
        institution_id: 'ins_123',
        institution_name: 'Demo Bank',
      })
    );
    expect(client.syncFinanceData).toHaveBeenCalled();
    expect(await screen.findByText('Financial account connected.')).toBeDefined();
  });

  it('syncs and disconnects a connection', async () => {
    await renderFinanceSection();

    await screen.findByText('Demo Bank');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sync' }));
    });
    await waitFor(() => expect(client.syncFinanceData).toHaveBeenCalled());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    });
    await waitFor(() => expect(client.disconnectFinanceConnection).toHaveBeenCalledWith(2));
  });
});
