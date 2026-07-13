import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { FinanceDashboardResponse } from '@taskforceai/contracts/contracts';

import { Icon } from '../components/Icon';
import { useTheme } from '../contexts/ThemeContext';
import {
  useDisconnectFinanceConnectionMutation,
  useFinanceDashboardQuery,
  useSyncFinanceMutation,
} from '../hooks/api/finance';

interface FinanceScreenProps {
  visible: boolean;
  onClose: () => void;
}

export function FinanceScreen({ visible, onClose }: FinanceScreenProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const financeQuery = useFinanceDashboardQuery({ enabled: visible });
  const syncFinance = useSyncFinanceMutation();
  const disconnectFinance = useDisconnectFinanceConnectionMutation();
  const dashboard = financeQuery.data ?? null;
  const busy = syncFinance.isPending || disconnectFinance.isPending;

  const handleConnectAccount = () => {
    Alert.alert(
      'Connect on web or desktop',
      'Mobile can view, sync, and disconnect connected finance accounts. New Plaid connections still require TaskForceAI on web or desktop.'
    );
  };

  const handleSync = () => {
    void syncFinance.mutateAsync().catch((error) => {
      Alert.alert('Unable to sync finance data', error instanceof Error ? error.message : 'Please try again.');
    });
  };

  const handleDisconnect = (connectionId: number, name: string) => {
    Alert.alert('Disconnect account?', name, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: () => {
          void disconnectFinance.mutateAsync(connectionId).catch((error) => {
            Alert.alert(
              'Unable to disconnect account',
              error instanceof Error ? error.message : 'Please try again.'
            );
          });
        },
      },
    ]);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) }]}>
          <TouchableOpacity
            onPress={onClose}
            style={[styles.headerButton, { backgroundColor: theme.colors.cardBackground }]}
            accessibilityRole="button"
            accessibilityLabel="Back to chat"
          >
            <Icon name="ChevronLeft" size={20} color={theme.colors.text} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: theme.colors.text }]}>Finance</Text>
          <TouchableOpacity
            onPress={() => void financeQuery.refetch()}
            style={[styles.headerButton, { backgroundColor: theme.colors.cardBackground }]}
            accessibilityRole="button"
            accessibilityLabel="Refresh finance"
          >
            <Icon name="RefreshCw" size={18} color={theme.colors.text} />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            gap: 14,
            paddingHorizontal: 16,
            paddingTop: 8,
            paddingBottom: Math.max(insets.bottom, 28),
          }}
          refreshControl={
            <RefreshControl refreshing={financeQuery.isFetching} onRefresh={() => void financeQuery.refetch()} />
          }
        >
          {financeQuery.isLoading ? (
            <StatusPanel text="Loading finance data..." loading />
          ) : financeQuery.isError ? (
            <StatusPanel
              text={financeQuery.error instanceof Error ? financeQuery.error.message : 'Failed to load finance data.'}
            />
          ) : dashboard ? (
            <>
              <FinanceSummary dashboard={dashboard} busy={busy} onConnect={handleConnectAccount} onSync={handleSync} />
              <ConnectionsList dashboard={dashboard} busy={busy} onDisconnect={handleDisconnect} />
              <AccountsList dashboard={dashboard} />
              <TransactionsList dashboard={dashboard} />
              <RecurringList dashboard={dashboard} />
            </>
          ) : (
            <StatusPanel text="No finance data available." />
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function FinanceSummary({
  dashboard,
  busy,
  onConnect,
  onSync,
}: {
  dashboard: FinanceDashboardResponse;
  busy: boolean;
  onConnect: () => void;
  onSync: () => void;
}) {
  const { theme } = useTheme();
  const providerReady =
    dashboard.provider_status === 'provider_configured' || dashboard.provider_status === 'connected';

  return (
    <View style={[styles.panel, { backgroundColor: theme.colors.cardBackground }]}>
      <View style={styles.summaryHeader}>
        <View style={styles.summaryIcon}>
          <Icon name="CreditCard" size={20} color="#f8fafc" />
        </View>
        <View style={styles.summaryCopy}>
          <Text style={[styles.panelTitle, { color: theme.colors.text }]}>
            {formatProviderStatus(dashboard.provider_status)}
          </Text>
          <Text style={styles.mutedText}>
            {dashboard.connected_accounts
              ? `${dashboard.connections.length} connection${dashboard.connections.length === 1 ? '' : 's'}`
              : 'No financial accounts connected'}
          </Text>
        </View>
      </View>
      <View style={styles.actionRow}>
        <TouchableOpacity
          onPress={onConnect}
          disabled={!providerReady || busy}
          style={[styles.actionButton, !providerReady || busy ? styles.actionButtonDisabled : null]}
          accessibilityRole="button"
          accessibilityLabel="Connect finance account"
        >
          <Icon name="Plus" size={16} color="#f8fafc" />
          <Text style={styles.actionText}>Connect</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onSync}
          disabled={!dashboard.connected_accounts || busy}
          style={[styles.actionButton, !dashboard.connected_accounts || busy ? styles.actionButtonDisabled : null]}
          accessibilityRole="button"
          accessibilityLabel="Sync finance data"
        >
          {busy ? <ActivityIndicator color="#f8fafc" size="small" /> : <Icon name="RefreshCw" size={16} color="#f8fafc" />}
          <Text style={styles.actionText}>Sync</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function ConnectionsList({
  dashboard,
  busy,
  onDisconnect,
}: {
  dashboard: FinanceDashboardResponse;
  busy: boolean;
  onDisconnect: (connectionId: number, name: string) => void;
}) {
  if (!dashboard.connections.length) {
    return null;
  }
  return (
    <Section title="Connections">
      {dashboard.connections.map((connection) => {
        const name = connection.institution_name ?? connection.provider;
        return (
          <View key={connection.id} style={styles.listRow}>
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle} numberOfLines={1}>{name}</Text>
              <Text style={styles.mutedText}>Last synced {formatDate(connection.last_synced_at)}</Text>
            </View>
            <TouchableOpacity
              onPress={() => onDisconnect(connection.id, name)}
              disabled={busy}
              style={[styles.smallButton, busy ? styles.actionButtonDisabled : null]}
              accessibilityRole="button"
              accessibilityLabel={`Disconnect ${name}`}
            >
              <Text style={styles.smallButtonText}>Disconnect</Text>
            </TouchableOpacity>
          </View>
        );
      })}
    </Section>
  );
}

function AccountsList({ dashboard }: { dashboard: FinanceDashboardResponse }) {
  return (
    <Section title="Accounts">
      {dashboard.accounts.length === 0 ? (
        <EmptyRow text="No connected accounts yet." />
      ) : (
        dashboard.accounts.map((account) => (
          <View key={account.provider_account_id} style={styles.listRow}>
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle} numberOfLines={1}>{account.name}</Text>
              <Text style={styles.mutedText}>
                {[account.subtype, account.mask ? `ending ${account.mask}` : null].filter(Boolean).join(' - ') ||
                  'Account'}
              </Text>
            </View>
            <Text style={styles.amountText}>
              {typeof account.current_balance === 'number'
                ? formatCurrency(account.current_balance, account.iso_currency_code ?? 'USD')
                : 'Unavailable'}
            </Text>
          </View>
        ))
      )}
    </Section>
  );
}

function TransactionsList({ dashboard }: { dashboard: FinanceDashboardResponse }) {
  return (
    <Section title="Recent transactions">
      {dashboard.recent_transactions.length === 0 ? (
        <EmptyRow text="No recent transactions synced." />
      ) : (
        dashboard.recent_transactions.slice(0, 8).map((transaction) => (
          <View key={transaction.provider_transaction_id} style={styles.listRow}>
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle} numberOfLines={1}>{transaction.merchant_name ?? transaction.name}</Text>
              <Text style={styles.mutedText}>
                {formatDate(transaction.date)}
                {transaction.pending ? ' - Pending' : ''}
              </Text>
            </View>
            <Text style={styles.amountText}>
              {formatCurrency(transaction.amount, transaction.iso_currency_code ?? 'USD')}
            </Text>
          </View>
        ))
      )}
    </Section>
  );
}

