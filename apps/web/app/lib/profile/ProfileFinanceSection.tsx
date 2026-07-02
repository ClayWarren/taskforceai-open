'use client';

import React from 'react';

import { getBrowserClient } from '@taskforceai/contracts/browserClient';
import type { FinanceDashboardResponse } from '@taskforceai/contracts/contracts';
import { Button } from '@taskforceai/ui-kit/button';

import { logger } from '../logger';

const PLAID_LINK_SCRIPT_URL = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';

type PlaidHandler = {
  open: () => void;
  exit: () => void;
};

type PlaidLink = {
  create: (options: {
    token: string;
    onSuccess: (publicToken: string, metadata?: PlaidSuccessMetadata) => void;
    onExit?: (_error: unknown, _metadata: unknown) => void;
  }) => PlaidHandler;
};

type PlaidSuccessMetadata = {
  institution?: {
    institution_id?: string | null;
    name?: string | null;
  } | null;
};

type PlaidWindow = Window & {
  Plaid?: PlaidLink;
};

let plaidScriptPromise: Promise<void> | null = null;

function loadPlaidLinkScript(): Promise<void> {
  const win = window as PlaidWindow;
  if (win.Plaid) {
    return Promise.resolve();
  }
  if (plaidScriptPromise) {
    return plaidScriptPromise;
  }

  plaidScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${PLAID_LINK_SCRIPT_URL}"]`
    );
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Plaid Link failed to load')), {
        once: true,
      });
      return;
    }

    const script = document.createElement('script');
    script.src = PLAID_LINK_SCRIPT_URL;
    script.async = true;
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error('Plaid Link failed to load')), {
      once: true,
    });
    document.head.appendChild(script);
  });

  return plaidScriptPromise;
}

const formatCurrency = (amount: number, currency = 'USD'): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amount);

