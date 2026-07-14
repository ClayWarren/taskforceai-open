import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../../tests/setup/dom';
import { getBrowserClient } from '@taskforceai/api-client/browserClient';
import { ProfileFinanceSection, type FinanceSectionView } from './ProfileFinanceSection';

vi.mock('@taskforceai/api-client/browserClient', () => ({
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

const makeDashboard = (overrides: Partial<typeof dashboard> = {}) => ({
  ...dashboard,
  ...overrides,
});

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
    client.getFinanceDashboard.mockResolvedValue(makeDashboard());
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
    document
      .querySelectorAll('script[src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"]')
      .forEach((script) => script.remove());
  });

  const renderFinanceSection = async (sectionView: FinanceSectionView = 'all') => {
    let view: ReturnType<typeof render> | undefined;
    await act(async () => {
      view = render(<ProfileFinanceSection view={sectionView} />);
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

  it('renders distinct dashboard and accounts views', async () => {
    const dashboardView = await renderFinanceSection('dashboard');

    expect(await screen.findByText('Recent transactions')).toBeDefined();
    expect(screen.getByText('Cafe')).toBeDefined();
    expect(screen.queryByText('Demo Bank')).toBeNull();

    dashboardView.unmount();
    await renderFinanceSection('accounts');

    expect(await screen.findByText('Demo Bank')).toBeDefined();
    expect(screen.getByText('Checking')).toBeDefined();
    expect(screen.queryByText('Recent transactions')).toBeNull();
    expect(screen.queryByText('Cafe')).toBeNull();
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

  it('renders empty account and transaction states when no accounts are connected', async () => {
    client.getFinanceDashboard.mockResolvedValue(
      makeDashboard({
        connected_accounts: false,
        provider_status: 'provider_configured',
        connections: [],
        accounts: [],
        recent_transactions: [],
        recurring_streams: [],
      })
    );

    await renderFinanceSection();

    expect(await screen.findByText('Ready to connect')).toBeDefined();
    expect(screen.getByText('No financial accounts connected')).toBeDefined();
    expect(screen.getByText('No connected accounts yet.')).toBeDefined();
    expect(screen.getByText('No recent transactions synced.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Sync' })).toBeDisabled();
  });

  it('shows a load error and disables connect when the provider is not configured', async () => {
    client.getFinanceDashboard.mockRejectedValue(new Error('finance unavailable'));

    await renderFinanceSection();

    expect(await screen.findByText('Failed to load finance data.')).toBeDefined();
    expect(screen.getByText('Not configured')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Connect account' })).toBeDisabled();
  });

  it('renders recurring streams and unavailable balances with fallback labels', async () => {
    client.getFinanceDashboard.mockResolvedValue(
      makeDashboard({
        accounts: [
          {
            provider_account_id: 'account-2',
            name: 'Savings',
            mask: null,
            subtype: null,
            current_balance: null,
            iso_currency_code: null,
          },
        ],
        recent_transactions: [
          {
            provider_transaction_id: 'transaction-2',
            provider_account_id: 'account-2',
            amount: 12,
            iso_currency_code: 'USD',
            date: 'bad-date',
            name: 'Unknown charge',
            merchant_name: null,
            pending: true,
          },
        ],
        recurring_streams: [
          {
            provider_stream_id: 'stream-1',
            merchant_name: null,
            description: null,
            stream_type: 'subscription',
            frequency: null,
            status: null,
            last_amount: 9.99,
            iso_currency_code: 'USD',
          },
        ],
      } as any)
    );

    await renderFinanceSection();

    expect(await screen.findByText('Savings')).toBeDefined();
    expect(screen.getByText('Account')).toBeDefined();
    expect(screen.getByText('Balance unavailable')).toBeDefined();
    expect(screen.getByText('Unknown charge')).toBeDefined();
    expect(screen.getByText('bad-date · Pending')).toBeDefined();
    expect(screen.getByText('Recurring stream')).toBeDefined();
    expect(screen.getByText('subscription')).toBeDefined();
    expect(screen.getByText('$9.99')).toBeDefined();
  });

  it('reports Plaid Link script failures before opening the handler', async () => {
    delete (window as any).Plaid;
    let appendedScript: HTMLScriptElement | null = null;
    const appendChildSpy = vi
      .spyOn(document.head, 'appendChild')
      .mockImplementation(<T extends Node>(node: T): T => {
        appendedScript = node as unknown as HTMLScriptElement;
        return node;
      });
    await renderFinanceSection();

    await screen.findByText('Demo Bank');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Connect account' }));
    });

    expect(appendedScript).not.toBeNull();
    const script = appendedScript as unknown as HTMLScriptElement;
    expect(script.src).toBe('https://cdn.plaid.com/link/v2/stable/link-initialize.js');

    await act(async () => {
      appendedScript?.dispatchEvent(new Event('error'));
    });

    expect(await screen.findByText('Finance connection is not available yet.')).toBeDefined();
    expect(client.exchangeFinancePublicToken).not.toHaveBeenCalled();
    appendChildSpy.mockRestore();
  });

  it('reports Plaid exchange failures after Link success', async () => {
    client.exchangeFinancePublicToken.mockRejectedValue(new Error('exchange failed'));

    await renderFinanceSection();

    await screen.findByText('Demo Bank');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Connect account' }));
    });

    expect(await screen.findByText('Failed to finish finance connection.')).toBeDefined();
  });

  it('clears busy state when Plaid Link exits without success', async () => {
    (window as any).Plaid = {
      create: vi.fn(({ onExit }) => ({
        open: () => onExit?.(null, null),
        exit: vi.fn(),
      })),
    };

    await renderFinanceSection();

    await screen.findByText('Demo Bank');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Connect account' }));
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Connect account' })).not.toBeDisabled();
    });
    expect(client.exchangeFinancePublicToken).not.toHaveBeenCalled();
  });

  it('reports sync and disconnect failures', async () => {
    client.syncFinanceData.mockRejectedValueOnce(new Error('sync failed'));
    client.disconnectFinanceConnection.mockRejectedValueOnce(new Error('disconnect failed'));

    await renderFinanceSection();

    await screen.findByText('Demo Bank');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sync' }));
    });
    expect(await screen.findByText('Failed to sync finance data.')).toBeDefined();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    });
    expect(await screen.findByText('Failed to disconnect financial account.')).toBeDefined();
  });
});