function RecurringList({ dashboard }: { dashboard: FinanceDashboardResponse }) {
  if (dashboard.recurring_streams.length === 0) {
    return null;
  }
  return (
    <Section title="Recurring">
      {dashboard.recurring_streams.slice(0, 6).map((stream) => (
        <View key={stream.provider_stream_id} style={styles.listRow}>
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {stream.merchant_name ?? stream.description ?? 'Recurring stream'}
            </Text>
            <Text style={styles.mutedText}>
              {[stream.frequency, stream.status].filter(Boolean).join(' - ') || stream.stream_type}
            </Text>
          </View>
          <Text style={styles.amountText}>
            {typeof stream.last_amount === 'number'
              ? formatCurrency(stream.last_amount, stream.iso_currency_code ?? 'USD')
              : ''}
          </Text>
        </View>
      ))}
    </Section>
  );
}

function Section({ title, children }: React.PropsWithChildren<{ title: string }>) {
  const { theme } = useTheme();
  return (
    <View style={[styles.panel, { backgroundColor: theme.colors.cardBackground }]}>
      <Text style={[styles.panelTitle, { color: theme.colors.text }]}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <Text style={styles.emptyText}>{text}</Text>;
}

function StatusPanel({ text, loading = false }: { text: string; loading?: boolean }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.statusPanel, { backgroundColor: theme.colors.cardBackground }]}>
      {loading ? <ActivityIndicator color="#f8fafc" size="small" /> : null}
      <Text style={[styles.statusText, { color: theme.colors.text }]}>{text}</Text>
    </View>
  );
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
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
};

const formatProviderStatus = (status: string): string => {
  if (status === 'connected') return 'Connected';
  if (status === 'provider_configured') return 'Ready to connect';
  return 'Not configured';
};

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 14,
    paddingHorizontal: 16,
  },
  headerButton: {
    alignItems: 'center',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
  },
  panel: {
    borderRadius: 12,
    gap: 14,
    padding: 14,
  },
  summaryHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  summaryIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  summaryCopy: {
    flex: 1,
    minWidth: 0,
  },
  panelTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  mutedText: {
    color: 'rgba(248,250,252,0.58)',
    fontSize: 12,
    marginTop: 3,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 10,
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 12,
  },
  actionButtonDisabled: {
    opacity: 0.45,
  },
  actionText: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '700',
  },
  sectionBody: {
    gap: 10,
  },
  listRow: {
    alignItems: 'center',
    borderTopColor: 'rgba(255,255,255,0.08)',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    paddingTop: 10,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '600',
  },
  amountText: {
    color: '#f8fafc',
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
  },
  emptyText: {
    color: 'rgba(248,250,252,0.58)',
    fontSize: 13,
  },
  smallButton: {
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  smallButtonText: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '700',
  },
  statusPanel: {
    alignItems: 'center',
    borderRadius: 12,
    gap: 10,
    padding: 18,
  },
  statusText: {
    fontSize: 14,
    textAlign: 'center',
  },
});