const formatDate = (value?: string | null): string => {
  if (!value) {
    return 'Not synced';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const formatProviderStatus = (status: string): string => {
  if (status === 'connected') return 'Connected';
  if (status === 'provider_configured') return 'Ready to connect';
  return 'Not configured';
};

function AccountSummary({ dashboard }: { dashboard: FinanceDashboardResponse }) {
  if (dashboard.accounts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
        No connected accounts yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {dashboard.accounts.map((account) => (
        <div
          key={account.provider_account_id}
          className="flex items-center justify-between rounded-lg border border-border p-4"
        >
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{account.name}</div>
            <div className="text-xs text-muted-foreground">
              {[account.subtype, account.mask ? `•••• ${account.mask}` : null]
                .filter(Boolean)
                .join(' · ') || 'Account'}
            </div>
          </div>
          <div className="text-right text-sm font-medium">
            {typeof account.current_balance === 'number'
              ? formatCurrency(account.current_balance, account.iso_currency_code ?? 'USD')
              : 'Balance unavailable'}
          </div>
        </div>
      ))}
    </div>
  );
}

function RecentTransactions({ dashboard }: { dashboard: FinanceDashboardResponse }) {
  if (dashboard.recent_transactions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
        No recent transactions synced.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      {dashboard.recent_transactions.slice(0, 8).map((transaction) => (
        <div
          key={transaction.provider_transaction_id}
          className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 last:border-b-0"
        >
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">
              {transaction.merchant_name ?? transaction.name}
            </div>
            <div className="text-xs text-muted-foreground">
              {formatDate(transaction.date)}
              {transaction.pending ? ' · Pending' : ''}
            </div>
          </div>
          <div className="shrink-0 text-sm font-medium">
            {formatCurrency(transaction.amount, transaction.iso_currency_code ?? 'USD')}
          </div>
        </div>
      ))}
    </div>
  );
}

function RecurringStreams({ dashboard }: { dashboard: FinanceDashboardResponse }) {
  if (dashboard.recurring_streams.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold">Recurring</h4>
      <div className="grid gap-3 sm:grid-cols-2">
        {dashboard.recurring_streams.slice(0, 6).map((stream) => (
          <div key={stream.provider_stream_id} className="rounded-lg border border-border p-3">
            <div className="truncate text-sm font-medium">
              {stream.merchant_name ?? stream.description ?? 'Recurring stream'}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {[stream.frequency, stream.status].filter(Boolean).join(' · ') || stream.stream_type}
            </div>
            {typeof stream.last_amount === 'number' ? (
              <div className="mt-2 text-sm">
                {formatCurrency(stream.last_amount, stream.iso_currency_code ?? 'USD')}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProfileFinanceSection() {
  const [dashboard, setDashboard] = React.useState<FinanceDashboardResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busyAction, setBusyAction] = React.useState<
    'connect' | 'sync' | `disconnect-${number}` | null
  >(null);
  const [message, setMessage] = React.useState<{ kind: 'success' | 'error'; text: string } | null>(
    null
  );

  const refreshDashboard = React.useCallback(async () => {
    const client = getBrowserClient();
    const nextDashboard = await client.getFinanceDashboard();
    setDashboard(nextDashboard);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    refreshDashboard()
      .catch((error) => {
        logger.warn('Failed to load finance dashboard', { error });
        if (!cancelled) {
          setMessage({ kind: 'error', text: 'Failed to load finance data.' });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refreshDashboard]);

  const connectPlaid = async () => {
    setBusyAction('connect');
    setMessage(null);
    try {
      const client = getBrowserClient();
      const { link_token } = await client.createFinanceLinkToken();
      await loadPlaidLinkScript();
      const plaid = (window as PlaidWindow).Plaid;
      if (!plaid) {
        throw new Error('Plaid Link is unavailable');
      }
      const handler = plaid.create({
        token: link_token,
        onSuccess: (publicToken, metadata) => {
          void (async () => {
            setBusyAction('connect');
            try {
              await client.exchangeFinancePublicToken({
                public_token: publicToken,
                institution_id: metadata?.institution?.institution_id ?? null,
                institution_name: metadata?.institution?.name ?? null,
              });
              await client.syncFinanceData();
              await refreshDashboard();
              setMessage({ kind: 'success', text: 'Financial account connected.' });
            } catch {
              setMessage({ kind: 'error', text: 'Failed to finish finance connection.' });
            } finally {
              setBusyAction(null);
            }
          })();
        },
        onExit: () => {
          setBusyAction(null);
        },
      });
      handler.open();
    } catch {
      setMessage({ kind: 'error', text: 'Finance connection is not available yet.' });
      setBusyAction(null);
    }
  };

  const syncFinanceData = async () => {
    setBusyAction('sync');
    setMessage(null);
    try {
      const client = getBrowserClient();
      await client.syncFinanceData();
      await refreshDashboard();
      setMessage({ kind: 'success', text: 'Finance data synced.' });
    } catch {
      setMessage({ kind: 'error', text: 'Failed to sync finance data.' });
    } finally {
      setBusyAction(null);
    }
  };

  const disconnectConnection = async (id: number) => {
    setBusyAction(`disconnect-${id}`);
    setMessage(null);
    try {
      const client = getBrowserClient();
      await client.disconnectFinanceConnection(id);
      await refreshDashboard();
      setMessage({ kind: 'success', text: 'Financial account disconnected.' });
    } catch {
      setMessage({ kind: 'error', text: 'Failed to disconnect financial account.' });
    } finally {
      setBusyAction(null);
    }
  };

  const isProviderReady =
    dashboard?.provider_status === 'provider_configured' ||
    dashboard?.provider_status === 'connected';

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading finance data...</div>;
  }

  return (
    <div className="space-y-6">
      {message ? (
        <div
          className={
            message.kind === 'success'
              ? 'rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-900/30 dark:text-emerald-100'
              : 'rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800/60 dark:bg-red-900/30 dark:text-red-100'
          }
          role="status"
        >
          {message.text}
        </div>
      ) : null}

      <div className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-medium">
            {formatProviderStatus(dashboard?.provider_status ?? 'not_connected')}
          </div>
          <div className="text-xs text-muted-foreground">
            {dashboard?.connected_accounts
              ? `${dashboard.connections.length} connection${dashboard.connections.length === 1 ? '' : 's'}`
              : 'No financial accounts connected'}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => {
              void connectPlaid();
            }}
            disabled={!isProviderReady || busyAction !== null}
          >
            {busyAction === 'connect' ? 'Connecting...' : 'Connect account'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void syncFinanceData();
            }}
            disabled={!dashboard?.connected_accounts || busyAction !== null}
          >
            {busyAction === 'sync' ? 'Syncing...' : 'Sync'}
          </Button>
        </div>
      </div>

      {dashboard?.connections.length ? (
        <div className="space-y-3">
          {dashboard.connections.map((connection) => (
            <div
              key={connection.id}
              className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <div className="text-sm font-medium">
                  {connection.institution_name ?? connection.provider}
                </div>
                <div className="text-xs text-muted-foreground">
                  Last synced {formatDate(connection.last_synced_at)}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void disconnectConnection(connection.id);
                }}
                disabled={busyAction !== null}
              >
                {busyAction === `disconnect-${connection.id}` ? 'Disconnecting...' : 'Disconnect'}
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      <section className="space-y-3">
        <h4 className="text-sm font-semibold">Accounts</h4>
        {dashboard ? <AccountSummary dashboard={dashboard} /> : null}
      </section>

      <section className="space-y-3">
        <h4 className="text-sm font-semibold">Recent transactions</h4>
        {dashboard ? <RecentTransactions dashboard={dashboard} /> : null}
      </section>

      {dashboard ? <RecurringStreams dashboard={dashboard} /> : null}
    </div>
  );
}
